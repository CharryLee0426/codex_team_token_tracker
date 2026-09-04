import ClerkConvex
import ClerkKit
import Combine
@preconcurrency import ConvexMobile
import Foundation
import Observation

private struct HourlyResponse: Decodable {
  let rows: [CompactHourRow]
  let users: [PublicUser]
}

private struct BackendOrganization: Decodable {
  let id: String
}

private enum LiveRepositoryError: Error {
  case notAuthenticated
  case organizationUnavailable
  case subscriptionEnded
}

/// A single long-lived Convex client owns every subscription for the app process.
/// Integration follows the official Clerk/Convex Swift bridge guidance:
/// https://github.com/clerk/clerk-convex-swift
@MainActor
final class LiveMobileRepository: MobileRepository, StreamingMobileRepository {
  let isDemo = false

  // The official client synchronizes its Rust-backed state internally but does not yet declare Sendable.
  nonisolated(unsafe) private let client: ConvexClientWithAuth<String>
  private let clock: MobileClock
  private let loadCoordinator = RepositoryLoadCoordinator()
  private let organizationActivationQueue = OrganizationActivationQueue()
  private var subscriptions: [UsageScope: ScopeSubscription] = [:]
  private var socketCancellable: AnyCancellable?
  private var payloadHandler: ((UsageScope, RepositoryPayload) -> Void)?
  private var connectionHandler: ((ConnectionState) -> Void)?
  private var authorizationInvalidationHandler: ((UsageScope) -> Void)?

  init(deploymentURL: String, clock: MobileClock = .system) {
    self.clock = clock
    let provider = ClerkConvexAuthProvider()
    client = ConvexClientWithAuth(deploymentUrl: deploymentURL, authProvider: provider)
    socketCancellable = client.watchWebSocketState()
      .receive(on: DispatchQueue.main)
      .sink { [weak self] state in
        self?.connectionHandler?(state == .connected ? .live : .reconnecting)
      }
    observeClerkAuthorityChanges()
  }

  func setPayloadHandler(_ handler: @escaping (UsageScope, RepositoryPayload) -> Void) {
    payloadHandler = handler
  }

  func setConnectionHandler(_ handler: @escaping (ConnectionState) -> Void) {
    connectionHandler = handler
  }

  func setAuthorizationInvalidationHandler(_ handler: @escaping (UsageScope) -> Void) {
    authorizationInvalidationHandler = handler
  }

  func cancel(scope: UsageScope) {
    let state = subscriptions[scope]
    subscriptions[scope] = nil
    loadCoordinator.invalidate(scope: scope)
    state?.cancel()
  }

  func prepare() async throws -> Bool {
    _ = try await Clerk.shared.refreshEnvironment()
    _ = try await Clerk.shared.refreshClient()
    guard Clerk.shared.session?.status == .active else { return false }
    try await authenticateConvexAndBootstrapUser()
    return true
  }

  func signIn() async throws {
    _ = try await Clerk.shared.auth.startHostedAuth(mode: .signIn)
    try await authenticateConvexAndBootstrapUser()
  }

  func signOut() async {
    loadCoordinator.invalidateAll()
    organizationActivationQueue.cancelAll()
    subscriptions.values.forEach { $0.cancel() }
    subscriptions.removeAll()
    await client.logout()
    try? await Clerk.shared.auth.signOut()
  }

