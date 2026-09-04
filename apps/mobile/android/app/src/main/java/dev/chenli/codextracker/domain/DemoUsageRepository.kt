package dev.chenli.codextracker.domain

import java.time.ZoneId
import kotlinx.serialization.json.Json

object DemoFixtureLoader {
  private val json = Json { ignoreUnknownKeys = true }

  fun decode(contents: String): DemoFixture = json.decodeFromString(contents)
}

class DemoUsageRepository private constructor(
  private val fixture: DemoFixture,
  private val zoneId: ZoneId,
) {
  fun currentData(): DemoFixture = fixture

  fun snapshot(scope: UsageScope, range: UsageRange): UsageSnapshot {
    val bounds = RangePlanner.bounds(range, fixture.now, zoneId)
    val currentUserId = fixture.users.firstOrNull()?.id
    val rows =
      UsageAggregator
        .codexRows(UsageAggregator.expandCompactRows(fixture.rows))
        .filter { it.hourStart >= bounds.from && it.hourStart < bounds.to }
        .filter { scope == UsageScope.Team || it.userId == currentUserId }
    return UsageAggregator.snapshot(
      rows = rows,
      users = fixture.users,
      zoneId = zoneId,
      includeMembers = scope == UsageScope.Team,
    )
  }

  companion object {
    fun fromJson(contents: String, zoneId: ZoneId = ZoneId.systemDefault()) =
      DemoUsageRepository(DemoFixtureLoader.decode(contents), zoneId)
  }
}
