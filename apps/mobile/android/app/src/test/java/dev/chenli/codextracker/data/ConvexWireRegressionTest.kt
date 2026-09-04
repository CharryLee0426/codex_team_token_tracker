package dev.chenli.codextracker.data

import dev.chenli.codextracker.domain.QueryRange
import dev.chenli.codextracker.domain.UsageScope
import dev.convex.android.ConvexClient
import dev.convex.android.testing.FakeFfiClient
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ConvexWireRegressionTest {
  @Test
  fun `usage query arguments encode v number values as ordinary Convex floats`() =
    runTest {
      val ffi = FakeFfiClient()
      val client = ConvexClient("https://wire.test") { _, _, _ -> ffi }
      val hourlyArgs =
        LiveQueryArguments.hourly(
          scope = UsageScope.Personal,
          orgId = null,
          range = QueryRange(from = 100, to = 200),
        )
      val sessionsArgs =
        LiveQueryArguments.recentSessions(
          scope = UsageScope.Team,
          orgId = "org-a",
          limit = 12,
        )

      assertTrue(hourlyArgs.getValue("from") is Double)
      assertTrue(hourlyArgs.getValue("to") is Double)
      assertTrue(sessionsArgs.getValue("limit") is Double)

      val hourlyJob =
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
          client.subscribe<ConvexHourlyResponse>("usage:hourly", hourlyArgs).collect {}
        }
      val sessionsJob =
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
          client.subscribe<List<ConvexUsageSession>>("usage:recentSessions", sessionsArgs).collect {}
        }

      val encodedHourly = ffi.subscriptionRequestsFor("usage:hourly").single().args
      val encodedSessions = ffi.subscriptionRequestsFor("usage:recentSessions").single().args
      assertEquals("100.0", encodedHourly["from"])
      assertEquals("200.0", encodedHourly["to"])
      assertEquals("12.0", encodedSessions["limit"])
      assertTrue(encodedHourly.values.none { "\$integer" in it })
      assertTrue(encodedSessions.values.none { "\$integer" in it })

      hourlyJob.cancel()
      sessionsJob.cancel()
    }

  @Test
  fun `actual Convex decoder maps ordinary JS numbers to checked integer domain values`() =
    runTest {
      val hourly =
        decodeWithConvexClient<ConvexHourlyResponse>(
          """
          {
            "rows": [{
              "h": 100.0, "u": "user-a", "d": "device-a",
              "i": 100.0, "c": 100.0, "w": 100.0, "o": 100.0,
              "r": 100.0, "t": 100.0, "q": 100.0, "usd": 100.0,
              "m": [{
                "model": "gpt-5.6-sol", "agent": "codex",
                "i": 100.0, "c": 100.0, "w": 100.0, "o": 100.0,
                "r": 100.0, "t": 100.0, "q": 100.0, "usd": 100.0
              }]
            }],
            "users": [{"id": "user-a", "name": "Alex", "email": null, "imageUrl": null}]
          }
          """.trimIndent()
        ).toDomain()
      val row = hourly.rows.single()
      val model = row.m.single()

      assertEquals(100L, row.h)
      assertEquals(
        listOf(100L, 100L, 100L, 100L, 100L, 100L, 100L),
        listOf(row.i, row.c, row.w, row.o, row.r, row.t, row.q),
      )
      assertEquals(
        listOf(100L, 100L, 100L, 100L, 100L, 100L, 100L),
        listOf(model.i, model.c, model.w, model.o, model.r, model.t, model.q),
      )
      assertEquals(100.0, row.usd, 0.0)
      assertEquals(100.0, model.usd, 0.0)
    }

  @Test
  fun `actual Convex decoder maps every live response number and preserves optionals`() =
    runTest {
      val account =
        decodeWithConvexClient<ConvexAccount?>(
          """{"id":"user-a","name":null,"email":null,"imageUrl":null,"onboardedAt":null}"""
        )!!.toDomain()
      assertNull(account.onboardedAt)

      val session =
        decodeWithConvexClient<List<ConvexUsageSession>>(
          """
          [{
            "id":"session-a","user":{"id":"user-a","name":null,"email":null,"imageUrl":null},
            "deviceId":"device-a","sessionId":"upstream-a","agent":"codex","model":"gpt-5.6-sol",
            "projectName":null,"startedAt":100.0,"lastActivityAt":100.0,
            "input":100.0,"cached":100.0,"cacheWrite":100.0,"output":100.0,
            "reasoning":100.0,"total":100.0,"requests":100.0,"cost":100.0,
            "source":null,"cliVersion":null
          }]
          """.trimIndent()
        ).single().toDomain()
      assertEquals(100L, session.startedAt)
      assertEquals(100L, session.lastActivityAt)
      assertEquals(100L, session.total)
      assertEquals(100L, session.requests)

      val liveJson =
        """
        {"sessionId":null,"model":null,"tokensPerSecond":100.0,"lastEventAt":null,
         "todayTotal":100.0,"todayCost":100.0,"updatedAt":100.0}
        """.trimIndent()
      val member =
        decodeWithConvexClient<List<ConvexMember>>(
          """
          [{"id":"user-a","name":null,"email":null,"imageUrl":null,"role":"org:member",
            "joinedAt":100.0,"deviceCount":100.0,"lastSeenAt":null,"live":$liveJson}]
          """.trimIndent()
        ).single().toDomain()
      assertEquals(100L, member.joinedAt)
      assertEquals(100, member.deviceCount)
      assertNull(member.lastSeenAt)
      assertNull(member.live?.lastEventAt)

      val device =
        decodeWithConvexClient<List<ConvexDevice>>(
          """
          [{"id":"device-a","name":"Mac","platform":"darwin","hostname":null,
            "appVersion":null,"timezone":null,"createdAt":100.0,"lastSeenAt":100.0,
            "live":$liveJson,"logins":100.0}]
          """.trimIndent()
        ).single().toDomain()
      assertEquals(100L, device.createdAt)
      assertEquals(100L, device.lastSeenAt)
      assertEquals(100, device.logins)

      val liveDevice =
        decodeWithConvexClient<List<ConvexLiveDevice>>(
          """
          [{"user":{"id":"user-a","name":null,"email":null,"imageUrl":null},
            "deviceId":"device-a","deviceName":"Mac","platform":"darwin","live":$liveJson}]
          """.trimIndent()
        ).single().toDomain()
      assertEquals(100.0, liveDevice.live.tokensPerSecond, 0.0)
      assertEquals(100L, liveDevice.live.todayTotal)
      assertEquals(100L, liveDevice.live.updatedAt)
    }

  @Test
  fun `tagged non finite Convex float decodes then fails closed at domain boundary`() =
    runTest {
      val taggedPositiveInfinity = """{"${'$'}float":"AAAAAAAA8H8="}"""
      val wire =
        decodeWithConvexClient<ConvexLiveSnapshot>(
          """
          {"sessionId":null,"model":null,"tokensPerSecond":$taggedPositiveInfinity,
           "lastEventAt":null,"todayTotal":100.0,"todayCost":100.0,"updatedAt":100.0}
          """.trimIndent()
        )

      val error = assertThrows(IllegalArgumentException::class.java) { wire.toDomain() }
      assertTrue(error.message.orEmpty().contains("tokensPerSecond"))
    }

  @Test
  fun `fractional unsafe and out of range numbers fail instead of truncating`() {
    assertThrows(IllegalArgumentException::class.java) {
      1.5.toDomainLong("tokens")
    }
    assertThrows(IllegalArgumentException::class.java) {
      9_007_199_254_740_992.0.toDomainLong("timestamp")
    }
    assertThrows(IllegalArgumentException::class.java) {
      2_147_483_648.0.toDomainInt("deviceCount")
    }
  }

  private suspend inline fun <reified T> TestScope.decodeWithConvexClient(json: String): T {
    val ffi = FakeFfiClient()
    val client = ConvexClient("https://wire.test") { _, _, _ -> ffi }
    val result =
      backgroundScope.async(UnconfinedTestDispatcher(testScheduler)) {
        client.subscribe<T>("wire:test").first()
      }
    ffi.sendSubscriptionData("wire:test", emptyMap(), json)
    return result.await().getOrThrow()
  }
}
