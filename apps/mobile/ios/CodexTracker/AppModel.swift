import Foundation

enum LoadingPhase: Equatable {
  case initializing
  case signedOut
  case bootstrapping
  case signingOut
  case loading
  case loaded
  case failed(String)
}

enum ConnectionState: String, Equatable {
  case live
  case reconnecting
  case offline
}

@MainActor
final class AppModel: ObservableObject {
  @Published private(set) var phase: LoadingPhase = .initializing
  @Published private(set) var payloads: [UsageScope: RepositoryPayload] = [:]
  @Published private(set) var staleScopes: Set<UsageScope> = []
  @Published private(set) var connection: ConnectionState = .live
  @Published private(set) var teamUnavailable = false
  @Published var selectedOrganizationID: String?
  @Published var range: UsageRange {
    didSet { UserDefaults.standard.set(range.rawValue, forKey: Self.rangeKey) }
  }
  @Published var customFrom: Date
  @Published var customTo: Date

  let isDemo: Bool
  private let repository: any MobileRepository
  private let clock: MobileClock
  private var clockTask: Task<Void, Never>?
  private var boundaryRefreshTasks: [UsageScope: Task<Void, Never>] = [:]
  private var lastRefreshMarker: ClockRefreshMarker
  private var acceptsRepositoryUpdates = true
  private var sessionGeneration: UInt64 = 0
  private var nextLoadGeneration: UInt64 = 0
  private var activeLoadGenerations: [UsageScope: UInt64] = [:]
  private static let rangeKey = "mobile.range"

  init(repository: any MobileRepository, clock: MobileClock = .system) {
    self.repository = repository
    self.clock = clock
    isDemo = repository.isDemo
    lastRefreshMarker = ClockRefreshPolicy.marker(at: clock.now())
    range = UsageRange(rawValue: UserDefaults.standard.string(forKey: Self.rangeKey) ?? "") ?? .thirtyDays
    let now = Date()
    customTo = now
    customFrom = Calendar.current.date(byAdding: .day, value: -29, to: now) ?? now
    if let streaming = repository as? any StreamingMobileRepository {
      streaming.setPayloadHandler { [weak self] scope, payload in
        guard let self, self.acceptsRepositoryUpdates else { return }
        guard scope != .team || self.selectedOrganizationID != nil else { return }
        self.payloads[scope] = self.payloadForPresentation(payload)
        self.staleScopes.remove(scope)
      }
      streaming.setConnectionHandler { [weak self] state in
        guard let self, self.acceptsRepositoryUpdates else { return }
        self.connection = state
        if state != .live { self.staleScopes.formUnion(self.payloads.keys) }
      }
      streaming.setAuthorizationInvalidationHandler { [weak self] scope in
        guard let self, self.acceptsRepositoryUpdates else { return }
        self.invalidatePresentationLoad(scope)
        self.payloads[scope] = nil
        self.staleScopes.remove(scope)
        if scope == .team {
          self.selectedOrganizationID = nil
          self.teamUnavailable = true
          if self.payloads[.personal] != nil { self.phase = .loaded }
        }
      }
    }
  }

  func start() async {
    let session = beginSessionFlow()
    startClockIfNeeded()
    phase = .initializing
    do {
      guard try await repository.prepare() else {
        guard isCurrentSession(session) else { return }
        acceptsRepositoryUpdates = false
        stopClockAndBoundaryRefreshes()
        phase = .signedOut
        return
      }
      guard isCurrentSession(session) else { return }
      phase = .bootstrapping
      await loadInitial(expectedSession: session)
    } catch {
      guard isCurrentSession(session) else { return }
      acceptsRepositoryUpdates = false
      stopClockAndBoundaryRefreshes()
      phase = .failed(String(localized: "error.load"))
    }
  }

  func signIn() async {
    let session = beginSessionFlow()
    startClockIfNeeded()
    phase = .bootstrapping
    do {
      try await repository.signIn()
      guard isCurrentSession(session) else { return }
      await loadInitial(expectedSession: session)
    } catch {
      guard isCurrentSession(session) else { return }
      acceptsRepositoryUpdates = false
      stopClockAndBoundaryRefreshes()
      phase = .signedOut
    }
  }

