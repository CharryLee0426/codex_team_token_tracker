package dev.chenli.codextracker.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.chenli.codextracker.data.ViewerAuthState
import dev.chenli.codextracker.data.ViewerRepository
import dev.chenli.codextracker.domain.Account
import dev.chenli.codextracker.domain.ConnectionState
import dev.chenli.codextracker.domain.CustomDayRange
import dev.chenli.codextracker.domain.Device
import dev.chenli.codextracker.domain.LiveDevice
import dev.chenli.codextracker.domain.LiveFreshness
import dev.chenli.codextracker.domain.Member
import dev.chenli.codextracker.domain.Organization
import dev.chenli.codextracker.domain.QueryRange
import dev.chenli.codextracker.domain.QueryRefreshKey
import dev.chenli.codextracker.domain.RangePlanner
import dev.chenli.codextracker.domain.SystemViewerClock
import dev.chenli.codextracker.domain.UsageAggregator
import dev.chenli.codextracker.domain.UsageRange
import dev.chenli.codextracker.domain.UsageScope
import dev.chenli.codextracker.domain.UsageSession
import dev.chenli.codextracker.domain.UsageSnapshot
import dev.chenli.codextracker.domain.ViewerClock
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
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
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException

data class DashboardData(
  val snapshot: UsageSnapshot,
  val sessions: List<UsageSession>,
  val live: List<LiveDevice>,
  val bounds: QueryRange? = null,
)

data class Loadable<out T>(
  val data: T? = null,
  val loading: Boolean = true,
  val error: String? = null,
) {
  /** Previous data stays on screen while a refresh is pending or the subscription failed. */
  val stale: Boolean
    get() = data != null && (error != null || loading)

  /** The subscription failed after data had already been shown. */
  val failed: Boolean
    get() = data != null && error != null
}

data class MainUiState(
  val range: UsageRange = UsageRange.ThirtyDays,
  val customRange: CustomDayRange? = null,
  val now: Long = System.currentTimeMillis(),
  val connection: ConnectionState = ConnectionState.Live,
  val refreshing: Boolean = false,
  val account: Loadable<Account?> = Loadable(),
  val organizations: Loadable<List<Organization>> = Loadable(),
  val selectedClerkOrgId: String? = null,
  val selectedOrgId: String? = null,
  val personal: Loadable<DashboardData> = Loadable(),
  val team: Loadable<DashboardData> = Loadable(),
  val members: Loadable<List<Member>> = Loadable(),
  val devices: Loadable<List<Device>> = Loadable(),
) {
  /** True while the selected Clerk organization is still being activated. */
  val activatingOrganization: Boolean
    get() = selectedOrgId == null && selectedClerkOrgId != null && team.loading && team.data == null

  /** Mirrors the iOS `teamUnavailable` flag: the chosen organization could not be resolved. */
  val teamUnavailable: Boolean
    get() = selectedOrgId == null && team.error != null
}

private data class QueryMoment(val now: Long, val key: QueryRefreshKey)

