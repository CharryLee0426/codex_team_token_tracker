import Combine
import ConvexMobile
import XCTest
@testable import CodexTracker

@MainActor
final class RepositoryCoordinationTests: XCTestCase {
  func testFirstPublisherValueReceivesBackgroundValueOnMainActor() async throws {
    let waiter = FirstPublisherValue<Int>()
    waiter.start(
      Just(42)
        .setFailureType(to: ClientError.self)
        .subscribe(on: DispatchQueue.global())
        .eraseToAnyPublisher()
    )

    let value = try await waiter.wait()
    XCTAssertEqual(value, 42)
  }

  func testFirstPublisherValueReceivesBackgroundCompletionOnMainActor() async {
    let waiter = FirstPublisherValue<Int>()
    waiter.start(
      Empty<Int, ClientError>()
        .subscribe(on: DispatchQueue.global())
        .eraseToAnyPublisher()
    )

    do {
      _ = try await waiter.wait()
      XCTFail("Completion without a value must fail instead of suspending the load")
    } catch {
      XCTAssertFalse(error is CancellationError)
    }
  }

  func testReplacingTeamLoadCancelsPendingResultAndInvalidatesOldGeneration() async {
    let coordinator = RepositoryLoadCoordinator()
    let pending = PendingLoadResult<Int>()
    let first = coordinator.begin(scope: .team, organizationID: "org-a")
    XCTAssertTrue(coordinator.registerCancellation(for: first) {
      pending.cancel()
    })
    let waiter = Task { @MainActor in try await pending.wait() }

    let second = coordinator.begin(scope: .team, organizationID: "org-b")

    do {
      _ = try await waiter.value
      XCTFail("A replaced load must not remain suspended")
    } catch {
      XCTAssertTrue(error is CancellationError)
    }
    XCTAssertFalse(coordinator.isCurrent(first))
    XCTAssertTrue(coordinator.isCurrent(second))
  }

  func testInvalidatingAllLoadsCancelsPendingResult() async {
    let coordinator = RepositoryLoadCoordinator()
    let pending = PendingLoadResult<Int>()
    let ticket = coordinator.begin(scope: .personal, organizationID: nil)
    XCTAssertTrue(coordinator.registerCancellation(for: ticket) {
      pending.cancel()
    })
    let waiter = Task { @MainActor in try await pending.wait() }

    coordinator.invalidateAll()

    do {
      _ = try await waiter.value
      XCTFail("Sign-out invalidation must not leave a load suspended")
    } catch {
      XCTAssertTrue(error is CancellationError)
    }
    XCTAssertFalse(coordinator.isCurrent(ticket))
  }

  func testStaleCompletionCannotAttachAReplacementCancellationHook() {
    let coordinator = RepositoryLoadCoordinator()
    let stale = coordinator.begin(scope: .team, organizationID: "org-a")
    let current = coordinator.begin(scope: .team, organizationID: "org-b")
    var staleStateWasCanceled = false

    let registered = coordinator.registerCancellation(for: stale) {
      staleStateWasCanceled = true
    }

    XCTAssertFalse(registered)
    XCTAssertTrue(staleStateWasCanceled)
    XCTAssertFalse(coordinator.isCurrent(stale))
    XCTAssertTrue(coordinator.isCurrent(current))
  }

  func testOrganizationActivationQueueSerializesOverlappingOperations() async throws {
    let queue = OrganizationActivationQueue()
    let releaseFirst = PendingLoadResult<Void>()
    var events: [String] = []

    let first = Task { @MainActor in
      try await queue.run {
        events.append("first-start")
        try await releaseFirst.wait()
        events.append("first-end")
        return "first"
      }
    }
    while events.isEmpty { await Task.yield() }

    let second = Task { @MainActor in
      try await queue.run {
        events.append("second-start")
        events.append("second-end")
        return "second"
      }
    }
    await Task.yield()

    XCTAssertEqual(events, ["first-start"])
    releaseFirst.resume(returning: ())
    let values = try await (first.value, second.value)

    XCTAssertEqual(values.0, "first")
    XCTAssertEqual(values.1, "second")
    XCTAssertEqual(events, ["first-start", "first-end", "second-start", "second-end"])
  }

  func testReplacingSuspendedActivationCancelsItAndUnblocksSuccessor() async throws {
    let coordinator = RepositoryLoadCoordinator()
    let queue = OrganizationActivationQueue()
    let firstStarted = PendingLoadResult<Void>()
    let suspendFirst = PendingLoadResult<String>()
    let firstTicket = coordinator.begin(scope: .team, organizationID: "org-a")
    let first = Task { @MainActor in
      try await queue.run {
        firstStarted.resume(returning: ())
        return try await suspendFirst.wait()
      }
    }
    XCTAssertTrue(coordinator.registerCancellation(for: firstTicket) {
      first.cancel()
    })
    try await firstStarted.wait()

    let secondTicket = coordinator.begin(scope: .team, organizationID: "org-b")
    let second = Task { @MainActor in
      try await queue.run { "org-b" }
    }
    XCTAssertTrue(coordinator.registerCancellation(for: secondTicket) {
      second.cancel()
    })

    do {
      _ = try await first.value
      XCTFail("A replaced activation must resume with cancellation")
    } catch {
      XCTAssertTrue(error is CancellationError)
    }
    let secondValue = try await second.value
    XCTAssertEqual(secondValue, "org-b")
  }

