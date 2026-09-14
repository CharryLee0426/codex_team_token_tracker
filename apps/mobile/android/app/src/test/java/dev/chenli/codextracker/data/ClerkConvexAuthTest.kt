package dev.chenli.codextracker.data

import dev.chenli.codextracker.domain.ConnectionState
import dev.convex.android.AuthState
import java.util.Base64
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ClerkConvexAuthTest {
  private val epochMillis = 1_788_000_000_000L

  private fun jwt(expiresAtSeconds: Long?, claims: String = ""): String {
    val body = buildString {
      append('{')
      if (expiresAtSeconds != null) append("\"exp\":$expiresAtSeconds")
      if (claims.isNotEmpty()) append(if (expiresAtSeconds != null) ",$claims" else claims)
      append('}')
    }
    val payload = Base64.getUrlEncoder().withoutPadding().encodeToString(body.toByteArray())
    return "eyJhbGciOiJSUzI1NiJ9.$payload.signature"
  }

  @Test
  fun `expiry claim is read from the token payload without verification`() {
    assertEquals(
      epochMillis + 60_000,
      JwtClaims.expiresAtMillis(jwt(epochMillis / 1_000 + 60, "\"sid\":\"sess_1\"")),
    )
    assertNull(JwtClaims.expiresAtMillis(jwt(null, "\"sid\":\"sess_1\"")))
    assertNull(JwtClaims.expiresAtMillis("not-a-token"))
    assertNull(JwtClaims.expiresAtMillis("a.b.c"))
  }

  @Test
  fun `tokens are renewed twenty seconds before expiry with a floor and a fallback`() {
    val expiresAt = epochMillis + 60_000
    assertEquals(40_000L, TokenRefreshPolicy.refreshDelayMillis(expiresAt, epochMillis))
    assertEquals(5_000L, TokenRefreshPolicy.refreshDelayMillis(expiresAt, epochMillis + 50_000))
    assertEquals(5_000L, TokenRefreshPolicy.refreshDelayMillis(epochMillis - 1, epochMillis))
    assertEquals(40_000L, TokenRefreshPolicy.refreshDelayMillis(null, epochMillis))
  }

  @Test
  fun `brief socket reconnects stay live and only long outages report reconnecting`() = runTest {
    val connected = MutableStateFlow(true)
    val states = mutableListOf<ConnectionState>()
    backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
      connected.toConnectionStates(graceMillis = 4_000).toList(states)
    }
    runCurrent()
    assertEquals(listOf(ConnectionState.Live), states)

    // A protocol restart: disconnected for two seconds, well inside the grace period.
    connected.value = false
    advanceTimeBy(2_000)
    connected.value = true
    advanceTimeBy(10_000)
    assertEquals(listOf(ConnectionState.Live), states)

    // A real outage crosses the grace period and recovers afterwards.
    connected.value = false
    advanceTimeBy(4_001)
    assertEquals(listOf(ConnectionState.Live, ConnectionState.Reconnecting), states)
    connected.value = true
    runCurrent()
    assertEquals(
      listOf(ConnectionState.Live, ConnectionState.Reconnecting, ConnectionState.Live),
      states,
    )
  }

  @Test
  fun `refresher renews before expiry, follows the new token, retries failures, and idles when signed out`() =
    runTest {
      val authState = MutableStateFlow<AuthState<String>>(AuthState.Unauthenticated())
      var canRefresh = true
      var failNextRefresh = false
      var refreshes = 0
      val refresher =
        ConvexAuthRefresher(
          authState = authState,
          nowMillis = { epochMillis + testScheduler.currentTime },
          canRefresh = { canRefresh },
          refresh = {
            refreshes += 1
            if (failNextRefresh) {
              failNextRefresh = false
              throw IllegalStateException("network")
            }
            val issuedAt = (epochMillis + testScheduler.currentTime) / 1_000
            authState.value = AuthState.Authenticated(jwt(issuedAt + 60))
          },
        )
      backgroundScope.launch { refresher.run() }
      fun advanceTo(virtualMillis: Long) {
        advanceTimeBy(virtualMillis - testScheduler.currentTime)
        runCurrent()
      }

      // Unauthenticated: nothing happens no matter how long we wait.
      advanceTo(120_000)
      assertEquals(0, refreshes)

      // Login installs a token that expires at 180 s; renewal happens 20 s earlier, at 160 s.
      authState.value = AuthState.Authenticated(jwt(epochMillis / 1_000 + 180))
      advanceTo(159_999)
      assertEquals(0, refreshes)
      advanceTo(160_000)
      assertEquals(1, refreshes)

      // The renewed token (expires 220 s) is followed: the next renewal is at 200 s.
      advanceTo(199_999)
      assertEquals(1, refreshes)
      advanceTo(200_000)
      assertEquals(2, refreshes)

      // A token installed elsewhere at 220 s (for example, organization activation) resets the
      // schedule to 260 s.
      advanceTo(220_000)
      authState.value = AuthState.AuthLoading()
      authState.value = AuthState.Authenticated(jwt(epochMillis / 1_000 + 280))
      advanceTo(259_999)
      assertEquals(2, refreshes)
      advanceTo(260_000)
      assertEquals(3, refreshes)

      // A failed renewal at 300 s is retried five seconds later and never signs the viewer out.
      failNextRefresh = true
      advanceTo(300_000)
      assertEquals(4, refreshes)
      advanceTo(304_999)
      assertEquals(4, refreshes)
      advanceTo(305_000)
      assertEquals(5, refreshes)

      // Without a Clerk session the refresher waits instead of calling Convex.
      canRefresh = false
      advanceTo(400_000)
      assertEquals(5, refreshes)
      canRefresh = true
      advanceTo(405_000)
      assertEquals(6, refreshes)
    }
}