  func load(scope: UsageScope, organizationID: String?) async throws -> RepositoryPayload {
    let ticket = loadCoordinator.begin(scope: scope, organizationID: organizationID)
    subscriptions[scope] = nil

    return try await withTaskCancellationHandler {
      do {
        let backendOrganizationID: String?
        if scope == .team {
          guard let organizationID else { throw LiveRepositoryError.organizationUnavailable }
          let activation = Task { @MainActor [weak self] in
            guard let self else { throw CancellationError() }
            return try await self.organizationActivationQueue.run { [weak self] in
              guard let self else { throw CancellationError() }
              return try await self.activateAndResolveOrganization(
                clerkOrganizationID: organizationID,
                ticket: ticket
              )
            }
          }
          guard loadCoordinator.registerCancellation(for: ticket, { activation.cancel() }) else {
            throw CancellationError()
          }
          backendOrganizationID = try await activation.value
          try loadCoordinator.requireCurrent(ticket)
          guard hasTeamAuthority(for: organizationID) else {
            throw LiveRepositoryError.organizationUnavailable
          }
        } else {
          backendOrganizationID = nil
          try loadCoordinator.requireCurrent(ticket)
        }

        let now = clock.nowMilliseconds
        let year = RangeCalculator.bounds(
          for: .oneYear,
          now: now,
          customFrom: Date(),
          customTo: Date()
        )
        let oneYearStart = Date(timeIntervalSince1970: year.from / 1_000)
        let customStart = Calendar.current.date(byAdding: .day, value: -1, to: oneYearStart) ?? oneYearStart
        let preloadFrom = min(customStart.timeIntervalSince1970 * 1_000, RangeCalculator.planStartMilliseconds)
        let chunks = RangeCalculator.chunks(from: preloadFrom, to: year.to)
        let state = ScopeSubscription(
          scope: scope,
          organizationID: organizationID,
          ticket: ticket,
          chunkCount: chunks.count
        )
        subscriptions[scope] = state
        guard loadCoordinator.registerCancellation(for: ticket, { state.cancel() }) else {
          subscriptions[scope] = nil
          throw CancellationError()
        }

        subscribeHourly(chunks: chunks, backendOrganizationID: backendOrganizationID, state: state)
        subscribeSessions(backendOrganizationID: backendOrganizationID, state: state)
        subscribeLive(backendOrganizationID: backendOrganizationID, state: state)
        if scope == .personal {
          subscribeAccount(state: state)
          subscribeDevices(state: state)
          state.members = []
        } else if let backendOrganizationID {
          state.accountLoaded = true
          state.devices = []
          subscribeMembers(backendOrganizationID: backendOrganizationID, state: state)
        }
        let payload = try await state.pendingResult.wait()
        try loadCoordinator.requireCurrent(ticket)
        guard isAuthorizedCurrentState(state) else {
          invalidateIfTeamAuthorityWasLost(state)
          throw CancellationError()
        }
        return payload
      } catch {
        cancelLoadIfCurrent(ticket)
        throw error
      }
    } onCancel: { [weak self] in
      Task { @MainActor in
        self?.cancelLoadIfCurrent(ticket)
      }
    }
  }

  private func authenticateConvexAndBootstrapUser(
    checkpoint: (() throws -> Void)? = nil
  ) async throws {
    try checkpoint?()
    let result = await client.loginFromCache()
    try checkpoint?()
    guard case .success = result else { throw LiveRepositoryError.notAuthenticated }
    let _: String = try await client.mutation(LiveEndpoint.bootstrapMutations[0])
    try checkpoint?()
  }