  func testInvalidatingAllCancelsSuspendedActivation() async {
    let coordinator = RepositoryLoadCoordinator()
    let queue = OrganizationActivationQueue()
    let started = PendingLoadResult<Void>()
    let suspended = PendingLoadResult<String>()
    let ticket = coordinator.begin(scope: .team, organizationID: "org-a")
    let activation = Task { @MainActor in
      try await queue.run {
        started.resume(returning: ())
        return try await suspended.wait()
      }
    }
    XCTAssertTrue(coordinator.registerCancellation(for: ticket) {
      activation.cancel()
    })
    try? await started.wait()

    coordinator.invalidateAll()

    do {
      _ = try await activation.value
      XCTFail("Sign out must resume a suspended activation with cancellation")
    } catch {
      XCTAssertTrue(error is CancellationError)
    }
  }

  func testPostResumeAuthorityCheckRejectsInvalidatedTicket() async {
    let coordinator = RepositoryLoadCoordinator()
    let pending = PendingLoadResult<Int>()
    let resumed = PendingLoadResult<Void>()
    let releaseFinalCheck = PendingLoadResult<Void>()
    let ticket = coordinator.begin(scope: .personal, organizationID: nil)
    pending.resume(returning: 42)
    let load = Task { @MainActor in
      let value = try await pending.wait()
      resumed.resume(returning: ())
      try await releaseFinalCheck.wait()
      try coordinator.requireCurrent(ticket)
      return value
    }
    try? await resumed.wait()

    coordinator.invalidateAll()
    releaseFinalCheck.resume(returning: ())

    do {
      _ = try await load.value
      XCTFail("A success resumed before invalidation must still fail its final authority check")
    } catch {
      XCTAssertTrue(error is CancellationError)
    }
  }
}

@MainActor
final class AppModelCoordinationTests: XCTestCase {
  func testReplacedTeamLoadCancellationDoesNotPublishUnavailableState() async {
    let repository = OverlappingTeamRepository()
    let model = AppModel(repository: repository)
    await model.load(scope: .personal)
    model.selectedOrganizationID = "org-b"

    let first = Task { @MainActor in await model.load(scope: .team) }
    while repository.teamLoadCount < 1 { await Task.yield() }
    let second = Task { @MainActor in await model.load(scope: .team) }
    while repository.teamLoadCount < 2 { await Task.yield() }
    await Task.yield()

    XCTAssertFalse(model.teamUnavailable)

    repository.finishReplacement()
    await first.value
    await second.value
    XCTAssertFalse(model.teamUnavailable)
    XCTAssertEqual(model.payloads[.team]?.organizations.first?.clerkOrgId, "org-b")
  }

  func testLateSuccessFromReplacedSameOrganizationLoadCannotOverwriteReplacement() async {
    let repository = LateSuccessRepository()
    let model = AppModel(repository: repository)
    model.selectedOrganizationID = "org-a"

    let first = Task { @MainActor in await model.load(scope: .team) }
    while repository.teamLoadCount < 1 { await Task.yield() }
    let second = Task { @MainActor in await model.load(scope: .team) }
    while repository.teamLoadCount < 2 { await Task.yield() }

    repository.finishSecond()
    await second.value
    repository.finishFirst()
    await first.value

    XCTAssertEqual(model.payloads[.team]?.organizations.first?.name, "Replacement")
    XCTAssertFalse(model.teamUnavailable)
  }

  func testSignOutClearsPresentationBeforeRepositoryReturnsAndRejectsLateLoad() async {
    let repository = LateSuccessRepository()
    let model = AppModel(repository: repository)
    let load = Task { @MainActor in await model.load(scope: .personal) }
    while repository.personalLoadCount < 1 { await Task.yield() }

    let signOut = Task { @MainActor in await model.signOut() }
    while !repository.signOutStarted { await Task.yield() }

    XCTAssertEqual(model.phase, .signingOut)
    XCTAssertTrue(model.payloads.isEmpty)
    await model.load(scope: .personal)
    XCTAssertEqual(repository.personalLoadCount, 1)
    repository.finishSignOut()
    await signOut.value
    XCTAssertEqual(model.phase, .signedOut)
    repository.finishPersonal()
    await load.value
    XCTAssertEqual(model.phase, .signedOut)
    XCTAssertTrue(model.payloads.isEmpty)
  }

  func testAuthorizationInvalidationClearsRenderedTeamData() async {
    let repository = StreamingAuthorityRepository()
    let model = AppModel(repository: repository)
    await model.start()
    XCTAssertNotNil(model.payloads[.team])

    repository.invalidateTeamAuthorization()

    XCTAssertNil(model.payloads[.team])
    XCTAssertNil(model.selectedOrganizationID)
    XCTAssertTrue(model.teamUnavailable)
    await model.signOut()
  }

