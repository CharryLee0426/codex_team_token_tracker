package dev.chenli.codextracker.data

import dev.chenli.codextracker.domain.Account
import dev.chenli.codextracker.domain.CompactHourRow
import dev.chenli.codextracker.domain.CompactModelUsage
import dev.chenli.codextracker.domain.Device
import dev.chenli.codextracker.domain.HourlyResponse
import dev.chenli.codextracker.domain.LiveDevice
import dev.chenli.codextracker.domain.LiveSnapshot
import dev.chenli.codextracker.domain.Member
import dev.chenli.codextracker.domain.Organization
import dev.chenli.codextracker.domain.PublicUser
import dev.chenli.codextracker.domain.QueryRange
import dev.chenli.codextracker.domain.UsageScope
import dev.chenli.codextracker.domain.UsageSession
import dev.convex.android.Float64
import kotlinx.serialization.Serializable

private const val MaxSafeInteger = 9_007_199_254_740_991.0

internal fun Double.toDomainLong(field: String): Long {
  require(isFinite()) { "$field must be finite" }
  require(this >= 0.0) { "$field must be non-negative" }
  require(this <= MaxSafeInteger) { "$field exceeds the exact JavaScript integer range" }
  require(this % 1.0 == 0.0) { "$field must be a whole number" }
  return toLong()
}

internal fun Double.toDomainInt(field: String): Int {
  val value = toDomainLong(field)
  require(value <= Int.MAX_VALUE) { "$field exceeds the Int range" }
  return value.toInt()
}

private fun Double.toDomainMeasure(field: String): Double {
  require(isFinite()) { "$field must be finite" }
  require(this >= 0.0) { "$field must be non-negative" }
  return this
}

private fun Long.toConvexNumber(field: String): Double {
  require(toDouble() in -MaxSafeInteger..MaxSafeInteger) {
    "$field exceeds the exact JavaScript integer range"
  }
  return toDouble()
}

internal object LiveQueryArguments {
  fun hourly(
    scope: UsageScope,
    orgId: String?,
    range: QueryRange,
  ): Map<String, Any?> =
    scoped(scope, orgId) +
      mapOf(
        "from" to range.from.toConvexNumber("from"),
        "to" to range.to.toConvexNumber("to"),
      )

  fun recentSessions(
    scope: UsageScope,
    orgId: String?,
    limit: Int,
  ): Map<String, Any?> {
    require(limit in 1..100) { "limit must be between 1 and 100" }
    return scoped(scope, orgId) + mapOf("limit" to limit.toDouble())
  }

  fun scoped(scope: UsageScope, orgId: String?): Map<String, Any?> =
    buildMap {
      put("scope", scope.name.lowercase())
      if (scope == UsageScope.Team && orgId != null) put("orgId", orgId)
    }
}

@Serializable
internal data class ConvexAccount(
  val id: String,
  val name: String? = null,
  val email: String? = null,
  val imageUrl: String? = null,
  val onboardedAt: Float64? = null,
) {
  fun toDomain() =
    Account(
      id = id,
      name = name,
      email = email,
      imageUrl = imageUrl,
      onboardedAt = onboardedAt?.toDomainLong("account.onboardedAt"),
    )
}

@Serializable
internal data class ConvexCompactModelUsage(
  val model: String,
  val agent: String? = null,
  val i: Float64,
  val c: Float64,
  val w: Float64,
  val o: Float64,
  val r: Float64,
  val t: Float64,
  val q: Float64,
  val usd: Float64,
) {
  fun toDomain() =
    CompactModelUsage(
      model = model,
      agent = agent,
      i = i.toDomainLong("model.i"),
      c = c.toDomainLong("model.c"),
      w = w.toDomainLong("model.w"),
      o = o.toDomainLong("model.o"),
      r = r.toDomainLong("model.r"),
      t = t.toDomainLong("model.t"),
      q = q.toDomainLong("model.q"),
      usd = usd.toDomainMeasure("model.usd"),
    )
}

@Serializable
internal data class ConvexCompactHourRow(
  val h: Float64,
  val u: String,
  val d: String,
  val i: Float64,
  val c: Float64,
  val w: Float64,
  val o: Float64,
  val r: Float64,
  val t: Float64,
  val q: Float64,
  val usd: Float64,
  val m: List<ConvexCompactModelUsage>,
) {
  fun toDomain() =
    CompactHourRow(
      h = h.toDomainLong("hour.h"),
      u = u,
      d = d,
      i = i.toDomainLong("hour.i"),
      c = c.toDomainLong("hour.c"),
      w = w.toDomainLong("hour.w"),
      o = o.toDomainLong("hour.o"),
      r = r.toDomainLong("hour.r"),
      t = t.toDomainLong("hour.t"),
      q = q.toDomainLong("hour.q"),
      usd = usd.toDomainMeasure("hour.usd"),
      m = m.map(ConvexCompactModelUsage::toDomain),
    )
}

