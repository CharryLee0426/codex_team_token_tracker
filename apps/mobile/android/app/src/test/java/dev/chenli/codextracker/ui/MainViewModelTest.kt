package dev.chenli.codextracker.ui

import android.content.Context
import dev.chenli.codextracker.data.ViewerAuthState
import dev.chenli.codextracker.data.ViewerRepository
import dev.chenli.codextracker.domain.Account
import dev.chenli.codextracker.domain.Device
import dev.chenli.codextracker.domain.HourlyResponse
import dev.chenli.codextracker.domain.LiveDevice
import dev.chenli.codextracker.domain.LiveFreshness
import dev.chenli.codextracker.domain.LiveSnapshot
import dev.chenli.codextracker.domain.Member
import dev.chenli.codextracker.domain.Organization
import dev.chenli.codextracker.domain.PublicUser
import dev.chenli.codextracker.domain.QueryRange
import dev.chenli.codextracker.domain.UsageScope
import dev.chenli.codextracker.domain.UsageSession
import dev.chenli.codextracker.domain.ViewerClock
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MainViewModelTest {
  private val dispatcher: TestDispatcher = StandardTestDispatcher()

  @Before
  fun setUp() {
    Dispatchers.setMain(dispatcher)
  }

  @After
  fun tearDown() {
    Dispatchers.resetMain()
  }

  @Test
  fun `ending a principal clears data and cancels old subscriptions before rebootstrap`() =
    runTest(dispatcher) {
      val repository = FakeViewerRepository()
      val clock = MutableViewerClock(Instant.parse("2026-09-04T12:30:00Z").toEpochMilli())
      val viewModel = MainViewModel(repository, ZoneId.of("UTC"), clock)

      viewModel.beginSession("alice")
      advanceUntilIdle()
      assertEquals("Alice", viewModel.uiState.value.account.data?.name)
      assertEquals(1, repository.activeAccountSubscriptions)

      viewModel.endSession("alice")
      advanceUntilIdle()
      assertNull(viewModel.uiState.value.account.data)
      assertNull(viewModel.uiState.value.selectedOrgId)
      assertEquals(0, repository.activeAccountSubscriptions)

      repository.aliceAccount.value = Result.success(Account("alice", name = "Stale Alice"))
      advanceUntilIdle()
      assertNull(viewModel.uiState.value.account.data)

      repository.authState.value = ViewerAuthState.SignedIn("bob")
      viewModel.beginSession("bob")
      advanceUntilIdle()
      assertEquals("Bob", viewModel.uiState.value.account.data?.name)
      assertEquals(2, repository.ensureUserCalls)
      assertEquals(1, repository.activeAccountSubscriptions)
    }

  @Test
  fun `switching principals replaces subscriptions and ignores stale disposal`() =
    runTest(dispatcher) {
      val repository = FakeViewerRepository()
      val clock = MutableViewerClock(Instant.parse("2026-09-04T12:30:00Z").toEpochMilli())
      val viewModel = MainViewModel(repository, ZoneId.of("UTC"), clock)

      viewModel.beginSession("alice")
      advanceUntilIdle()
      assertEquals("Alice", viewModel.uiState.value.account.data?.name)

      repository.authState.value = ViewerAuthState.SignedIn("bob")
      viewModel.beginSession("bob")
      advanceUntilIdle()
      assertEquals("Bob", viewModel.uiState.value.account.data?.name)
      assertEquals(2, repository.ensureUserCalls)
      assertEquals(1, repository.activeAccountSubscriptions)

      viewModel.endSession("alice")
      advanceUntilIdle()
      assertEquals("Bob", viewModel.uiState.value.account.data?.name)
      assertEquals(1, repository.activeAccountSubscriptions)
    }

  @Test
  fun `repository principal flip clears old session before its flow can publish new user data`() =
    runTest(dispatcher) {
      val repository = FakeViewerRepository()
      val clock = MutableViewerClock(Instant.parse("2026-09-04T12:30:00Z").toEpochMilli())
      val viewModel = MainViewModel(repository, ZoneId.of("UTC"), clock)

      viewModel.beginSession("alice")
      advanceUntilIdle()
      assertEquals("Alice", viewModel.uiState.value.account.data?.name)
      assertEquals(1, repository.activeAccountSubscriptions)

      repository.authState.value = ViewerAuthState.SignedIn("bob")
      repository.aliceAccount.value = Result.success(Account("bob", name = "Leaked Bob"))
      advanceUntilIdle()

      assertNull(viewModel.uiState.value.account.data)
      assertNull(viewModel.uiState.value.selectedOrgId)
      assertEquals(0, repository.activeAccountSubscriptions)

      viewModel.beginSession("bob")
      advanceUntilIdle()
      assertEquals("Bob", viewModel.uiState.value.account.data?.name)
      assertEquals(1, repository.activeAccountSubscriptions)
    }

  @Test
  fun `hour boundary changes the query key and replaces range subscription`() =
    runTest(dispatcher) {
      val repository = FakeViewerRepository()
      val before = Instant.parse("2026-09-04T12:59:59Z").toEpochMilli()
      val clock = MutableViewerClock(before)
      val viewModel = MainViewModel(repository, ZoneId.of("UTC"), clock)

      viewModel.beginSession("alice")
      advanceUntilIdle()
      assertEquals(1, repository.personalHourlyRanges.size)

      clock.current.value = Instant.parse("2026-09-04T13:00:00Z").toEpochMilli()
      advanceUntilIdle()

      assertEquals(2, repository.personalHourlyRanges.size)
      assertTrue(repository.personalHourlyRanges[1].to > repository.personalHourlyRanges[0].to)
    }

  @Test
  fun `local day boundary replaces range subscription inside the same UTC hour`() =
    runTest(dispatcher) {
      val repository = FakeViewerRepository()
      val before = Instant.parse("2026-09-04T18:29:59Z").toEpochMilli()
      val clock = MutableViewerClock(before)
      val viewModel = MainViewModel(repository, ZoneId.of("Asia/Kolkata"), clock)

      viewModel.beginSession("alice")
      advanceUntilIdle()
      assertEquals(1, repository.personalHourlyRanges.size)

      clock.current.value = Instant.parse("2026-09-04T18:30:00Z").toEpochMilli()
      advanceUntilIdle()

      assertEquals(2, repository.personalHourlyRanges.size)
      assertTrue(repository.personalHourlyRanges[1].from > repository.personalHourlyRanges[0].from)
    }

  @Test
  fun `clock ticks remove expired live state without another repository emission`() =
    runTest(dispatcher) {
      val now = Instant.parse("2026-09-04T12:00:00Z").toEpochMilli()
      val updatedAt = now - LiveFreshness.TtlMillis + 1
      val live =
        LiveSnapshot(
          tokensPerSecond = 1.0,
          todayTotal = 1,
          todayCost = 0.01,
          updatedAt = updatedAt,
        )
      val repository = FakeViewerRepository()
      repository.liveDevices.value =
        Result.success(
          listOf(
            LiveDevice(
              user = PublicUser("alice"),
              deviceId = "device",
              deviceName = "Laptop",
              platform = "darwin",
              live = live,
            )
          )
        )
      repository.members.value =
        Result.success(
          listOf(
            Member(
              id = "alice",
              role = "org:member",
              joinedAt = now,
              deviceCount = 1,
              live = live,
            )
          )
        )
      repository.devices.value =
        Result.success(
          listOf(
            Device(
              id = "device",
              name = "Laptop",
              platform = "darwin",
              createdAt = now,
              lastSeenAt = now,
              live = live,
              logins = 1,
            )
          )
        )
      repository.organizations.value =
        Result.success(
          listOf(
            Organization(
              id = "backend-a",
              clerkOrgId = "clerk-a",
              name = "Team A",
              role = "org:member",
            )
          )
        )
      val clock = MutableViewerClock(now)
      val viewModel = MainViewModel(repository, ZoneId.of("UTC"), clock)

      viewModel.beginSession("alice")
      advanceUntilIdle()
      assertEquals(1, viewModel.uiState.value.personal.data?.live?.size)
      assertTrue(viewModel.uiState.value.members.data?.single()?.live != null)
      assertTrue(viewModel.uiState.value.devices.data?.single()?.live != null)

      clock.current.value = updatedAt + LiveFreshness.TtlMillis
      advanceUntilIdle()

      assertEquals(0, viewModel.uiState.value.personal.data?.live?.size)
      assertNull(viewModel.uiState.value.members.data?.single()?.live)
      assertNull(viewModel.uiState.value.devices.data?.single()?.live)
    }

  @Test
  fun `membership disappearance immediately clears resolved team authority and data`() =
    runTest(dispatcher) {
      val organization =
        Organization(
          id = "backend-a",
          clerkOrgId = "clerk-a",
          name = "Team A",
          role = "org:member",
        )
      val repository = FakeViewerRepository()
      repository.organizations.value = Result.success(listOf(organization))
      repository.members.value =
        Result.success(
          listOf(
            Member(
              id = "alice",
              role = "org:member",
              joinedAt = 1,
              deviceCount = 1,
            )
          )
        )
      val clock = MutableViewerClock(Instant.parse("2026-09-04T12:30:00Z").toEpochMilli())
      val viewModel = MainViewModel(repository, ZoneId.of("UTC"), clock)

      viewModel.beginSession("alice")
      advanceUntilIdle()
      assertEquals("backend-a", viewModel.uiState.value.selectedOrgId)
      assertEquals(1, viewModel.uiState.value.members.data?.size)

      repository.organizations.value = Result.success(emptyList())
      advanceUntilIdle()

      assertNull(viewModel.uiState.value.selectedClerkOrgId)
      assertNull(viewModel.uiState.value.selectedOrgId)
      assertTrue(viewModel.uiState.value.members.data.isNullOrEmpty())
    }

  @Test
  fun `slow boundary refresh cannot keep expired live state visible`() =
    runTest(dispatcher) {
      val beforeBoundary = Instant.parse("2026-09-04T12:59:59Z").toEpochMilli()
      val updatedAt = Instant.parse("2026-09-04T12:58:01Z").toEpochMilli()
      val repository = FakeViewerRepository()
      repository.liveDevices.value =
        Result.success(
          listOf(
            LiveDevice(
              user = PublicUser("alice"),
              deviceId = "device",
              deviceName = "Laptop",
              platform = "darwin",
              live =
                LiveSnapshot(
                  tokensPerSecond = 1.0,
                  todayTotal = 1,
                  todayCost = 0.01,
                  updatedAt = updatedAt,
                ),
            )
          )
        )
      val delayedRefresh = MutableSharedFlow<Result<HourlyResponse>>()
      repository.hourlyFlow = { scope, _, _ ->
        if (scope == UsageScope.Personal && repository.personalHourlyRanges.size > 1) {
          delayedRefresh
        } else {
          flowOf(Result.success(HourlyResponse(emptyList(), emptyList())))
        }
      }
      val clock = MutableViewerClock(beforeBoundary)
      val viewModel = MainViewModel(repository, ZoneId.of("UTC"), clock)

      viewModel.beginSession("alice")
      advanceUntilIdle()
      assertEquals(1, viewModel.uiState.value.personal.data?.live?.size)

      clock.current.value = Instant.parse("2026-09-04T13:00:00Z").toEpochMilli()
      advanceUntilIdle()
      assertEquals(2, repository.personalHourlyRanges.size)

      clock.current.value = Instant.parse("2026-09-04T13:00:02Z").toEpochMilli()
      advanceUntilIdle()

      assertEquals(0, viewModel.uiState.value.personal.data?.live?.size)
    }

  @Test
  fun `off-grid expiry wake clears live state while boundary refresh is suspended`() =
    runTest(dispatcher) {
      val beforeBoundary = Instant.parse("2026-09-04T12:59:59Z").toEpochMilli()
      val updatedAt = Instant.parse("2026-09-04T12:58:07Z").toEpochMilli()
      val exactExpiry = updatedAt + LiveFreshness.TtlMillis
      val repository = FakeViewerRepository()
      repository.liveDevices.value =
        Result.success(
          listOf(
            LiveDevice(
              user = PublicUser("alice"),
              deviceId = "device",
              deviceName = "Laptop",
              platform = "darwin",
              live =
                LiveSnapshot(
                  tokensPerSecond = 1.0,
                  todayTotal = 1,
                  todayCost = 0.01,
                  updatedAt = updatedAt,
                ),
            )
          )
        )
      val delayedRefresh = MutableSharedFlow<Result<HourlyResponse>>()
      repository.hourlyFlow = { scope, _, _ ->
        if (scope == UsageScope.Personal && repository.personalHourlyRanges.size > 1) {
          delayedRefresh
        } else {
          flowOf(Result.success(HourlyResponse(emptyList(), emptyList())))
        }
      }
      val clock = SchedulingViewerClock(beforeBoundary)
      val viewModel = MainViewModel(repository, ZoneId.of("UTC"), clock)

      viewModel.beginSession("alice")
      advanceUntilIdle()
      assertEquals(1, viewModel.uiState.value.personal.data?.live?.size)
      assertTrue(exactExpiry in clock.requestedDeadlines)

      clock.emitBaseTick(Instant.parse("2026-09-04T13:00:00Z").toEpochMilli())
      advanceUntilIdle()
      assertEquals(2, repository.personalHourlyRanges.size)

      clock.emitScheduledWake(exactExpiry)
      advanceUntilIdle()

      assertEquals(0, viewModel.uiState.value.personal.data?.live?.size)
    }

  @Test
  fun `active Clerk authority change clears old team before resolving the new team`() =
    runTest(dispatcher) {
      val organizationA =
        Organization(
          id = "backend-a",
          clerkOrgId = "clerk-a",
          name = "Team A",
          role = "org:member",
        )
      val organizationB =
        Organization(
          id = "backend-b",
          clerkOrgId = "clerk-b",
          name = "Team B",
          role = "org:member",
        )
      val repository = FakeViewerRepository()
      repository.organizations.value = Result.success(listOf(organizationA, organizationB))
      repository.activeClerkOrgId.value = "clerk-a"
      repository.members.value =
        Result.success(
          listOf(
            Member(
              id = "alice",
              role = "org:member",
              joinedAt = 1,
              deviceCount = 1,
            )
          )
        )
      val clock = MutableViewerClock(Instant.parse("2026-09-04T12:30:00Z").toEpochMilli())
      val viewModel = MainViewModel(repository, ZoneId.of("UTC"), clock)

      viewModel.beginSession("alice")
      advanceUntilIdle()
      assertEquals("backend-a", viewModel.uiState.value.selectedOrgId)
      assertEquals(1, viewModel.uiState.value.members.data?.size)

      val bStarted = CompletableDeferred<Unit>()
      val releaseB = CompletableDeferred<Unit>()
      repository.activation = { clerkOrgId ->
        if (clerkOrgId == "clerk-b") {
          bStarted.complete(Unit)
          releaseB.await()
        }
        Result.success(if (clerkOrgId == "clerk-b") organizationB else organizationA)
      }
      repository.activeClerkOrgId.value = "clerk-b"
      advanceUntilIdle()

      assertTrue(bStarted.isCompleted)
      assertEquals("clerk-b", viewModel.uiState.value.selectedClerkOrgId)
      assertNull(viewModel.uiState.value.selectedOrgId)
      assertTrue(viewModel.uiState.value.members.data.isNullOrEmpty())

      releaseB.complete(Unit)
      advanceUntilIdle()
      assertEquals("backend-b", viewModel.uiState.value.selectedOrgId)
    }

  private class MutableViewerClock(initial: Long) : ViewerClock {
    val current = MutableStateFlow(initial)
    override val ticks: Flow<Long> = current
    override fun nowMillis(): Long = current.value
    override suspend fun wakeAt(deadlineMillis: Long): Long = current.first { it >= deadlineMillis }
  }

  private class SchedulingViewerClock(initial: Long) : ViewerClock {
    private val baseTicks = MutableStateFlow(initial)
    private val scheduledWakes = MutableSharedFlow<Long>(extraBufferCapacity = 1)
    private var current = initial
    val requestedDeadlines = mutableListOf<Long>()

    override val ticks: Flow<Long> = baseTicks

    override fun nowMillis(): Long = current

    override suspend fun wakeAt(deadlineMillis: Long): Long {
      requestedDeadlines += deadlineMillis
      return scheduledWakes.first { it >= deadlineMillis }
    }

    fun emitBaseTick(value: Long) {
      current = value
      baseTicks.value = value
    }

    fun emitScheduledWake(value: Long) {
      current = value
      check(scheduledWakes.tryEmit(value))
    }
  }

  private class FakeViewerRepository : ViewerRepository {
    override val isDemo = false
    override val referenceNow: Long? = null
    override val authState =
      MutableStateFlow(ViewerAuthState.SignedIn("alice"))
    val aliceAccount = MutableStateFlow(Result.success<Account?>(Account("alice", name = "Alice")))
    private val bobAccount = MutableStateFlow(Result.success<Account?>(Account("bob", name = "Bob")))
    var ensureUserCalls = 0
    var activeAccountSubscriptions = 0
    val personalHourlyRanges = mutableListOf<QueryRange>()
    val organizations = MutableStateFlow(Result.success<List<Organization>>(emptyList()))
    override val activeClerkOrgId = MutableStateFlow<String?>(null)
    val liveDevices = MutableStateFlow(Result.success<List<LiveDevice>>(emptyList()))
    val members = MutableStateFlow(Result.success<List<Member>>(emptyList()))
    val devices = MutableStateFlow(Result.success<List<Device>>(emptyList()))
    private var accountCalls = 0
    var hourlyFlow: (UsageScope, String?, QueryRange) -> Flow<Result<HourlyResponse>> =
      { _, _, _ -> flowOf(Result.success(HourlyResponse(emptyList(), emptyList()))) }
    var activation: suspend (String) -> Result<Organization> = { clerkOrgId ->
      activeClerkOrgId.value = clerkOrgId
      organizations.value
        .getOrNull()
        ?.firstOrNull { it.clerkOrgId == clerkOrgId }
        ?.let(Result.Companion::success)
        ?: Result.failure(IllegalStateException("No organization"))
    }

    override suspend fun ensureUser() {
      ensureUserCalls += 1
    }

    override fun account(): Flow<Result<Account?>> {
      val source = if (accountCalls++ == 0) aliceAccount else bobAccount
      return source
        .onStart { activeAccountSubscriptions += 1 }
        .onCompletion { activeAccountSubscriptions -= 1 }
    }

    override fun organizations(): Flow<Result<List<Organization>>> = organizations

    override suspend fun activateOrganization(clerkOrgId: String): Result<Organization> =
      activation(clerkOrgId)

    override fun hourly(
      scope: UsageScope,
      orgId: String?,
      range: QueryRange,
    ): Flow<Result<HourlyResponse>> {
      if (scope == UsageScope.Personal) personalHourlyRanges += range
      return hourlyFlow(scope, orgId, range)
    }

    override fun liveNow(
      scope: UsageScope,
      orgId: String?,
    ): Flow<Result<List<LiveDevice>>> = liveDevices

    override fun recentSessions(
      scope: UsageScope,
      orgId: String?,
    ): Flow<Result<List<UsageSession>>> = flowOf(Result.success(emptyList()))

    override fun members(orgId: String?): Flow<Result<List<Member>>> = members

    override fun devices(): Flow<Result<List<Device>>> = devices

    override suspend fun signOut(context: Context): Result<Unit> = Result.success(Unit)
  }
}
