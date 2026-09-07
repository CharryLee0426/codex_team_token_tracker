package dev.chenli.codextracker.domain

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.TreeMap
import kotlin.math.round

object UsageAggregator {
  const val OtherModelName = "Other"
  const val MaxModels = 8

  /** Monday … Sunday in the 0 = Sunday weekday convention shared with the iOS viewer. */
  val weekdayOrder: List<Int> = listOf(1, 2, 3, 4, 5, 6, 0)

  private val datedSuffix = Regex("-\\d{4}-\\d{2}-\\d{2}$")
  private val openAiPrefix =
    Regex("^(gpt[-.]|chatgpt|chat-latest|o[1-9](?:[-.]|$)|codex|text-|davinci|babbage|ada|curie)")

  fun expandCompactRows(rows: List<CompactHourRow>): List<UsageRow> =
    rows.flatMap { row ->
      val models =
        row.m.ifEmpty {
          listOf(
            CompactModelUsage(
              model = "unknown",
              i = row.i,
              c = row.c,
              w = row.w,
              o = row.o,
              r = row.r,
              t = row.t,
              q = row.q,
              usd = row.usd,
            )
          )
        }
      models.map { model ->
        UsageRow(
          hourStart = row.h,
          model = model.model.ifEmpty { "unknown" },
          agent = model.agent ?: "codex",
          userId = row.u,
          deviceId = row.d,
          cost = model.usd,
          usage =
            TokenUsage(model.i, model.c, model.w, model.o, model.r, model.t, model.q),
        )
      }
    }

  fun codexRows(rows: List<UsageRow>): List<UsageRow> =
    rows.filter { isOpenAIModel(it.model) && it.cost.isFinite() && it.cost >= 0 }

  fun isOpenAIModel(model: String): Boolean {
    var normalized = model.trim().lowercase()
    if (normalized.isEmpty()) normalized = "unknown"
    normalized = normalized.removePrefix("openai/")
    normalized = normalized.replace(datedSuffix, "").removeSuffix("-preview")
    return normalized == "unknown" || openAiPrefix.containsMatchIn(normalized)
  }

  fun summarize(rows: List<UsageRow>): UsageSummary {
    val usage = rows.fold(TokenUsage()) { total, row -> total + row.usage }
    return UsageSummary(
      usage = usage,
      cost = rows.sumOf(UsageRow::cost).roundedCents(),
      cacheHitRate =
        if (usage.input == 0L) 0.0
        else (usage.cached.toDouble() / usage.input).coerceIn(0.0, 1.0),
      averageTokensPerRequest =
        if (usage.requests == 0L) 0.0 else usage.total.toDouble() / usage.requests,
      activeUsers = rows.mapTo(mutableSetOf(), UsageRow::userId).size,
      models = rows.mapTo(mutableSetOf(), UsageRow::model).size,
    )
  }

  fun dailyTotals(rows: List<UsageRow>, zoneId: ZoneId): List<DailyUsage> {
    data class MutableDaily(var total: Long = 0, var cost: Double = 0.0)

    val days = TreeMap<LocalDate, MutableDaily>()
    rows.forEach { row ->
      val date = Instant.ofEpochMilli(row.hourStart).atZone(zoneId).toLocalDate()
      val total = days.getOrPut(date) { MutableDaily() }
      total.total += row.usage.total
      total.cost += row.cost
    }
    return days.map { (date, value) ->
      DailyUsage(date = date, total = value.total, cost = value.cost.roundedCents())
    }
  }

  /** 7 × 24 cells ordered by weekday (0 = Sunday) then hour, grouped in the viewer's zone. */
  fun activeHours(rows: List<UsageRow>, zoneId: ZoneId): List<ActivityCell> {
    val totals = LongArray(7 * 24)
    rows.forEach { row ->
      val zoned = Instant.ofEpochMilli(row.hourStart).atZone(zoneId)
      val weekday = weekdayIndex(zoned.dayOfWeek)
      totals[weekday * 24 + zoned.hour] += row.usage.total
    }
    return (0 until 7).flatMap { weekday ->
      (0 until 24).map { hour -> ActivityCell(weekday, hour, totals[weekday * 24 + hour]) }
    }
  }

