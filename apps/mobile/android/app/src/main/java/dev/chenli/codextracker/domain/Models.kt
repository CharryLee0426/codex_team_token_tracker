package dev.chenli.codextracker.domain

import java.time.LocalDate
import kotlinx.serialization.Serializable

@Serializable
data class DemoFixture(
  val now: Long,
  val expected: ExpectedSnapshots,
  val users: List<PublicUser>,
  val organizations: List<Organization>,
  val rows: List<CompactHourRow>,
  val sessions: List<UsageSession>,
  val members: List<Member>,
  val devices: List<Device>,
  val live: List<LiveDevice>,
)

@Serializable data class ExpectedSnapshots(val personal: ExpectedSummary, val team: ExpectedSummary)

@Serializable
data class ExpectedSummary(
  val input: Long,
  val cached: Long,
  val cacheWrite: Long,
  val output: Long,
  val reasoning: Long,
  val total: Long,
  val requests: Long,
  val cost: Double,
  val activeUsers: Int,
  val models: Int,
)

fun ExpectedSummary.toSummary() =
  UsageSummary(
    usage = TokenUsage(input, cached, cacheWrite, output, reasoning, total, requests),
    cost = cost,
    cacheHitRate = if (input == 0L) 0.0 else (cached.toDouble() / input).coerceIn(0.0, 1.0),
    activeUsers = activeUsers,
    models = models,
  )

@Serializable
data class PublicUser(
  val id: String,
  val name: String? = null,
  val email: String? = null,
  val imageUrl: String? = null,
)

@Serializable
data class Account(
  val id: String,
  val name: String? = null,
  val email: String? = null,
  val imageUrl: String? = null,
  val onboardedAt: Long? = null,
)

@Serializable
data class Organization(
  val id: String,
  val clerkOrgId: String,
  val name: String,
  val slug: String? = null,
  val imageUrl: String? = null,
  val role: String,
)

@Serializable
data class CompactModelUsage(
  val model: String,
  val agent: String? = null,
  val i: Long,
  val c: Long,
  val w: Long,
  val o: Long,
  val r: Long,
  val t: Long,
  val q: Long,
  val usd: Double,
)

@Serializable
data class CompactHourRow(
  val h: Long,
  val u: String,
  val d: String,
  val i: Long,
  val c: Long,
  val w: Long,
  val o: Long,
  val r: Long,
  val t: Long,
  val q: Long,
  val usd: Double,
  val m: List<CompactModelUsage>,
)

@Serializable data class HourlyResponse(val rows: List<CompactHourRow>, val users: List<PublicUser>)

@Serializable
data class LiveSnapshot(
  val sessionId: String? = null,
  val model: String? = null,
  val tokensPerSecond: Double,
  val lastEventAt: Long? = null,
  val todayTotal: Long,
  val todayCost: Double,
  val updatedAt: Long,
)

@Serializable
data class UsageSession(
  val id: String,
  val user: PublicUser,
  val deviceId: String,
  val sessionId: String,
  val agent: String,
  val model: String,
  val projectName: String? = null,
  val startedAt: Long,
  val lastActivityAt: Long,
  val input: Long,
  val cached: Long,
  val cacheWrite: Long,
  val output: Long,
  val reasoning: Long,
  val total: Long,
  val requests: Long,
  val cost: Double,
  val source: String? = null,
  val cliVersion: String? = null,
)

@Serializable
data class Member(
  val id: String,
  val name: String? = null,
  val email: String? = null,
  val imageUrl: String? = null,
  val role: String,
  val joinedAt: Long,
  val deviceCount: Int,
  val lastSeenAt: Long? = null,
  val live: LiveSnapshot? = null,
)

@Serializable
data class Device(
  val id: String,
  val name: String,
  val platform: String,
  val hostname: String? = null,
  val appVersion: String? = null,
  val timezone: String? = null,
  val createdAt: Long,
  val lastSeenAt: Long,
  val live: LiveSnapshot? = null,
  val logins: Int,
)

@Serializable
data class LiveDevice(
  val user: PublicUser,
  val deviceId: String,
  val deviceName: String,
  val platform: String,
  val live: LiveSnapshot,
)

data class TokenUsage(
  val input: Long = 0,
  val cached: Long = 0,
  val cacheWrite: Long = 0,
  val output: Long = 0,
  val reasoning: Long = 0,
  val total: Long = 0,
  val requests: Long = 0,
) {
  operator fun plus(other: TokenUsage) =
    TokenUsage(
      input + other.input,
      cached + other.cached,
      cacheWrite + other.cacheWrite,
      output + other.output,
      reasoning + other.reasoning,
      total + other.total,
      requests + other.requests,
    )
}

data class UsageRow(
  val hourStart: Long,
  val model: String,
  val agent: String,
  val userId: String,
  val deviceId: String,
  val cost: Double,
  val usage: TokenUsage,
)

data class UsageSummary(
  val usage: TokenUsage,
  val cost: Double,
  val cacheHitRate: Double,
  val activeUsers: Int,
  val models: Int,
)

data class DailyUsage(val date: LocalDate, val total: Long, val cost: Double)

data class UsageBreakdown(
  val name: String,
  val usage: TokenUsage,
  val cost: Double,
  val share: Double,
)

data class MemberContribution(
  val user: PublicUser,
  val total: Long,
  val cost: Double,
  val share: Double,
)

data class UsageSnapshot(
  val summary: UsageSummary,
  val daily: List<DailyUsage>,
  val models: List<UsageBreakdown>,
  val sources: List<UsageBreakdown>,
  val members: List<MemberContribution>,
)

enum class UsageScope { Personal, Team }

enum class UsageRange(val days: Int) {
  Today(1),
  SevenDays(7),
  ThirtyDays(30),
  NinetyDays(90),
}

data class QueryRange(val from: Long, val to: Long)
