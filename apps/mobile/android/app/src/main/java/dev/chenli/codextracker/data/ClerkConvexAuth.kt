package dev.chenli.codextracker.data

import android.content.Context
import com.clerk.api.Clerk
import com.clerk.api.network.serialization.ClerkResult
import com.clerk.api.session.GetTokenOptions
import com.clerk.api.session.Session
import com.clerk.api.session.fetchToken
import dev.chenli.codextracker.domain.ConnectionState
import dev.convex.android.AuthProvider
import dev.convex.android.AuthState
import java.util.Base64
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.transformLatest
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * Bridges the Clerk session to the Convex client.
 *
 * The bundled Convex client (convex-rs 0.10.x) never renews a token on its own: it replays the token it
 * received at login on every reconnect and only asks this provider again after the backend has already
 * rejected an expired identity, which tears the WebSocket down. Clerk session tokens expire after 60 s,
 * so every login here bypasses Clerk's token cache and returns a freshly minted token, and
 * [ConvexAuthRefresher] renews it before the backend can expire it.
 */
internal class ClerkSessionAuthProvider : AuthProvider<String> {
  override suspend fun login(context: Context, onIdToken: (String?) -> Unit): Result<String> =
    loginFromCache(onIdToken)

  override suspend fun loginFromCache(onIdToken: (String?) -> Unit): Result<String> =
    try {
      Result.success(issueToken())
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (error: Throwable) {
      Result.failure(error)
    }

  override suspend fun logout(context: Context): Result<Void?> {
    if (Clerk.activeSession == null) return Result.success(null)
    return when (val result = Clerk.auth.signOut()) {
      is ClerkResult.Success -> Result.success(null)
      is ClerkResult.Failure ->
        Result.failure(result.throwable ?: IllegalStateException("Sign out failed"))
    }
  }

  override fun extractIdToken(authResult: String): String = authResult

  /** A newly minted session token; the token value is returned to the caller only and never logged. */
  private suspend fun issueToken(): String {
    val session = Clerk.activeSession ?: throw NoActiveClerkSession()
    return when (val result = session.fetchToken(GetTokenOptions(skipCache = true))) {
      is ClerkResult.Success -> result.value.jwt
      is ClerkResult.Failure ->
        throw result.throwable ?: IllegalStateException("Could not refresh authentication")
    }
  }
}

internal class NoActiveClerkSession : IllegalStateException("No active Clerk session")

/** Mirrors the Clerk session transitions that require a Convex login or logout. */
internal object ClerkSessionSyncPolicy {
  fun shouldLogin(previous: Session?, current: Session?): Boolean =
    current != null &&
      current.status == Session.SessionStatus.ACTIVE &&
      (previous == null || previous.status != Session.SessionStatus.ACTIVE || previous.id != current.id)

  fun shouldLogout(previous: Session?, current: Session?): Boolean = previous != null && current == null
}

/** Reads the expiry claim of a compact JWT without verifying it; only the timestamp is used. */
internal object JwtClaims {
  fun expiresAtMillis(jwt: String): Long? {
    val parts = jwt.split('.')
    if (parts.size != 3) return null
    return runCatching {
        val payload = Base64.getUrlDecoder().decode(parts[1]).decodeToString()
        Json.parseToJsonElement(payload).jsonObject["exp"]?.jsonPrimitive?.longOrNull?.times(1_000)
      }
      .getOrNull()
  }
}

internal object TokenRefreshPolicy {
  /** Renew this long before the token expires so the backend never observes a stale identity. */
  const val RefreshLeadMillis = 20_000L

  /** Never renew more often than this, even for very short or already expired tokens. */
  const val MinimumRefreshDelayMillis = 5_000L

  /** Used when a token has no readable expiry; Clerk session tokens live for 60 s. */
  const val FallbackRefreshDelayMillis = 40_000L

  /** How long a socket may stay disconnected before the viewer reports that it is reconnecting. */
  const val ReconnectGraceMillis = 4_000L

  fun refreshDelayMillis(expiresAtMillis: Long?, nowMillis: Long): Long =
    if (expiresAtMillis == null) FallbackRefreshDelayMillis
    else maxOf(expiresAtMillis - RefreshLeadMillis - nowMillis, MinimumRefreshDelayMillis)
}

/**
 * Renews the Convex identity before the current token expires. Retries on a fixed short interval
 * after a failed renewal because the next attempt is what restores service; it stays idle while the
 * client is unauthenticated and restarts whenever a different token is installed elsewhere.
 */
internal class ConvexAuthRefresher(
  private val authState: StateFlow<AuthState<String>>,
  private val nowMillis: () -> Long,
  private val canRefresh: () -> Boolean,
  private val refresh: suspend () -> Unit,
) {
  suspend fun run() {
    var retrying = false
    while (currentCoroutineContext().isActive) {
      val token = authState.value.token()
      if (token == null) {
        authState.first { it.token() != null }
        retrying = false
        continue
      }
      val wait =
        if (retrying) TokenRefreshPolicy.MinimumRefreshDelayMillis
        else TokenRefreshPolicy.refreshDelayMillis(JwtClaims.expiresAtMillis(token), nowMillis())
      val replaced =
        withTimeoutOrNull(wait) {
          authState.first { state -> state !is AuthState.AuthLoading && state.token() != token }
        }
      if (replaced != null) {
        retrying = false
        continue
      }
      if (!canRefresh()) {
        retrying = true
        continue
      }
      retrying =
        try {
          refresh()
          false
        } catch (cancelled: CancellationException) {
          throw cancelled
        } catch (_: Throwable) {
          // Renewal is retried shortly; a failed refresh never signs the viewer out.
          true
        }
    }
  }

  private fun AuthState<String>.token(): String? = (this as? AuthState.Authenticated<String>)?.userInfo
}

/**
 * Collapses socket state into the viewer's connection state. Short reconnects, such as the Convex
 * client re-establishing its protocol, stay reported as live; only an outage longer than
 * [graceMillis] surfaces as reconnecting.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun Flow<Boolean>.toConnectionStates(graceMillis: Long): Flow<ConnectionState> =
  distinctUntilChanged()
    .transformLatest { connected ->
      if (connected) {
        emit(ConnectionState.Live)
      } else {
        delay(graceMillis)
        emit(ConnectionState.Reconnecting)
      }
    }
    .distinctUntilChanged()