@Serializable
internal data class ConvexHourlyResponse(
  val rows: List<ConvexCompactHourRow>,
  val users: List<PublicUser>,
) {
  fun toDomain() = HourlyResponse(rows.map(ConvexCompactHourRow::toDomain), users)
}

@Serializable
internal data class ConvexLiveSnapshot(
  val sessionId: String? = null,
  val model: String? = null,
  val tokensPerSecond: Float64,
  val lastEventAt: Float64? = null,
  val todayTotal: Float64,
  val todayCost: Float64,
  val updatedAt: Float64,
) {
  fun toDomain() =
    LiveSnapshot(
      sessionId = sessionId,
      model = model,
      tokensPerSecond = tokensPerSecond.toDomainMeasure("live.tokensPerSecond"),
      lastEventAt = lastEventAt?.toDomainLong("live.lastEventAt"),
      todayTotal = todayTotal.toDomainLong("live.todayTotal"),
      todayCost = todayCost.toDomainMeasure("live.todayCost"),
      updatedAt = updatedAt.toDomainLong("live.updatedAt"),
    )
}

@Serializable
internal data class ConvexUsageSession(
  val id: String,
  val user: PublicUser,
  val deviceId: String,
  val sessionId: String,
  val agent: String,
  val model: String,
  val projectName: String? = null,
  val startedAt: Float64,
  val lastActivityAt: Float64,
  val input: Float64,
  val cached: Float64,
  val cacheWrite: Float64,
  val output: Float64,
  val reasoning: Float64,
  val total: Float64,
  val requests: Float64,
  val cost: Float64,
  val source: String? = null,
  val cliVersion: String? = null,
) {
  fun toDomain() =
    UsageSession(
      id = id,
      user = user,
      deviceId = deviceId,
      sessionId = sessionId,
      agent = agent,
      model = model,
      projectName = projectName,
      startedAt = startedAt.toDomainLong("session.startedAt"),
      lastActivityAt = lastActivityAt.toDomainLong("session.lastActivityAt"),
      input = input.toDomainLong("session.input"),
      cached = cached.toDomainLong("session.cached"),
      cacheWrite = cacheWrite.toDomainLong("session.cacheWrite"),
      output = output.toDomainLong("session.output"),
      reasoning = reasoning.toDomainLong("session.reasoning"),
      total = total.toDomainLong("session.total"),
      requests = requests.toDomainLong("session.requests"),
      cost = cost.toDomainMeasure("session.cost"),
      source = source,
      cliVersion = cliVersion,
    )
}

@Serializable
internal data class ConvexMember(
  val id: String,
  val name: String? = null,
  val email: String? = null,
  val imageUrl: String? = null,
  val role: String,
  val joinedAt: Float64,
  val deviceCount: Float64,
  val lastSeenAt: Float64? = null,
  val live: ConvexLiveSnapshot? = null,
) {
  fun toDomain() =
    Member(
      id = id,
      name = name,
      email = email,
      imageUrl = imageUrl,
      role = role,
      joinedAt = joinedAt.toDomainLong("member.joinedAt"),
      deviceCount = deviceCount.toDomainInt("member.deviceCount"),
      lastSeenAt = lastSeenAt?.toDomainLong("member.lastSeenAt"),
      live = live?.toDomain(),
    )
}

@Serializable
internal data class ConvexDevice(
  val id: String,
  val name: String,
  val platform: String,
  val hostname: String? = null,
  val appVersion: String? = null,
  val timezone: String? = null,
  val createdAt: Float64,
  val lastSeenAt: Float64,
  val live: ConvexLiveSnapshot? = null,
  val logins: Float64,
) {
  fun toDomain() =
    Device(
      id = id,
      name = name,
      platform = platform,
      hostname = hostname,
      appVersion = appVersion,
      timezone = timezone,
      createdAt = createdAt.toDomainLong("device.createdAt"),
      lastSeenAt = lastSeenAt.toDomainLong("device.lastSeenAt"),
      live = live?.toDomain(),
      logins = logins.toDomainInt("device.logins"),
    )
}

@Serializable
internal data class ConvexLiveDevice(
  val user: PublicUser,
  val deviceId: String,
  val deviceName: String,
  val platform: String,
  val live: ConvexLiveSnapshot,
) {
  fun toDomain() =
    LiveDevice(
      user = user,
      deviceId = deviceId,
      deviceName = deviceName,
      platform = platform,
      live = live.toDomain(),
    )
}

@Serializable
internal data class ConvexBackendOrganization(
  val id: String,
  val name: String,
  val slug: String? = null,
  val imageUrl: String? = null,
  val role: String,
  val memberCount: Float64,
) {
  fun toDomain(clerkOrgId: String): Organization {
    memberCount.toDomainInt("organization.memberCount")
    return Organization(
      id = id,
      clerkOrgId = clerkOrgId,
      name = name,
      slug = slug,
      imageUrl = imageUrl,
      role = role,
    )
  }
}