  private func activateAndResolveOrganization(
    clerkOrganizationID: String,
    ticket: RepositoryLoadTicket
  ) async throws -> String {
    let checkpoint = { [loadCoordinator] in
      try Task.checkCancellation()
      try loadCoordinator.requireCurrent(ticket)
    }
    try checkpoint()
    guard
      let membership = Clerk.shared.user?.organizationMemberships?.first(where: {
        $0.organization.id == clerkOrganizationID
      }),
      let session = Clerk.shared.session
    else {
      throw LiveRepositoryError.organizationUnavailable
    }

    // Clerk membership state is authoritative. No Convex mirrored-org list is queried here.
    try await Clerk.shared.auth.setActive(
      sessionId: session.id,
      organizationId: clerkOrganizationID
    )
    try checkpoint()
    guard Clerk.shared.session?.lastActiveOrganizationId == clerkOrganizationID else {
      throw LiveRepositoryError.organizationUnavailable
    }

    // Force a post-switch token, then rebind Convex before any organization read.
    _ = try await Clerk.shared.session?.getToken(.init(skipCache: true))
    try checkpoint()
    try await authenticateConvexAndBootstrapUser(checkpoint: checkpoint)
    try checkpoint()

    var ensureArguments: [String: ConvexEncodable?] = [
      "clerkOrgId": clerkOrganizationID,
      "name": membership.organization.name
    ]
    ensureArguments["slug"] = membership.organization.slug
    if !membership.organization.imageUrl.isEmpty {
      ensureArguments["imageUrl"] = membership.organization.imageUrl
    }
    let _: String = try await client.mutation(
      LiveEndpoint.bootstrapMutations[1],
      with: ensureArguments
    )
    try checkpoint()

    let resolved: BackendOrganization? = try await firstValue(
      client.subscribe(
        to: "orgs:byClerkId",
        with: ["clerkOrgId": clerkOrganizationID],
        yielding: BackendOrganization?.self
      )
    )
    try checkpoint()
    guard OrganizationActivationGate.canReadTeam(
      requestedClerkID: clerkOrganizationID,
      activeClerkID: Clerk.shared.session?.lastActiveOrganizationId,
      backendOrganizationID: resolved?.id,
      hasMembership: hasTeamAuthority(for: clerkOrganizationID)
    ), let resolved else {
      throw LiveRepositoryError.organizationUnavailable
    }
    return resolved.id
  }

  private func subscribeHourly(
    chunks: [MillisecondRange],
    backendOrganizationID: String?,
    state: ScopeSubscription
  ) {
    for (index, chunk) in chunks.enumerated() {
      var arguments: [String: ConvexEncodable?] = [
        "scope": state.scope.rawValue,
        "from": chunk.from,
        "to": chunk.to
      ]
      if let backendOrganizationID { arguments["orgId"] = backendOrganizationID }
      sink(
        client.subscribe(to: "usage:hourly", with: arguments, yielding: ConvexHourlyResponse.self),
        state: state
      ) { response in
        state.hourly[index] = HourlyResponse(
          rows: response.rows.map(\.domain),
          users: response.users
        )
      }
    }
  }

  private func subscribeSessions(backendOrganizationID: String?, state: ScopeSubscription) {
    var arguments: [String: ConvexEncodable?] = ["scope": state.scope.rawValue, "limit": 20.0]
    if let backendOrganizationID { arguments["orgId"] = backendOrganizationID }
    sink(
      client.subscribe(to: "usage:recentSessions", with: arguments, yielding: [ConvexSessionItem].self),
      state: state
    ) {
      state.sessions = $0.map(\.domain).filter { UsageAggregator.isOpenAIModel($0.model) }
    }
  }

  private func subscribeLive(backendOrganizationID: String?, state: ScopeSubscription) {
    var arguments: [String: ConvexEncodable?] = ["scope": state.scope.rawValue]
    if let backendOrganizationID { arguments["orgId"] = backendOrganizationID }
    sink(
      client.subscribe(to: "usage:liveNow", with: arguments, yielding: [ConvexLiveItem].self),
      state: state
    ) { state.live = $0.map(\.domain) }
  }

  private func subscribeAccount(state: ScopeSubscription) {
    sink(
      client.subscribe(to: "users:me", yielding: PublicUser?.self),
      state: state
    ) {
      state.account = $0
      state.accountLoaded = true
    }
  }

  private func subscribeDevices(state: ScopeSubscription) {
    sink(
      client.subscribe(to: "usage:myDevices", yielding: [ConvexDeviceItem].self),
      state: state
    ) { state.devices = $0.map(\.domain) }
  }

  private func subscribeMembers(backendOrganizationID: String, state: ScopeSubscription) {
    sink(
      client.subscribe(
        to: "orgs:members",
        with: ["orgId": backendOrganizationID],
        yielding: [ConvexMemberItem].self
      ),
      state: state
    ) { state.members = $0.map(\.domain) }
  }

