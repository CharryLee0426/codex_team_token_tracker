package dev.chenli.codextracker.domain

import java.time.Instant
import java.time.ZoneId
import java.util.TreeMap
import kotlin.math.round

object UsageAggregator {
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
          model = model.model,
          agent = model.agent ?: "codex",
          userId = row.u,
          deviceId = row.d,
          cost = model.usd,
          usage =
            TokenUsage(model.i, model.c, model.w, model.o, model.r, model.t, model.q),
        )
      }
    }

  fun codexRows(rows: List<UsageRow>): List<UsageRow> = rows.filter { isOpenAIModel(it.model) }

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
      activeUsers = rows.mapTo(mutableSetOf(), UsageRow::userId).size,
      models = rows.mapTo(mutableSetOf(), UsageRow::model).size,
    )
  }

  fun dailyTotals(rows: List<UsageRow>, zoneId: ZoneId): List<DailyUsage> {
    data class MutableDaily(var total: Long = 0, var cost: Double = 0.0)

    val days = TreeMap<java.time.LocalDate, MutableDaily>()
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

  fun snapshot(
    rows: List<UsageRow>,
    users: List<PublicUser>,
    zoneId: ZoneId,
    includeMembers: Boolean,
  ): UsageSnapshot {
    val totalTokens = rows.sumOf { it.usage.total }.coerceAtLeast(1)
    fun breakdown(key: (UsageRow) -> String) =
      rows
        .groupBy(key)
        .map { (name, items) ->
          val usage = items.fold(TokenUsage()) { total, item -> total + item.usage }
          UsageBreakdown(
            name = name,
            usage = usage,
            cost = items.sumOf(UsageRow::cost).roundedCents(),
            share = usage.total.toDouble() / totalTokens,
          )
        }
        .sortedByDescending { it.usage.total }

    val userById = users.associateBy(PublicUser::id)
    val members =
      if (!includeMembers) emptyList()
      else
        rows
          .groupBy(UsageRow::userId)
          .mapNotNull { (userId, items) ->
            val user = userById[userId] ?: return@mapNotNull null
            MemberContribution(
              user = user,
              total = items.sumOf { it.usage.total },
              cost = items.sumOf(UsageRow::cost).roundedCents(),
              share = items.sumOf { it.usage.total }.toDouble() / totalTokens,
            )
          }
          .sortedByDescending(MemberContribution::total)

    return UsageSnapshot(
      summary = summarize(rows),
      daily = dailyTotals(rows, zoneId),
      models = breakdown(UsageRow::model),
      sources = breakdown(UsageRow::agent),
      members = members,
    )
  }

  private fun Double.roundedCents(): Double = round(this * 100.0) / 100.0
}
