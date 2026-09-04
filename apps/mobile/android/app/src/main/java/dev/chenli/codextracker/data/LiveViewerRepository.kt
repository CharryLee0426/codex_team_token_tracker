package dev.chenli.codextracker.data

import android.content.Context
import com.clerk.api.Clerk
import com.clerk.api.network.serialization.ClerkResult
import dev.chenli.codextracker.domain.Account
import dev.chenli.codextracker.domain.Device
import dev.chenli.codextracker.domain.HourlyResponse
import dev.chenli.codextracker.domain.LiveDevice
import dev.chenli.codextracker.domain.Member
import dev.chenli.codextracker.domain.Organization
import dev.chenli.codextracker.domain.QueryRange
import dev.chenli.codextracker.domain.RangePlanner
import dev.chenli.codextracker.domain.UsageScope
import dev.chenli.codextracker.domain.UsageSession
import dev.convex.android.AuthState
import dev.convex.android.ConvexClientWithAuth
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.runningFold
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.withTimeoutOrNull

class LiveViewerRepository(private val convex: ConvexClientWithAuth<String>) : ViewerRepository {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

  override val isDemo = false
  override val referenceNow: Long? = null
  override val authState =
    combine(
      convex.authState,
      Clerk.userFlow,
      Clerk.sessionFlow,
      Clerk.isInitialized,
    ) { state, user, session, clerkInitialized ->
      val sessionUserId = session?.user?.id ?: session?.publicUserData?.userId
      val principalId =
        if (
          user != null &&
            session != null &&
            (sessionUserId == null || sessionUserId == user.id)
        ) {
          "${user.id}:${session.id}"
        } else {
          null
        }
      AuthObservation(state, principalId, clerkInitialized)
    }
      .projectViewerAuth()
      .stateIn(scope, SharingStarted.Eagerly, ViewerAuthState.Loading)
  override val activeClerkOrgId =
    Clerk.sessionFlow
      .map { session ->
        val activeSession = Clerk.activeSession
        activeSession
          ?.takeIf { it.id == session?.id }
          ?.lastActiveOrganizationId
      }
      .stateIn(scope, SharingStarted.Eagerly, null)

  override suspend fun ensureUser() {
    convex.mutation<String>("users:ensureUser")
  }

  override fun account(): Flow<Result<Account?>> =
    convex.subscribe<ConvexAccount?>("users:me").mapResult { it?.toDomain() }

  override fun organizations(): Flow<Result<List<Organization>>> =
    combine(Clerk.userFlow, Clerk.sessionFlow) { user, session ->
      val activeId = session?.lastActiveOrganizationId
      val organizations =
        user
          ?.organizationMemberships
          .orEmpty()
          .sortedByDescending { it.organization.id == activeId }
          .map { membership ->
            val organization = membership.organization
            Organization(
              id = organization.id,
              clerkOrgId = organization.id,
              name = organization.name,
              slug = organization.slug,
              imageUrl = organization.imageUrl,
              role = membership.role,
            )
          }
      Result.success(organizations)
    }

