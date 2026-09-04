package dev.chenli.codextracker.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.chenli.codextracker.data.ViewerAuthState
import dev.chenli.codextracker.data.ViewerRepository
import dev.chenli.codextracker.domain.Account
import dev.chenli.codextracker.domain.Device
import dev.chenli.codextracker.domain.LiveDevice
import dev.chenli.codextracker.domain.LiveFreshness
import dev.chenli.codextracker.domain.Member
import dev.chenli.codextracker.domain.Organization
import dev.chenli.codextracker.domain.QueryRefreshKey
import dev.chenli.codextracker.domain.RangePlanner
import dev.chenli.codextracker.domain.SystemViewerClock
import dev.chenli.codextracker.domain.UsageAggregator
import dev.chenli.codextracker.domain.UsageRange
import dev.chenli.codextracker.domain.UsageScope
import dev.chenli.codextracker.domain.UsageSession
import dev.chenli.codextracker.domain.UsageSnapshot
import dev.chenli.codextracker.domain.ViewerClock
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DashboardData(
  val snapshot: UsageSnapshot,
  val sessions: List<UsageSession>,
  val live: List<LiveDevice>,
)

data class Loadable<out T>(
  val data: T? = null,
  val loading: Boolean = true,
  val error: String? = null,
) {
  val stale: Boolean get() = data != null && error != null
}

data class MainUiState(
  val range: UsageRange = UsageRange.ThirtyDays,
  val account: Loadable<Account?> = Loadable(),
  val organizations: Loadable<List<Organization>> = Loadable(),
  val selectedClerkOrgId: String? = null,
  val selectedOrgId: String? = null,
  val personal: Loadable<DashboardData> = Loadable(),
  val team: Loadable<DashboardData> = Loadable(),
  val members: Loadable<List<Member>> = Loadable(),
  val devices: Loadable<List<Device>> = Loadable(),
)

private data class QueryMoment(val now: Long, val key: QueryRefreshKey)

private data class DashboardSelection(
  val range: UsageRange,
  val orgId: String?,
  val queryMoment: QueryMoment,
)

private data class OrganizationObservation(
  val result: Result<List<Organization>>,
  val activeClerkOrgId: String?,
)

private data class FreshnessObservation<T>(val result: Result<T>, val now: Long)