  /** Weekday totals in Monday … Sunday order. */
  fun weekdays(rows: List<UsageRow>, zoneId: ZoneId): List<WeekdayUsage> {
    val cells = activeHours(rows, zoneId)
    return weekdayOrder.map { weekday ->
      WeekdayUsage(weekday, cells.filter { it.weekday == weekday }.sumOf(ActivityCell::total))
    }
  }

  fun weekdayIndex(dayOfWeek: DayOfWeek): Int = dayOfWeek.value % 7

  fun dayOfWeek(weekdayIndex: Int): DayOfWeek =
    if (weekdayIndex == 0) DayOfWeek.SUNDAY else DayOfWeek.of(weekdayIndex)

  fun modelBreakdown(rows: List<UsageRow>, maxModels: Int = MaxModels): List<UsageBreakdown> =
    breakdown(rows, UsageRow::model).limitWithOverflow(maxModels, OtherModelName)

  fun sourceBreakdown(rows: List<UsageRow>): List<UsageBreakdown> =
    breakdown(rows, UsageRow::agent)

  fun memberBreakdown(rows: List<UsageRow>, users: List<PublicUser>): List<MemberContribution> {
    val userById = users.associateBy(PublicUser::id)
    val grandTotal = rows.sumOf { it.usage.total }
    return rows
      .groupBy(UsageRow::userId)
      .map { (userId, items) ->
        val total = items.sumOf { it.usage.total }
        MemberContribution(
          user = userById[userId] ?: PublicUser(id = userId),
          total = total,
          cost = items.sumOf(UsageRow::cost).roundedCents(),
          share = if (grandTotal == 0L) 0.0 else total.toDouble() / grandTotal,
        )
      }
      .sortedWith(compareByDescending<MemberContribution> { it.total }.thenBy { it.displayName })
  }

  fun snapshot(
    rows: List<UsageRow>,
    users: List<PublicUser>,
    zoneId: ZoneId,
    includeMembers: Boolean,
  ): UsageSnapshot =
    UsageSnapshot(
      summary = summarize(rows),
      daily = dailyTotals(rows, zoneId),
      models = modelBreakdown(rows),
      sources = sourceBreakdown(rows),
      members = if (includeMembers) memberBreakdown(rows, users) else emptyList(),
      activeHours = activeHours(rows, zoneId),
      weekdays = weekdays(rows, zoneId),
    )

  private fun breakdown(rows: List<UsageRow>, key: (UsageRow) -> String): List<UsageBreakdown> {
    val grandTotal = rows.sumOf { it.usage.total }
    return rows
      .groupBy(key)
      .map { (name, items) ->
        val usage = items.fold(TokenUsage()) { total, item -> total + item.usage }
        UsageBreakdown(
          name = name,
          usage = usage,
          cost = items.sumOf(UsageRow::cost).roundedCents(),
          share = if (grandTotal == 0L) 0.0 else usage.total.toDouble() / grandTotal,
        )
      }
      .sortedWith(compareByDescending<UsageBreakdown> { it.usage.total }.thenBy { it.name })
  }

  private fun List<UsageBreakdown>.limitWithOverflow(
    limit: Int,
    overflowName: String,
  ): List<UsageBreakdown> {
    if (size <= limit) return this
    val shown = take(limit)
    val hidden = drop(limit)
    val hiddenUsage = hidden.fold(TokenUsage()) { total, item -> total + item.usage }
    return shown +
      UsageBreakdown(
        name = overflowName,
        usage = hiddenUsage,
        cost = hidden.sumOf(UsageBreakdown::cost).roundedCents(),
        share = hidden.sumOf(UsageBreakdown::share),
      )
  }

  private fun Double.roundedCents(): Double = round(this * 100.0) / 100.0
}
