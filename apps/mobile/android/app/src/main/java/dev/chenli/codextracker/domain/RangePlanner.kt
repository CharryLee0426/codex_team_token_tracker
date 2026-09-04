package dev.chenli.codextracker.domain

import java.time.Instant
import java.time.ZoneId

object RangePlanner {
  private const val HourMs = 60L * 60L * 1_000L
  private const val DayMs = 24L * HourMs
  private const val MaxChunkMs = 60L * DayMs

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

  fun bounds(range: UsageRange, now: Long, zoneId: ZoneId): QueryRange {
    val today = Instant.ofEpochMilli(now).atZone(zoneId).toLocalDate()
    val from = today.minusDays((range.days - 1).toLong()).atStartOfDay(zoneId).toInstant().toEpochMilli()
    val to = now - (now % HourMs) + HourMs
    return QueryRange(from, to)
  }
}
