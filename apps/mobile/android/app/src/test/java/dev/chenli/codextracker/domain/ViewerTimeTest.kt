package dev.chenli.codextracker.domain

import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ViewerTimeTest {
  @Test
  fun `system clock schedules an off-grid freshness wake at the exact deadline`() =
    runTest {
      var now = 1_001L
      val delays = mutableListOf<Long>()
      val clock =
        SystemViewerClock(
          tickMillis = 15_000,
          currentTimeMillis = { now },
          delayMillis = { duration ->
            delays += duration
            now += duration
          },
        )

      assertEquals(123_456L, clock.wakeAt(123_456L))
      assertEquals(listOf(122_455L), delays)
    }

  @Test
  fun `query key changes at UTC hour and local day boundaries`() {
    val utc = ZoneId.of("UTC")
    val utcBefore = Instant.parse("2026-09-04T12:59:59Z").toEpochMilli()
    val utcAfter = Instant.parse("2026-09-04T13:00:00Z").toEpochMilli()
    assertNotEquals(
      QueryRefreshKey.from(utcBefore, utc),
      QueryRefreshKey.from(utcAfter, utc),
    )

    val india = ZoneId.of("Asia/Kolkata")
    val localBefore = Instant.parse("2026-09-04T18:29:59Z").toEpochMilli()
    val localAfter = Instant.parse("2026-09-04T18:30:00Z").toEpochMilli()
    assertNotEquals(
      QueryRefreshKey.from(localBefore, india),
      QueryRefreshKey.from(localAfter, india),
    )
  }

  @Test
  fun `live state expires locally at two minutes`() {
    val now = Instant.parse("2026-09-04T12:00:00Z").toEpochMilli()
    assertTrue(LiveFreshness.isFresh(now - LiveFreshness.TtlMillis + 1, now))
    assertFalse(LiveFreshness.isFresh(now - LiveFreshness.TtlMillis, now))

    val expired = liveSnapshot(now - LiveFreshness.TtlMillis)
    val member =
      Member(
        id = "member",
        role = "org:member",
        joinedAt = now,
        deviceCount = 1,
        live = expired,
      )
    val device =
      Device(
        id = "device",
        name = "Laptop",
        platform = "darwin",
        createdAt = now,
        lastSeenAt = now,
        live = expired,
        logins = 1,
      )

    assertNull(LiveFreshness.members(listOf(member), now).single().live)
    assertNull(LiveFreshness.devices(listOf(device), now).single().live)
    assertTrue(
      LiveFreshness.liveDevices(
          listOf(
            LiveDevice(
              user = PublicUser("user"),
              deviceId = "device",
              deviceName = "Laptop",
              platform = "darwin",
              live = expired,
            )
          ),
          now,
        )
        .isEmpty()
    )
  }

  private fun liveSnapshot(updatedAt: Long) =
    LiveSnapshot(
      tokensPerSecond = 1.0,
      todayTotal = 1,
      todayCost = 0.01,
      updatedAt = updatedAt,
    )
}