  private func sink<Value: Decodable>(
    _ publisher: AnyPublisher<Value, ClientError>,
    state: ScopeSubscription,
    receive: @escaping (Value) -> Void
  ) {
    publisher
      .receive(on: DispatchQueue.main)
      .sink { [weak self, weak state] completion in
        guard case .failure(let error) = completion, let self, let state else { return }
        self.fail(state: state, error: error)
      } receiveValue: { [weak self, weak state] value in
        guard let self, let state else { return }
        guard self.isAuthorizedCurrentState(state) else {
          if !self.invalidateIfTeamAuthorityWasLost(state) {
            self.cancelStateIfOwned(state)
          }
          return
        }
        receive(value)
        self.publishIfReady(state)
      }
      .store(in: &state.cancellables)
  }

  private func publishIfReady(_ state: ScopeSubscription) {
    guard
      isAuthorizedCurrentState(state),
      let payload = state.payload(
        organizations: clerkOrganizations(),
        now: clock.nowMilliseconds
      )
    else {
      return
    }
    payloadHandler?(state.scope, payload)
    state.pendingResult.resume(returning: payload)
  }

  private func fail(state: ScopeSubscription, error: ClientError) {
    guard isAuthorizedCurrentState(state) else {
      if !invalidateIfTeamAuthorityWasLost(state) {
        cancelStateIfOwned(state)
      }
      return
    }
    let isConvexApplicationError: Bool
    if case .ConvexError = error {
      isConvexApplicationError = true
    } else {
      isConvexApplicationError = false
    }
    if TeamSubscriptionFailurePolicy.shouldInvalidateAuthorization(
      scope: state.scope,
      isConvexApplicationError: isConvexApplicationError
    ) {
      cancelStateIfOwned(state)
      authorizationInvalidationHandler?(.team)
      return
    }
    connectionHandler?(.offline)
    state.pendingResult.resume(throwing: error)
    cancelStateIfOwned(state)
  }

  private func isAuthorizedCurrentState(_ state: ScopeSubscription) -> Bool {
    guard
      subscriptions[state.scope] === state,
      loadCoordinator.isCurrent(state.ticket)
    else {
      return false
    }
    guard state.scope == .team else { return true }
    return state.organizationID.map(hasTeamAuthority(for:)) ?? false
  }

  private func hasTeamAuthority(for organizationID: String) -> Bool {
    Clerk.shared.session?.status == .active &&
      Clerk.shared.session?.lastActiveOrganizationId == organizationID &&
      Clerk.shared.user?.organizationMemberships?.contains(where: {
        $0.organization.id == organizationID
      }) == true
  }

  private func observeClerkAuthorityChanges() {
    withObservationTracking {
      _ = Clerk.shared.session?.status
      _ = Clerk.shared.session?.lastActiveOrganizationId
      _ = Clerk.shared.user?.organizationMemberships?.map { $0.organization.id }
    } onChange: { [weak self] in
      Task { @MainActor in
        guard let self else { return }
        self.observeClerkAuthorityChanges()
        guard let state = self.subscriptions[.team] else { return }
        _ = self.invalidateIfTeamAuthorityWasLost(state)
      }
    }
  }

  @discardableResult
  private func invalidateIfTeamAuthorityWasLost(_ state: ScopeSubscription) -> Bool {
    guard
      state.scope == .team,
      subscriptions[state.scope] === state,
      loadCoordinator.isCurrent(state.ticket),
      state.organizationID.map(hasTeamAuthority(for:)) != true
    else {
      return false
    }
    cancelStateIfOwned(state)
    authorizationInvalidationHandler?(.team)
    return true
  }

  private func cancelStateIfOwned(_ state: ScopeSubscription) {
    guard subscriptions[state.scope] === state else { return }
    subscriptions[state.scope] = nil
    loadCoordinator.invalidate(state.ticket)
    state.cancel()
  }

