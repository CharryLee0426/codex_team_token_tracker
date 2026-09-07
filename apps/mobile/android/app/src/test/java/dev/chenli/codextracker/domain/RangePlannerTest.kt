package dev.chenli.codextracker.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

class RangePlannerTest {
  private val now = Instant.parse("2026-09-04T12:30:00Z").toEpochMilli()
  private val liveEnd = Instant.parse("2026-09-04T13:00:00Z").toEpochMilli()

  @Test
  fun `presets start at the local day boundary and end at the next UTC hour`() {
    val bounds = RangePlanner.bounds(UsageRange.OneYear, now, ZoneId.of("America/Los_Angeles"))

    assertEquals(
      LocalDate.of(2025, 9, 5).atStartOfDay(ZoneId.of("America/Los_Angeles")).toInstant().toEpochMilli(),
      bounds.from,
    )
    assertEquals(liveEnd, bounds.to)
  }

  @Test
  fun `plan start bounds begin at the shared plan start`() {
    val bounds = RangePlanner.bounds(UsageRange.PlanStart, now, ZoneId.of("UTC"))

    assertEquals(RangePlanner.PlanStartMillis, bounds.from)
    assertEquals(liveEnd, bounds.to)
  }

  @Test
  fun `custom ranges are ordered, clamped to today and limited to 366 days`() {
    val today = LocalDate.of(2026, 9, 4)

    val normalized =
      RangePlanner.normalizeCustom(LocalDate.of(2026, 9, 10), LocalDate.of(2024, 1, 1), today)

    assertEquals(today, normalized.to)
    assertEquals(today.minusDays(365), normalized.from)
    assertEquals(366, normalized.days)
  }

  @Test
  fun `custom bounds cover whole local days up to the live hour`() {
    val zone = ZoneId.of("America/Los_Angeles")
    val custom = CustomDayRange(LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 2))

    val bounds = RangePlanner.bounds(UsageRange.Custom, now, zone, custom)

    assertEquals(Instant.parse("2026-09-01T07:00:00Z").toEpochMilli(), bounds.from)
    assertEquals(Instant.parse("2026-09-03T07:00:00Z").toEpochMilli(), bounds.to)
  }

  @Test
  fun `a missing custom range defaults to the last thirty days`() {
    val zone = ZoneId.of("UTC")

    val bounds = RangePlanner.bounds(UsageRange.Custom, now, zone, custom = null)

    assertEquals(Instant.parse("2026-08-06T00:00:00Z").toEpochMilli(), bounds.from)
    assertEquals(liveEnd, bounds.to)
  }

  @Test
  fun `range keys round trip for persistence`() {
    UsageRange.entries.forEach { range -> assertEquals(range, UsageRange.fromKey(range.key)) }
    assertEquals(null, UsageRange.fromKey("unknown"))
  }
}
