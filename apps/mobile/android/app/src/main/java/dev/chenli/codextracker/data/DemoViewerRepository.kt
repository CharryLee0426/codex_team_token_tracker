package dev.chenli.codextracker.data

import android.content.Context
import dev.chenli.codextracker.domain.Account
import dev.chenli.codextracker.domain.DemoFixture
import dev.chenli.codextracker.domain.Device
import dev.chenli.codextracker.domain.HourlyResponse
import dev.chenli.codextracker.domain.LiveDevice
import dev.chenli.codextracker.domain.Member
import dev.chenli.codextracker.domain.Organization
import dev.chenli.codextracker.domain.QueryRange
import dev.chenli.codextracker.domain.UsageAggregator
import dev.chenli.codextracker.domain.UsageScope
import dev.chenli.codextracker.domain.UsageSession
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf

class DemoViewerRepository(private val fixture: DemoFixture) : ViewerRepository {
  override val isDemo = true
  override val referenceNow = fixture.now
  override val authState = MutableStateFlow(ViewerAuthState.SignedIn("demo-user"))
  override val activeClerkOrgId =
    MutableStateFlow(fixture.organizations.firstOrNull()?.clerkOrgId)
  private val currentUserId = fixture.users.firstOrNull()?.id

  override suspend fun ensureUser() = Unit

  override fun account(): Flow<Result<Account?>> =
    flowOf(
      Result.success(
        fixture.users.firstOrNull()?.let { Account(it.id, it.name, it.email, it.imageUrl) }
      )
    )

  override fun organizations(): Flow<Result<List<Organization>>> =
    flowOf(Result.success(fixture.organizations))

  override suspend fun activateOrganization(clerkOrgId: String): Result<Organization> =
    fixture.organizations.firstOrNull { it.clerkOrgId == clerkOrgId }
      ?.let(Result.Companion::success)
      ?: Result.failure(IllegalArgumentException("Organization is unavailable"))

  override fun hourly(
    scope: UsageScope,
    orgId: String?,
    range: QueryRange,
  ): Flow<Result<HourlyResponse>> {
    val rows =
      fixture.rows.filter { row ->
        row.h >= range.from &&
          row.h < range.to &&
          (scope == UsageScope.Team || row.u == currentUserId)
      }
    val userIds = rows.mapTo(mutableSetOf()) { it.u }
    return flowOf(Result.success(HourlyResponse(rows, fixture.users.filter { it.id in userIds })))
  }

  override fun liveNow(scope: UsageScope, orgId: String?): Flow<Result<List<LiveDevice>>> =
    flowOf(
      Result.success(
        fixture.live.filter { scope == UsageScope.Team || it.user.id == currentUserId }
      )
    )

  override fun recentSessions(
    scope: UsageScope,
    orgId: String?,
  ): Flow<Result<List<UsageSession>>> =
    flowOf(
      Result.success(
        fixture.sessions.filter {
          UsageAggregator.isOpenAIModel(it.model) &&
            (scope == UsageScope.Team || it.user.id == currentUserId)
        }
      )
    )

  override fun members(orgId: String?): Flow<Result<List<Member>>> =
    flowOf(Result.success(fixture.members))

  override fun devices(): Flow<Result<List<Device>>> = flowOf(Result.success(fixture.devices))

  override suspend fun signOut(context: Context): Result<Unit> = Result.success(Unit)
}