  private func cancelLoadIfCurrent(_ ticket: RepositoryLoadTicket) {
    guard loadCoordinator.isCurrent(ticket) else { return }
    let state = subscriptions[ticket.scope]
    subscriptions[ticket.scope] = nil
    loadCoordinator.invalidate(ticket)
    state?.cancel()
  }

  private func clerkOrganizations() -> [Organization] {
    let activeID = Clerk.shared.session?.lastActiveOrganizationId
    return (Clerk.shared.user?.organizationMemberships ?? [])
      .sorted { lhs, rhs in
        if lhs.organization.id == activeID { return true }
        if rhs.organization.id == activeID { return false }
        return lhs.organization.name.localizedCaseInsensitiveCompare(rhs.organization.name) == .orderedAscending
      }
      .map { membership in
        Organization(
          id: membership.organization.id,
          clerkOrgId: membership.organization.id,
          name: membership.organization.name,
          slug: membership.organization.slug,
          imageUrl: membership.organization.imageUrl.isEmpty ? nil : membership.organization.imageUrl,
          role: membership.role
        )
      }
  }

  private func firstValue<Value: Sendable>(
    _ publisher: AnyPublisher<Value, ClientError>
  ) async throws -> Value {
    let waiter = FirstPublisherValue<Value>()
    waiter.start(publisher)
    return try await waiter.wait()
  }
}

@MainActor
private final class FirstPublisherValue<Value: Sendable> {
  private let pendingResult = PendingLoadResult<Value>()
  private var cancellable: AnyCancellable?

  func start(_ publisher: AnyPublisher<Value, ClientError>) {
    cancellable = publisher.first().sink { [weak self] completion in
      switch completion {
      case .finished:
        self?.pendingResult.resume(throwing: LiveRepositoryError.subscriptionEnded)
      case .failure(let error):
        self?.pendingResult.resume(throwing: error)
      }
    } receiveValue: { [weak self] value in
      self?.pendingResult.resume(returning: value)
    }
  }

  func wait() async throws -> Value {
    try await withTaskCancellationHandler {
      try await pendingResult.wait()
    } onCancel: { [weak self] in
      Task { @MainActor in self?.cancel() }
    }
  }

  private func cancel() {
    cancellable?.cancel()
    cancellable = nil
    pendingResult.cancel()
  }
}

@MainActor
private final class ScopeSubscription {
  let scope: UsageScope
  let organizationID: String?
  let ticket: RepositoryLoadTicket
  var hourly: [HourlyResponse?]
  var sessions: [SessionItem]?
  var live: [LiveItem]?
  var members: [MemberItem]?
  var devices: [DeviceItem]?
  var account: PublicUser?
  var accountLoaded = false
  var cancellables: Set<AnyCancellable> = []
  let pendingResult = PendingLoadResult<RepositoryPayload>()

  init(
    scope: UsageScope,
    organizationID: String?,
    ticket: RepositoryLoadTicket,
    chunkCount: Int
  ) {
    self.scope = scope
    self.organizationID = organizationID
    self.ticket = ticket
    hourly = Array(repeating: nil, count: chunkCount)
  }

  func cancel() {
    cancellables.forEach { $0.cancel() }
    cancellables.removeAll()
    pendingResult.cancel()
  }

  func payload(organizations: [Organization], now: Double) -> RepositoryPayload? {
    guard
      hourly.allSatisfy({ $0 != nil }),
      let sessions,
      let live,
      let members,
      let devices,
      accountLoaded
    else {
      return nil
    }
    var users: [String: PublicUser] = [:]
    for response in hourly.compactMap({ $0 }) {
      for user in response.users { users[user.id] = user }
    }
    if let account { users[account.id] = account }
    return RepositoryPayload(
      now: now,
      users: users.values.sorted { $0.displayName < $1.displayName },
      organizations: organizations,
      rows: hourly.compactMap({ $0 }).flatMap(\.rows),
      sessions: sessions,
      members: members,
      devices: devices,
      live: live
    )
  }
}
