package dev.chenli.codextracker.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

object RangePlanner {
  private const val HourMs = 60L * 60L * 1_000L
  private const val DayMs = 24L * HourMs
  private const val MaxChunkMs = 60L * DayMs
  const val MaxCustomDays = 366

  /** 2026-08-25T00:00:00-07:00, the shared plan start used by every viewer. */
  const val PlanStartMillis = 1_787_641_200_000L

  fun chunks(from: Long, to: Long): List<QueryRange> {
    if (to <= from) return emptyList()
    val ranges = mutableListOf<QueryRange>()
    var start = from
    while (start < to) {
      val end = minOf(to, start + MaxChunkMs)
      ranges += QueryRange(start, end)
      start = end
    }
    return ranges
  }

  fun today(now: Long, zoneId: ZoneId): LocalDate =
    Instant.ofEpochMilli(now).atZone(zoneId).toLocalDate()

  fun defaultCustomRange(today: LocalDate): CustomDayRange =
    CustomDayRange(from = today.minusDays(29), to = today)

  fun bounds(
    range: UsageRange,
    now: Long,
    zoneId: ZoneId,
    custom: CustomDayRange? = null,
  ): QueryRange {
    val liveEnd = now - Math.floorMod(now, HourMs) + HourMs
    val today = today(now, zoneId)
    return when (range) {
      UsageRange.PlanStart -> QueryRange(minOf(PlanStartMillis, liveEnd), liveEnd)
      UsageRange.Custom -> {
        val requested = custom ?: defaultCustomRange(today)
        val normalized = normalizeCustom(requested.from, requested.to, today)
        val from = normalized.from.atStartOfDay(zoneId).toInstant().toEpochMilli()
        val end = normalized.to.plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()
        QueryRange(from, minOf(end, liveEnd))
      }
      else -> {
        val days = range.days ?: 1
        val from =
          today.minusDays((days - 1).toLong()).atStartOfDay(zoneId).toInstant().toEpochMilli()
        QueryRange(from, liveEnd)
      }
    }
  }

  /**
   * Orders the bounds, clamps the end to today, and limits the span to [MaxCustomDays], exactly
   * like the dashboard and the iOS viewer.
   */
  fun normalizeCustom(from: LocalDate, to: LocalDate, today: LocalDate): NormalizedDayRange {
    var start = from
    var end = to
    if (start > end) {
      val swapped = start
      start = end
      end = swapped
    }
    if (end > today) end = today
    if (start > end) start = end
    val earliest = end.minusDays((MaxCustomDays - 1).toLong())
    if (start < earliest) start = earliest
    val days = ChronoUnit.DAYS.between(start, end).toInt() + 1
    return NormalizedDayRange(from = start, to = end, days = maxOf(1, days))
  }
}
