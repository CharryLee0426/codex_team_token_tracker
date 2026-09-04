package dev.chenli.codextracker.data

import android.content.Context
import dev.chenli.codextracker.domain.Account
import dev.chenli.codextracker.domain.Device
import dev.chenli.codextracker.domain.HourlyResponse
import dev.chenli.codextracker.domain.LiveDevice
import dev.chenli.codextracker.domain.Member
import dev.chenli.codextracker.domain.Organization
import dev.chenli.codextracker.domain.QueryRange
import dev.chenli.codextracker.domain.UsageScope
import dev.chenli.codextracker.domain.UsageSession
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

sealed interface ViewerAuthState {
  data object Loading : ViewerAuthState

  data object SignedOut : ViewerAuthState

  data class SignedIn(val principalId: String) : ViewerAuthState
}

interface ViewerRepository {
  val isDemo: Boolean
  val referenceNow: Long?
  val authState: StateFlow<ViewerAuthState>
  val activeClerkOrgId: StateFlow<String?>

  suspend fun ensureUser()

  fun account(): Flow<Result<Account?>>

  fun organizations(): Flow<Result<List<Organization>>>

  suspend fun activateOrganization(clerkOrgId: String): Result<Organization>

  fun hourly(scope: UsageScope, orgId: String?, range: QueryRange): Flow<Result<HourlyResponse>>

  fun liveNow(scope: UsageScope, orgId: String?): Flow<Result<List<LiveDevice>>>

  fun recentSessions(scope: UsageScope, orgId: String?): Flow<Result<List<UsageSession>>>

  fun members(orgId: String?): Flow<Result<List<Member>>>

  fun devices(): Flow<Result<List<Device>>>

  suspend fun signOut(context: Context): Result<Unit>
}