  func testClearingOrganizationSelectionCancelsAndRejectsQueuedTeamUpdates() async {
    let repository = StreamingAuthorityRepository()
    let model = AppModel(repository: repository)
    await model.start()

    await model.chooseOrganization(nil)
    repository.emitTeamPayload()

    XCTAssertEqual(repository.canceledScopes, [.team])
    XCTAssertNil(model.payloads[.team])
    XCTAssertNil(model.selectedOrganizationID)
    await model.signOut()
  }
}

@MainActor
private final class OverlappingTeamRepository: MobileRepository {
  let isDemo = false
  private let firstResult = PendingLoadResult<RepositoryPayload>()
  private let replacementResult = PendingLoadResult<RepositoryPayload>()
  private(set) var teamLoadCount = 0

  func load(scope: UsageScope, organizationID: String?) async throws -> RepositoryPayload {
    if scope == .personal { return payload(organizationID: nil) }
    teamLoadCount += 1
    if teamLoadCount == 1 { return try await firstResult.wait() }
    firstResult.cancel()
    return try await replacementResult.wait()
  }

  func finishReplacement() {
    replacementResult.resume(returning: payload(organizationID: "org-b"))
  }

  private func payload(organizationID: String?) -> RepositoryPayload {
    RepositoryPayload(
      now: Date().timeIntervalSince1970 * 1_000,
      users: [],
      organizations: organizationID.map {
        [Organization(id: $0, clerkOrgId: $0, name: "Team", slug: nil, imageUrl: nil, role: "org:member")]
      } ?? [],
      rows: [],
      sessions: [],
      members: [],
      devices: [],
      live: []
    )
  }
}

@MainActor
private final class LateSuccessRepository: MobileRepository {
  let isDemo = false
  private let firstTeam = PendingLoadResult<RepositoryPayload>()
  private let secondTeam = PendingLoadResult<RepositoryPayload>()
  private let personal = PendingLoadResult<RepositoryPayload>()
  private let signOutResult = PendingLoadResult<Void>()
  private(set) var teamLoadCount = 0
  private(set) var personalLoadCount = 0
  private(set) var signOutStarted = false

  func load(scope: UsageScope, organizationID: String?) async throws -> RepositoryPayload {
    if scope == .personal {
      personalLoadCount += 1
      return try await personal.wait()
    }
    teamLoadCount += 1
    return try await (teamLoadCount == 1 ? firstTeam : secondTeam).wait()
  }

  func finishFirst() {
    firstTeam.resume(returning: payload(name: "Stale"))
  }

  func finishSecond() {
    secondTeam.resume(returning: payload(name: "Replacement"))
  }

  func finishPersonal() {
    personal.resume(returning: payload(name: "Personal"))
  }

  func signOut() async {
    signOutStarted = true
    try? await signOutResult.wait()
  }

  func finishSignOut() {
    signOutResult.resume(returning: ())
  }

  private func payload(name: String) -> RepositoryPayload {
    RepositoryPayload(
      now: 1,
      users: [],
      organizations: [Organization(
        id: "org-a", clerkOrgId: "org-a", name: name, slug: nil, imageUrl: nil, role: "org:member"
      )],
      rows: [],
      sessions: [],
      members: [],
      devices: [],
      live: []
    )
  }
}

@MainActor
private final class StreamingAuthorityRepository: MobileRepository, StreamingMobileRepository {
  let isDemo = false
  private var payloadHandler: ((UsageScope, RepositoryPayload) -> Void)?
  private var invalidationHandler: ((UsageScope) -> Void)?
  private(set) var canceledScopes: [UsageScope] = []

  func load(scope: UsageScope, organizationID: String?) async throws -> RepositoryPayload {
    RepositoryPayload(
      now: Date().timeIntervalSince1970 * 1_000,
      users: [],
      organizations: [Organization(
        id: "org-a", clerkOrgId: "org-a", name: "Team", slug: nil, imageUrl: nil, role: "org:member"
      )],
      rows: [],
      sessions: [],
      members: [],
      devices: [],
      live: []
    )
  }

  func setPayloadHandler(_ handler: @escaping (UsageScope, RepositoryPayload) -> Void) {
    payloadHandler = handler
  }
  func setConnectionHandler(_ handler: @escaping (ConnectionState) -> Void) {}

  func setAuthorizationInvalidationHandler(_ handler: @escaping (UsageScope) -> Void) {
    invalidationHandler = handler
  }

  func invalidateTeamAuthorization() {
    invalidationHandler?(.team)
  }

  func cancel(scope: UsageScope) {
    canceledScopes.append(scope)
  }

  func emitTeamPayload() {
    payloadHandler?(.team, RepositoryPayload(
      now: 1,
      users: [],
      organizations: [],
      rows: [],
      sessions: [],
      members: [],
      devices: [],
      live: []
    ))
  }
}