private data class DashboardSelection(
  val range: UsageRange,
  val custom: CustomDayRange?,
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
  private val rangeStore: RangeStore = InMemoryRangeStore(),
) : ViewModel() {
  /**
   * Live snapshots age out only in live mode. The iOS viewer never advances a demo payload, so the
   * fixture's live list and member states stay visible there; device cards apply the freshness rule
   * themselves on both platforms.
   */
  private val expiresLiveState: Boolean = repository.referenceNow == null
  private val range = MutableStateFlow(rangeStore.loadRange())
  private val customRange = MutableStateFlow(rangeStore.loadCustomRange())
  private val selectedOrgId = MutableStateFlow<String?>(null)
  private val connectionOverride = MutableStateFlow<ConnectionState?>(null)
  private var activePrincipalId: String? = null
  private var sessionGeneration = 0L
  private var lastRecoveryAt = Long.MIN_VALUE
  private var sessionJob: Job? = null
  private var organizationActivationJob: Job? = null
  private var pendingClerkOrgId: String? = null
  private var organizationMemberships: List<Organization> = emptyList()
  private var currentActiveClerkOrgId: String? = null
  val uiState = MutableStateFlow(MainUiState(range = range.value, customRange = customRange.value))

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
          withTimeout(25_000) { repository.ensureUser() }
          if (isCurrentSession(generation, principalId)) {
            observeRepository(generation, principalId)
          }
        } catch (timeout: TimeoutCancellationException) {
          if (isCurrentSession(generation, principalId)) setFatalError(timeout)
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
    selectedOrgId.value = null
    connectionOverride.value = null
    uiState.value =
      MainUiState(range = range.value, customRange = customRange.value, now = uiState.value.now)
  }

  /** Restart failed subscriptions for the same principal, retaining personal data while reconnecting. */
  fun recover(force: Boolean = false) {
    val principalId = activePrincipalId ?: return
    val previous = uiState.value
    val failed = listOf(previous.account, previous.organizations, previous.personal,
      previous.team, previous.members, previous.devices).any { it.error != null }
    if (!force && !failed && previous.connection == ConnectionState.Live && sessionJob?.isActive == true) return
    val now = clock.nowMillis()
    if (previous.refreshing && sessionJob?.isActive == true && lastRecoveryAt != Long.MIN_VALUE && now - lastRecoveryAt < 25_000) return
    lastRecoveryAt = now
    endSession(principalId)
    beginSession(principalId)
    if (activePrincipalId != principalId) return
    uiState.value = previous.copy(
      refreshing = true,
      connection = ConnectionState.Reconnecting,
      personal = previous.personal.copy(loading = true),
      selectedOrgId = null,
      team = Loadable(),
      members = Loadable(),
    )
  }

  fun retry() = recover(force = true)

  fun refresh() = recover(force = true)

  fun selectRange(value: UsageRange) {
    range.value = value
    rangeStore.saveRange(value)
    uiState.update { it.copy(range = value) }
  }

  fun applyCustomRange(from: LocalDate, to: LocalDate) {
    val today = RangePlanner.today(effectiveNow(clock.nowMillis()), zoneId)
    val normalized = RangePlanner.normalizeCustom(from, to, today)
    val custom = CustomDayRange(normalized.from, normalized.to)
    customRange.value = custom
    rangeStore.saveCustomRange(custom)
    uiState.update { it.copy(customRange = custom) }
    selectRange(UsageRange.Custom)
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
        val activation = try {
          withTimeout(20_000) { repository.activateOrganization(id) }
        } catch (timeout: TimeoutCancellationException) {
          Result.failure(timeout)
        }
        activation.fold(
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
                refreshing = false,
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

  /** Demo-only: toggles a simulated outage so the banner and settings states can be reviewed. */
  fun simulateConnectionChange() {
    if (!repository.isDemo) return
    if ((connectionOverride.value ?: ConnectionState.Live) == ConnectionState.Live) {
      connectionOverride.value = ConnectionState.Offline
    } else {
      connectionOverride.value = ConnectionState.Reconnecting
      viewModelScope.launch {
        delay(250)
        if (connectionOverride.value == ConnectionState.Reconnecting) connectionOverride.value = null
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
      uiState.update { it.copy(now = initialNow) }
      val now =
        clock.ticks
          .map(::effectiveNow)
          .distinctUntilChanged()
          .stateIn(this, SharingStarted.Eagerly, initialNow)

      launch {
        now.collect { current ->
          if (isCurrentSession(generation, principalId)) uiState.update { it.copy(now = current) }
        }
      }
      launch { observeConnection(generation, principalId) }
      launch { observeAccount(generation, principalId) }
      launch { observeOrganizations(generation, principalId) }
      launch { observeDashboard(UsageScope.Personal, now, generation, principalId) }
      launch { observeDashboard(UsageScope.Team, now, generation, principalId) }
      launch { observeMembers(now, generation, principalId) }
      launch { observeDevices(now, generation, principalId) }
    }

  private suspend fun observeConnection(generation: Long, principalId: String) {
    combine(repository.connection, connectionOverride) { live, override -> override ?: live }
      .collect { state ->
        if (!isCurrentSession(generation, principalId)) return@collect
        uiState.update { it.copy(connection = state) }
      }
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
        combine(range, customRange, queryMoments) { selectedRange, custom, queryMoment ->
          DashboardSelection(selectedRange, custom, null, queryMoment)
        }
      } else {
        combine(range, customRange, selectedOrgId, queryMoments) {
          selectedRange,
          custom,
          orgId,
          queryMoment ->
          DashboardSelection(selectedRange, custom, orgId, queryMoment)
        }
      }
    val results =
      selection
        .distinctUntilChanged()
        .onEach { if (isCurrentSession(generation, principalId)) markReloading(scope) }
        .flatMapLatest { selected ->
          if (scope == UsageScope.Team && selected.orgId == null) {
            flowOf(Result.success(emptyDashboard()))
          } else {
            dashboard(
              scope = scope,
              orgId = selected.orgId,
              selectedRange = selected.range,
              custom = selected.custom,
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
            if (expiresLiveState) {
              data.copy(live = LiveFreshness.liveDevices(data.live, observation.now))
            } else {
              data
            }
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

  private fun markReloading(scope: UsageScope) {
    uiState.update { state ->
      if (scope == UsageScope.Personal) state.copy(personal = state.personal.reloading())
      else state.copy(team = state.team.reloading())
    }
  }

  private fun <T> Loadable<T>.reloading(): Loadable<T> =
    if (data == null) this else copy(loading = true)

  private fun dashboard(
    scope: UsageScope,
    orgId: String?,
    selectedRange: UsageRange,
    custom: CustomDayRange?,
    requestNow: Long,
  ): Flow<Result<DashboardData>> {
    val bounds = RangePlanner.bounds(selectedRange, requestNow, zoneId, custom)
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
            bounds = bounds,
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
            data = uiState.value.members.data?.let { freshMembers(it, observation.now) }
          )
        val result = observation.result.map { members -> freshMembers(members, observation.now) }
        updateLoadable(current, result) { value ->
          uiState.update { it.copy(members = value, refreshing = false) }
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
          uiState.update { it.copy(devices = value, refreshing = false) }
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
    if (!expiresLiveState) this
    else copy(data = data?.let { it.copy(live = LiveFreshness.liveDevices(it.live, now)) })

  private fun freshMembers(members: List<Member>, now: Long): List<Member> =
    if (expiresLiveState) LiveFreshness.members(members, now) else members

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
        refreshing = false,
        organizations = it.organizations.copy(loading = false, error = message),
        account = it.account.copy(loading = false, error = message),
        personal = it.personal.copy(loading = false, error = message),
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
      rangeStore: RangeStore = InMemoryRangeStore(),
    ): ViewModelProvider.Factory =
      object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
          MainViewModel(repository, clock = clock, rangeStore = rangeStore) as T
      }
  }
}