  override suspend fun activateOrganization(clerkOrgId: String): Result<Organization> =
    try {
      Result.success(
        organizationActivations.activate(clerkOrgId) {
          val session = Clerk.activeSession ?: error("No active Clerk session")
          val user = Clerk.activeUser ?: error("No active Clerk user")
          val membership =
            user.organizationMemberships
              .orEmpty()
              .firstOrNull { it.organization.id == clerkOrgId }
              ?: error("Organization membership is unavailable")
          requireCurrentClerkPrincipal(session.id, user.id)

          when (
            val activated =
              Clerk.auth.setActive(
                sessionId = session.id,
                organizationId = clerkOrgId,
              )
          ) {
            is ClerkResult.Success ->
              check(
                activated.value.id == session.id &&
                  activated.value.lastActiveOrganizationId == clerkOrgId
              ) {
                "Clerk did not activate the requested organization"
              }
            is ClerkResult.Failure ->
              throw activated.throwable ?: IllegalStateException("Could not activate organization")
          }
          checkpointRequest()

          val updatedSession =
            withTimeoutOrNull(10_000) {
              Clerk.sessionFlow.first { updated ->
                updated?.id == session.id && updated.lastActiveOrganizationId == clerkOrgId
              }
            } ?: error("Timed out while activating organization")
          check(updatedSession.id == session.id)
          requireCurrentClerkAuthority(session.id, user.id)

          convex.loginFromCache().getOrThrow()
          requireCurrentClerkAuthority(session.id, user.id)

          val clerkOrganization = membership.organization
          val ensureArgs =
            buildMap<String, Any?> {
              put("clerkOrgId", clerkOrgId)
              put("name", clerkOrganization.name)
              clerkOrganization.slug?.let { put("slug", it) }
              clerkOrganization.imageUrl.takeIf(String::isNotBlank)?.let { put("imageUrl", it) }
            }
          convex.mutation<String>("orgs:ensureCurrentOrg", ensureArgs)
          requireCurrentClerkAuthority(session.id, user.id)

          val mirrored =
            convex
              .subscribe<ConvexBackendOrganization?>(
                "orgs:byClerkId",
                mapOf("clerkOrgId" to clerkOrgId),
              )
              .first()
              .getOrThrow()
              ?: error("Active organization is not available to Convex")
          requireCurrentClerkAuthority(session.id, user.id)
          mirrored.toDomain(clerkOrgId)
        }
      )
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (error: Throwable) {
      Result.failure(error)
    }

  override fun hourly(
    scope: UsageScope,
    orgId: String?,
    range: QueryRange,
  ): Flow<Result<HourlyResponse>> {
    val subscriptions =
      RangePlanner.chunks(range.from, range.to).map { chunk ->
        convex
          .subscribe<ConvexHourlyResponse>(
            "usage:hourly",
            LiveQueryArguments.hourly(scope, orgId, chunk),
          )
          .mapResult(ConvexHourlyResponse::toDomain)
      }
    if (subscriptions.isEmpty()) return flowOf(Result.success(HourlyResponse(emptyList(), emptyList())))
    return combine(subscriptions) { results ->
      val failure = results.firstNotNullOfOrNull { it.exceptionOrNull() }
      if (failure != null) Result.failure(failure)
      else {
        val responses = results.map { it.getOrThrow() }
        Result.success(
          HourlyResponse(
            rows = responses.flatMap(HourlyResponse::rows).sortedBy { it.h },
            users = responses.flatMap(HourlyResponse::users).distinctBy { it.id },
          )
        )
      }
    }
  }

  override fun liveNow(scope: UsageScope, orgId: String?): Flow<Result<List<LiveDevice>>> =
    convex
      .subscribe<List<ConvexLiveDevice>>("usage:liveNow", LiveQueryArguments.scoped(scope, orgId))
      .mapResult { devices -> devices.map(ConvexLiveDevice::toDomain) }

  override fun recentSessions(
    scope: UsageScope,
    orgId: String?,
  ): Flow<Result<List<UsageSession>>> =
    convex
      .subscribe<List<ConvexUsageSession>>(
        "usage:recentSessions",
        LiveQueryArguments.recentSessions(scope, orgId, limit = 12),
      )
      .mapResult { sessions -> sessions.map(ConvexUsageSession::toDomain) }

  override fun members(orgId: String?): Flow<Result<List<Member>>> =
    if (orgId == null) flowOf(Result.success(emptyList()))
    else {
      convex
        .subscribe<List<ConvexMember>>("orgs:members", mapOf("orgId" to orgId))
        .mapResult { members -> members.map(ConvexMember::toDomain) }
    }

  override fun devices(): Flow<Result<List<Device>>> =
    convex
      .subscribe<List<ConvexDevice>>("usage:myDevices")
      .mapResult { devices -> devices.map(ConvexDevice::toDomain) }

  override suspend fun signOut(context: Context): Result<Unit> {
    organizationActivations.invalidate()
    val result = convex.logout(context)
    return result.exceptionOrNull()?.let(Result.Companion::failure) ?: Result.success(Unit)
  }

  private fun OrganizationActivationScope.requireCurrentClerkPrincipal(
    sessionId: String,
    userId: String,
  ) {
    checkpointRequest()
    val activeSession = Clerk.activeSession
    val activeUser = Clerk.activeUser
    check(
      activeSession != null &&
        activeUser != null &&
        activeSession.id == sessionId &&
        activeUser.id == userId &&
        activeUser.organizationMemberships.orEmpty().any {
          it.organization.id == requestedClerkOrgId
        }
    ) {
      "Clerk organization authority is unavailable"
    }
  }

  private fun OrganizationActivationScope.requireCurrentClerkAuthority(
    sessionId: String,
    userId: String,
  ) {
    requireCurrentClerkPrincipal(sessionId, userId)
    checkpoint(Clerk.activeSession?.lastActiveOrganizationId)
  }

  private companion object {
    val organizationActivations = OrganizationActivationCoordinator()
  }
}

private fun <Wire, Domain> Flow<Result<Wire>>.mapResult(
  transform: (Wire) -> Domain
): Flow<Result<Domain>> = map { result -> result.map(transform) }

internal data class AuthObservation(
  val state: AuthState<String>,
  val principalId: String?,
  val clerkInitialized: Boolean,
)

internal data class AuthProjection(
  val token: String? = null,
  val principalId: String? = null,
  val viewerState: ViewerAuthState = ViewerAuthState.Loading,
)

internal fun Flow<AuthObservation>.projectViewerAuth(): Flow<ViewerAuthState> =
  runningFold(AuthProjection()) { previous, observation ->
      when (val state = observation.state) {
        is AuthState.AuthLoading -> {
          val sameSignedInPrincipal =
            observation.principalId != null &&
              observation.principalId == previous.principalId &&
              previous.viewerState is ViewerAuthState.SignedIn
          previous.copy(
            viewerState =
              if (sameSignedInPrincipal) ViewerAuthState.SignedIn(observation.principalId)
              else ViewerAuthState.Loading
          )
        }
        is AuthState.Authenticated -> {
          val principalId = observation.principalId
          when {
            principalId == null ->
              previous.copy(token = state.userInfo, viewerState = ViewerAuthState.Loading)
            previous.principalId == null ||
              previous.principalId == principalId ||
              previous.token != state.userInfo ->
              AuthProjection(
                token = state.userInfo,
                principalId = principalId,
                viewerState = ViewerAuthState.SignedIn(principalId),
              )
            else -> previous.copy(viewerState = ViewerAuthState.Loading)
          }
        }
        is AuthState.Unauthenticated ->
          AuthProjection(
            viewerState =
              if (observation.clerkInitialized && observation.principalId == null) {
                ViewerAuthState.SignedOut
              }
              else ViewerAuthState.Loading,
          )
      }
    }
    .map { projection -> projection.viewerState }