  func signOut() async {
    let session = invalidateSession()
    acceptsRepositoryUpdates = false
    stopClockAndBoundaryRefreshes()
    payloads.removeAll()
    staleScopes.removeAll()
    selectedOrganizationID = nil
    teamUnavailable = false
    phase = .signingOut
    await repository.signOut()
    guard isCurrentSession(session) else { return }
    if isDemo {
      acceptsRepositoryUpdates = true
      await loadInitial(expectedSession: session)
    } else {
      phase = .signedOut
    }
  }

  func loadInitial(expectedSession: UInt64? = nil) async {
    let session = expectedSession ?? sessionGeneration
    guard isCurrentSession(session) else { return }
    phase = .loading
    await load(scope: .personal)
    guard isCurrentSession(session) else { return }
    if selectedOrganizationID == nil {
      selectedOrganizationID = payloads[.personal]?.organizations.first?.clerkOrgId
    }
    if selectedOrganizationID != nil {
      await load(scope: .team)
    }
    guard isCurrentSession(session) else { return }
    if case .failed = phase { return }
    phase = .loaded
  }

  func load(scope: UsageScope) async {
    guard acceptsRepositoryUpdates else { return }
    let queryMarker = ClockRefreshPolicy.marker(at: clock.now())
    let loadTicket = beginPresentationLoad(scope)
    let requestedOrganizationID = scope == .team ? selectedOrganizationID : nil
    if payloads[scope] != nil { staleScopes.insert(scope) }
    do {
      let payload = try await repository.load(scope: scope, organizationID: requestedOrganizationID)
      guard isCurrentPresentationLoad(loadTicket) else { return }
      guard scope != .team || requestedOrganizationID == selectedOrganizationID else { return }
      payloads[scope] = payloadForPresentation(payload)
      staleScopes.remove(scope)
      if scope == .team { teamUnavailable = false }
      phase = .loaded
      let completedMarker = ClockRefreshPolicy.marker(at: clock.now())
      if !isDemo && ClockRefreshPolicy.shouldRefresh(from: queryMarker, to: completedMarker) {
        scheduleBoundaryRefresh(scope: scope)
      }
    } catch is CancellationError {
      // A newer load owns presentation state; cancellation is not an unavailable/error result.
      return
    } catch {
      guard isCurrentPresentationLoad(loadTicket) else { return }
      guard scope != .team || requestedOrganizationID == selectedOrganizationID else { return }
      staleScopes.remove(scope)
      if scope == .team && payloads[.personal] != nil {
        payloads[.team] = nil
        teamUnavailable = true
        phase = .loaded
      } else {
        phase = .failed(String(localized: "error.load"))
      }
    }
  }

  func retry() async {
    acceptsRepositoryUpdates = true
    startClockIfNeeded()
    phase = .loading
    await loadInitial()
  }

  func chooseOrganization(_ organizationID: String?) async {
    selectedOrganizationID = organizationID
    payloads[.team] = nil
    teamUnavailable = false
    guard organizationID != nil else {
      invalidatePresentationLoad(.team)
      (repository as? any StreamingMobileRepository)?.cancel(scope: .team)
      return
    }
    await load(scope: .team)
  }

  func refreshForClockTick(calendar: Calendar = .current) async {
    guard !isDemo, acceptsRepositoryUpdates else { return }
    let now = clock.now()
    let nowMilliseconds = now.timeIntervalSince1970 * 1_000
    for scope in Array(payloads.keys) {
      payloads[scope] = payloads[scope]?.advanced(to: nowMilliseconds)
    }

    let marker = ClockRefreshPolicy.marker(at: now, calendar: calendar)
    guard ClockRefreshPolicy.shouldRefresh(from: lastRefreshMarker, to: marker) else { return }
    lastRefreshMarker = marker

    let refreshPersonal = payloads[.personal] != nil
    let refreshTeam = payloads[.team] != nil && selectedOrganizationID != nil
    if refreshPersonal { scheduleBoundaryRefresh(scope: .personal) }
    if refreshTeam { scheduleBoundaryRefresh(scope: .team) }
  }

  func visibleRows(for scope: UsageScope, calendar: Calendar = .current) -> [UsageRow] {
    guard let payload = payloads[scope] else { return [] }
    let bounds = RangeCalculator.bounds(
      for: range,
      now: payload.now,
      customFrom: customFrom,
      customTo: customTo,
      calendar: calendar
    )
    return UsageAggregator.filterCodex(UsageAggregator.expand(payload.rows)).filter {
      $0.hourStart >= bounds.from && $0.hourStart < bounds.to
    }
  }

