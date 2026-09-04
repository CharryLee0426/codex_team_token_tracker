package dev.chenli.codextracker.domain

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UsageAggregatorTest {
  private val fixtureJson =
    checkNotNull(javaClass.classLoader?.getResource("dashboard-demo.json"))
      .readText()
  private val fixture = DemoFixtureLoader.decode(fixtureJson)

  @Test
  fun `compact rows expand model entries and preserve unknown fallback totals`() {
    val expanded = UsageAggregator.expandCompactRows(fixture.rows)

    assertEquals(7, expanded.size)
    val fallback = expanded.single { it.model == "unknown" }
    assertEquals(40_000L, fallback.usage.input)
    assertEquals("codex", fallback.agent)
  }

  @Test
  fun `Codex filter keeps OpenAI and unknown models but drops other providers`() {
    val filtered = UsageAggregator.codexRows(UsageAggregator.expandCompactRows(fixture.rows))

    assertEquals(6, filtered.size)
    assertTrue(filtered.none { it.model.startsWith("claude") })
    assertTrue(filtered.any { it.model == "unknown" })
    assertTrue(filtered.any { it.model.startsWith("openai/") })
  }

  @Test
  fun `fixture summaries match dashboard personal and team expectations`() {
    val rows = UsageAggregator.codexRows(UsageAggregator.expandCompactRows(fixture.rows))
    val personal = UsageAggregator.summarize(rows.filter { it.userId == "user-alex" })
    val team = UsageAggregator.summarize(rows)

    assertEquals(fixture.expected.personal.toSummary(), personal)
    assertEquals(fixture.expected.team.toSummary(), team)
    assertEquals(310_000.0 / 495_000.0, personal.cacheHitRate, 0.000_001)
  }

  @Test
  fun `daily grouping converts UTC hours at the local calendar boundary`() {
    val source = UsageAggregator.expandCompactRows(fixture.rows).first()
    val hour = Instant.parse("2026-09-04T01:00:00Z").toEpochMilli()

    val daily =
      UsageAggregator.dailyTotals(
        listOf(source.copy(hourStart = hour)),
        ZoneId.of("America/Los_Angeles"),
      )

    assertEquals(LocalDate.of(2026, 9, 3), daily.single().date)
  }

  @Test
  fun `range planner emits contiguous chunks no longer than sixty days`() {
    val from = Instant.parse("2026-01-01T00:00:00Z").toEpochMilli()
    val to = Instant.parse("2026-05-06T00:00:00Z").toEpochMilli()

    val chunks = RangePlanner.chunks(from, to)

    assertEquals(3, chunks.size)
    assertEquals(from, chunks.first().from)
    assertEquals(to, chunks.last().to)
    assertTrue(chunks.zipWithNext().all { (left, right) -> left.to == right.from })
    assertTrue(chunks.all { Duration.ofMillis(it.to - it.from).toDays() <= 60 })
  }

  @Test
  fun `demo repository returns deterministic thirty day snapshots`() {
    val first = DemoUsageRepository.fromJson(fixtureJson, ZoneId.of("UTC"))
    val second = DemoUsageRepository.fromJson(fixtureJson, ZoneId.of("UTC"))

    assertEquals(first.currentData(), second.currentData())
    assertEquals(
      fixture.expected.personal.toSummary(),
      first.snapshot(UsageScope.Personal, UsageRange.ThirtyDays).summary,
    )
  }
}