@OptIn(ExperimentalCoroutinesApi::class)
class MainViewModel(
  private val repository: ViewerRepository,
  private val zoneId: ZoneId = ZoneId.systemDefault(),
  private val clock: ViewerClock = SystemViewerClock(),
) : ViewModel() {
  private val range = MutableStateFlow(UsageRange.ThirtyDays)
  private val selectedOrgId = MutableStateFlow<String?>(null)
  private var activePrincipalId: String? = null
  private var sessionGeneration = 0L
  private var sessionJob: Job? = null
  private var organizationActivationJob: Job? = null
  private var pendingClerkOrgId: String? = null
  private var organizationMemberships: List<Organization> = emptyList()
  private var currentActiveClerkOrgId: String? = null
  val uiState = MutableStateFlow(MainUiState())

  init {
    viewModelScope.launch {
      repository.authState.collect { authState ->
        val principalId = activePrincipalId ?: return@collect
        if (authState != ViewerAuthState.SignedIn(principalId)) endSession(principalId)
      }
    }
  }

  fun beginSession(principalId: String) {
    require(principalId.isNotBlank())
    if (!hasPrincipalAuthority(principalId)) {
      endSession()
      return
    }
    if (activePrincipalId == principalId && sessionJob?.isActive == true) return

    endSession()
    activePrincipalId = principalId
    val generation = sessionGeneration
    sessionJob =
      viewModelScope.launch {
        try {
          repository.ensureUser()
          if (isCurrentSession(generation, principalId)) {
            observeRepository(generation, principalId)
          }
        } catch (cancelled: CancellationException) {
          throw cancelled
        } catch (error: Throwable) {
          if (isCurrentSession(generation, principalId)) setFatalError(error)
        }
      }
  }

  fun endSession(expectedPrincipalId: String? = null) {
    if (expectedPrincipalId != null && activePrincipalId != expectedPrincipalId) return
    activePrincipalId = null
    sessionGeneration += 1
    organizationActivationJob?.cancel()
    organizationActivationJob = null
    pendingClerkOrgId = null
    organizationMemberships = emptyList()
    currentActiveClerkOrgId = null
    sessionJob?.cancel()
    sessionJob = null
    range.value = UsageRange.ThirtyDays
    selectedOrgId.value = null
    uiState.value = MainUiState()
  }

  fun selectRange(value: UsageRange) {
    range.value = value
    uiState.update { it.copy(range = value) }
  }

  fun selectOrganization(id: String) {
    if (activePrincipalId == null) return
    if (organizationMemberships.none { it.clerkOrgId == id }) return
    if (
      id == uiState.value.selectedClerkOrgId &&
        selectedOrgId.value != null &&
        hasOrganizationAuthority(id)
    ) {
      return
    }
    val generation = sessionGeneration
    val principalId = activePrincipalId ?: return
    organizationActivationJob?.cancel()
    pendingClerkOrgId = id
    clearResolvedOrganization(selectedClerkOrgId = id, loading = true)
    organizationActivationJob =
      viewModelScope.launch {
        repository.activateOrganization(id).fold(
          onSuccess = { organization ->
            if (
              !isCurrentSession(generation, principalId) ||
                pendingClerkOrgId != id ||
                uiState.value.selectedClerkOrgId != id
            ) {
              return@fold
            }
            pendingClerkOrgId = null
            if (!hasOrganizationAuthority(id)) {
              clearResolvedOrganization(selectedClerkOrgId = id, loading = false)
              return@fold
            }
            selectedOrgId.value = organization.id
            uiState.update { state -> state.copy(selectedOrgId = organization.id) }
          },
          onFailure = { error ->
            if (
              !isCurrentSession(generation, principalId) ||
                pendingClerkOrgId != id ||
                uiState.value.selectedClerkOrgId != id
            ) {
              return@fold
            }
            pendingClerkOrgId = null
            val unavailable = Loadable<DashboardData>(loading = false, error = error.message)
            uiState.update { state ->
              state.copy(
                team = unavailable,
                members = Loadable(loading = false, error = error.message),
              )
            }
          },
        )
      }
  }

  fun signOut(context: Context) {
    if (repository.isDemo) return
    val principalId = activePrincipalId ?: return
    endSession(principalId)
    viewModelScope.launch {
      repository.signOut(context).onFailure {
        val currentAuth = repository.authState.value
        if (currentAuth is ViewerAuthState.SignedIn) beginSession(currentAuth.principalId)
      }
    }
  }

  override fun onCleared() {
    endSession()
    super.onCleared()
  }

  private suspend fun observeRepository(generation: Long, principalId: String) =
    coroutineScope {
      val initialNow = effectiveNow(clock.nowMillis())
      val now =
        clock.ticks
          .map(::effectiveNow)
          .distinctUntilChanged()
          .stateIn(this, SharingStarted.Eagerly, initialNow)

      launch { observeAccount(generation, principalId) }
      launch { observeOrganizations(generation, principalId) }
      launch { observeDashboard(UsageScope.Personal, now, generation, principalId) }
      launch { observeDashboard(UsageScope.Team, now, generation, principalId) }
      launch { observeMembers(now, generation, principalId) }
      launch { observeDevices(now, generation, principalId) }
    }

  private suspend fun observeAccount(generation: Long, principalId: String) {
    repository.account().collect { result ->
      if (!isCurrentSession(generation, principalId)) return@collect
      updateLoadable(uiState.value.account, result) { value ->
        uiState.update { it.copy(account = value) }
      }
    }
  }

  private suspend fun observeOrganizations(generation: Long, principalId: String) {
    combine(repository.organizations(), repository.activeClerkOrgId) { result, activeClerkOrgId ->
      OrganizationObservation(result, activeClerkOrgId)
    }
      .collect { observation ->
        if (!isCurrentSession(generation, principalId)) return@collect
        currentActiveClerkOrgId = observation.activeClerkOrgId
        observation.result.fold(
          onSuccess = { organizations ->
            organizationMemberships = organizations
            reconcileOrganizationAuthority()
          },
          onFailure = {
            organizationMemberships = emptyList()
            organizationActivationJob?.cancel()
            organizationActivationJob = null
            pendingClerkOrgId = null
            clearResolvedOrganization(selectedClerkOrgId = null, loading = false)
          },
        )
        updateLoadable(
          current = uiState.value.organizations,
          result = observation.result,
          update = { loadable -> uiState.update { it.copy(organizations = loadable) } },
        )
      }
  }

  private fun reconcileOrganizationAuthority() {
    val membershipIds = organizationMemberships.mapTo(mutableSetOf()) { it.clerkOrgId }
    val selectedClerkOrgId = uiState.value.selectedClerkOrgId
    val selectedHasAuthority =
      selectedClerkOrgId != null &&
        selectedClerkOrgId == currentActiveClerkOrgId &&
        selectedClerkOrgId in membershipIds

    if (!selectedHasAuthority) {
      clearResolvedOrganization(
        selectedClerkOrgId = selectedClerkOrgId,
        loading = pendingClerkOrgId != null,
      )
    }

    pendingClerkOrgId?.let { pendingId ->
      if (pendingId in membershipIds) return
      organizationActivationJob?.cancel()
      organizationActivationJob = null
      pendingClerkOrgId = null
    }

    if (selectedHasAuthority) {
      if (selectedOrgId.value == null && organizationActivationJob?.isActive != true) {
        selectOrganization(checkNotNull(selectedClerkOrgId))
      }
      return
    }

    val nextClerkOrgId =
      currentActiveClerkOrgId?.takeIf(membershipIds::contains)
        ?: organizationMemberships.firstOrNull()?.clerkOrgId
    if (nextClerkOrgId == null) {
      clearResolvedOrganization(selectedClerkOrgId = null, loading = false)
    } else {
      selectOrganization(nextClerkOrgId)
    }
  }

  private fun hasOrganizationAuthority(clerkOrgId: String): Boolean =
    clerkOrgId == repository.activeClerkOrgId.value &&
      organizationMemberships.any { it.clerkOrgId == clerkOrgId }

  private fun clearResolvedOrganization(selectedClerkOrgId: String?, loading: Boolean) {
    selectedOrgId.value = null
    uiState.update {
      it.copy(
        selectedClerkOrgId = selectedClerkOrgId,
        selectedOrgId = null,
        team = Loadable(loading = loading),
        members = Loadable(loading = loading),
      )
    }
  }

  private suspend fun observeDashboard(
    scope: UsageScope,
    now: StateFlow<Long>,
    generation: Long,
    principalId: String,
  ) {
    val queryMoments =
      now
        .map { current -> QueryMoment(current, QueryRefreshKey.from(current, zoneId)) }
        .distinctUntilChangedBy(QueryMoment::key)
    val selection =
      if (scope == UsageScope.Personal) {
        combine(range, queryMoments) { selectedRange, queryMoment ->
          DashboardSelection(selectedRange, null, queryMoment)
        }
      } else {
        combine(range, selectedOrgId, queryMoments) { selectedRange, orgId, queryMoment ->
          DashboardSelection(selectedRange, orgId, queryMoment)
        }
      }
    val results =
      selection
      .distinctUntilChanged()
      .flatMapLatest { selected ->
        if (scope == UsageScope.Team && selected.orgId == null) {
          flowOf(Result.success(emptyDashboard()))
        } else {
          dashboard(
            scope = scope,
            orgId = selected.orgId,
            selectedRange = selected.range,
            requestNow = selected.queryMoment.now,
          )
        }
      }
    results
      .withFreshnessMoments(
        now = now,
        dataOnFailure = {
          if (scope == UsageScope.Personal) uiState.value.personal.data
          else uiState.value.team.data
        },
        updatedAt = { data -> data.live.map { device -> device.live.updatedAt } },
      )
      .collect { observation ->
        if (!isCurrentSession(generation, principalId)) return@collect
        val result =
          observation.result.map { data ->
            data.copy(live = LiveFreshness.liveDevices(data.live, observation.now))
          }
        if (scope == UsageScope.Personal) {
          val current = uiState.value.personal.refreshLive(observation.now)
          updateLoadable(current, result) { value -> uiState.update { it.copy(personal = value) } }
        } else {
          val current = uiState.value.team.refreshLive(observation.now)
          updateLoadable(current, result) { value -> uiState.update { it.copy(team = value) } }
        }
      }
  }

  private fun dashboard(
    scope: UsageScope,
    orgId: String?,
    selectedRange: UsageRange,
    requestNow: Long,
  ): Flow<Result<DashboardData>> {
    val bounds = RangePlanner.bounds(selectedRange, requestNow, zoneId)
    return combine(
      repository.hourly(scope, orgId, bounds),
      repository.recentSessions(scope, orgId),
      repository.liveNow(scope, orgId),
    ) { hourly, sessions, live ->
      val error = hourly.exceptionOrNull() ?: sessions.exceptionOrNull() ?: live.exceptionOrNull()
      if (error != null) {
        Result.failure(error)
      } else {
        val response = hourly.getOrThrow()
        val rows = UsageAggregator.codexRows(UsageAggregator.expandCompactRows(response.rows))
        Result.success(
          DashboardData(
            snapshot =
              UsageAggregator.snapshot(
                rows,
                response.users,
                zoneId,
                includeMembers = scope == UsageScope.Team,
            ),
            sessions = sessions.getOrThrow().filter { UsageAggregator.isOpenAIModel(it.model) },
            live = live.getOrThrow(),
          )
        )
      }
    }
  }

  private suspend fun observeMembers(
    now: StateFlow<Long>,
    generation: Long,
    principalId: String,
  ) {
    selectedOrgId
      .flatMapLatest { orgId ->
        if (orgId == null) flowOf(Result.success(emptyList()))
        else repository.members(orgId)
      }
      .withFreshnessMoments(
        now = now,
        dataOnFailure = { uiState.value.members.data },
        updatedAt = { members -> members.mapNotNull { member -> member.live?.updatedAt } },
      )
      .collect { observation ->
        if (!isCurrentSession(generation, principalId)) return@collect
        val current =
          uiState.value.members.copy(
            data = uiState.value.members.data?.let { LiveFreshness.members(it, observation.now) }
          )
        val result =
          observation.result.map { members -> LiveFreshness.members(members, observation.now) }
        updateLoadable(current, result) { value ->
          uiState.update { it.copy(members = value) }
        }
      }
  }

  private suspend fun observeDevices(
    now: StateFlow<Long>,
    generation: Long,
    principalId: String,
  ) {
    repository
      .devices()
      .withFreshnessMoments(
        now = now,
        dataOnFailure = { uiState.value.devices.data },
        updatedAt = { devices -> devices.mapNotNull { device -> device.live?.updatedAt } },
      )
      .collect { observation ->
        if (!isCurrentSession(generation, principalId)) return@collect
        val current =
          uiState.value.devices.copy(
            data = uiState.value.devices.data?.let { LiveFreshness.devices(it, observation.now) }
          )
        val result =
          observation.result.map { devices -> LiveFreshness.devices(devices, observation.now) }
        updateLoadable(current, result) { value ->
          uiState.update { it.copy(devices = value) }
        }
      }
  }

  private fun <T> Flow<Result<T>>.withFreshnessMoments(
    now: StateFlow<Long>,
    dataOnFailure: () -> T?,
    updatedAt: (T) -> List<Long>,
  ): Flow<FreshnessObservation<T>> =
    flatMapLatest { result ->
      val data = result.getOrNull() ?: dataOnFailure()
      val deadlines =
        data
          ?.let(updatedAt)
          .orEmpty()
          .map { timestamp -> timestamp + LiveFreshness.TtlMillis }
          .filter { deadline -> deadline > now.value }
          .distinct()
          .sorted()
      kotlinx.coroutines.flow.merge(
          now,
          kotlinx.coroutines.flow.flow {
            if (repository.referenceNow == null) {
              deadlines.forEach { deadline -> emit(clock.wakeAt(deadline)) }
            }
          },
        )
        .map { currentNow -> FreshnessObservation(result, effectiveNow(currentNow)) }
    }

  private fun Loadable<DashboardData>.refreshLive(now: Long): Loadable<DashboardData> =
    copy(data = data?.let { it.copy(live = LiveFreshness.liveDevices(it.live, now)) })

  private fun effectiveNow(tick: Long): Long = repository.referenceNow ?: tick

  private fun hasPrincipalAuthority(principalId: String): Boolean =
    repository.authState.value == ViewerAuthState.SignedIn(principalId)

  private fun isCurrentSession(generation: Long, principalId: String): Boolean =
    activePrincipalId == principalId &&
      sessionGeneration == generation &&
      hasPrincipalAuthority(principalId)

  private fun emptyDashboard(): DashboardData =
    DashboardData(
      snapshot = UsageAggregator.snapshot(emptyList(), emptyList(), zoneId, false),
      sessions = emptyList(),
      live = emptyList(),
    )

  private fun setFatalError(error: Throwable) {
    val message = error.message ?: error.javaClass.simpleName
    uiState.update {
      it.copy(
        organizations = Loadable(loading = false, error = message),
        account = Loadable(loading = false, error = message),
        personal = Loadable(loading = false, error = message),
        team = Loadable(loading = false, error = message),
        members = Loadable(loading = false, error = message),
        devices = Loadable(loading = false, error = message),
      )
    }
  }

  private fun <T> updateLoadable(
    current: Loadable<T>,
    result: Result<T>,
    update: (Loadable<T>) -> Unit,
  ) {
    result.fold(
      onSuccess = { update(Loadable(data = it, loading = false)) },
      onFailure = { error ->
        update(
          current.copy(
            loading = false,
            error = error.message ?: error.javaClass.simpleName,
          )
        )
      },
    )
  }

  companion object {
    fun factory(
      repository: ViewerRepository,
      clock: ViewerClock = SystemViewerClock(),
    ): ViewModelProvider.Factory =
      object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
          MainViewModel(repository, clock = clock) as T
      }
  }
}