  func summary(for scope: UsageScope) -> UsageSummary {
    UsageAggregator.summary(visibleRows(for: scope))
  }

  func simulateConnectionChange() {
    guard isDemo else { return }
    if connection == .live {
      connection = .offline
      staleScopes.formUnion(payloads.keys)
    } else {
      connection = .reconnecting
      Task { @MainActor in
        try? await Task.sleep(for: .milliseconds(250))
        connection = .live
        staleScopes.removeAll()
      }
    }
  }

  private func payloadForPresentation(_ payload: RepositoryPayload) -> RepositoryPayload {
    isDemo ? payload : payload.advanced(to: clock.nowMilliseconds)
  }

  private func startClockIfNeeded() {
    guard !isDemo, clockTask == nil else { return }
    lastRefreshMarker = ClockRefreshPolicy.marker(at: clock.now())
    clockTask = Task { @MainActor [weak self] in
      while let self, !Task.isCancelled {
        do {
          try await self.clock.sleep(self.nextClockSleepDuration())
        } catch {
          return
        }
        await self.refreshForClockTick()
      }
    }
  }

  private struct PresentationLoadTicket {
    let session: UInt64
    let scope: UsageScope
    let generation: UInt64
  }

  private func beginSessionFlow() -> UInt64 {
    sessionGeneration &+= 1
    activeLoadGenerations.removeAll()
    acceptsRepositoryUpdates = true
    return sessionGeneration
  }

  private func invalidateSession() -> UInt64 {
    sessionGeneration &+= 1
    activeLoadGenerations.removeAll()
    return sessionGeneration
  }

  private func isCurrentSession(_ generation: UInt64) -> Bool {
    sessionGeneration == generation
  }

  private func beginPresentationLoad(_ scope: UsageScope) -> PresentationLoadTicket {
    nextLoadGeneration &+= 1
    activeLoadGenerations[scope] = nextLoadGeneration
    return PresentationLoadTicket(
      session: sessionGeneration,
      scope: scope,
      generation: nextLoadGeneration
    )
  }

  private func isCurrentPresentationLoad(_ ticket: PresentationLoadTicket) -> Bool {
    acceptsRepositoryUpdates &&
      isCurrentSession(ticket.session) &&
      activeLoadGenerations[ticket.scope] == ticket.generation
  }

  private func invalidatePresentationLoad(_ scope: UsageScope) {
    activeLoadGenerations[scope] = nil
  }

  private func scheduleBoundaryRefresh(scope: UsageScope) {
    boundaryRefreshTasks[scope]?.cancel()
    boundaryRefreshTasks[scope] = Task { @MainActor [weak self] in
      guard !Task.isCancelled else { return }
      await self?.load(scope: scope)
    }
  }

  private func stopClockAndBoundaryRefreshes() {
    clockTask?.cancel()
    clockTask = nil
    boundaryRefreshTasks.values.forEach { $0.cancel() }
    boundaryRefreshTasks.removeAll()
  }

  private func nextClockSleepDuration(calendar: Calendar = .current) -> Duration {
    let now = clock.nowMilliseconds
    var nextWake = now + 60_000
    let nextHour = (floor(now / 3_600_000) + 1) * 3_600_000
    nextWake = min(nextWake, nextHour)

    let nowDate = Date(timeIntervalSince1970: now / 1_000)
    if let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: nowDate)) {
      nextWake = min(nextWake, tomorrow.timeIntervalSince1970 * 1_000)
    }

    let snapshots = payloads.values.flatMap { payload in
      payload.live.map(\.live) +
        payload.devices.compactMap(\.live) +
        payload.members.compactMap(\.live)
    }
    for snapshot in snapshots {
      let expiry = snapshot.updatedAt + LiveFreshness.maximumAgeMilliseconds
      if expiry > now { nextWake = min(nextWake, expiry) }
    }
    return .milliseconds(Int64(max(1, ceil(nextWake - now))))
  }

  static func resetPreferencesIfRequested(arguments: [String] = ProcessInfo.processInfo.arguments) {
    guard arguments.contains("--reset-preferences") else { return }
    [rangeKey, "mobile.appearance", "mobile.language"].forEach(UserDefaults.standard.removeObject(forKey:))
  }
}
