import Foundation
import XCTest
@testable import CodexTracker

final class ClockRefreshPolicyTests: XCTestCase {
  func testRefreshMarkerChangesAtHourAndLocalDayBoundaries() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
    let formatter = ISO8601DateFormatter()
    let beforeHour = formatter.date(from: "2026-09-05T06:59:59Z")!
    let localMidnight = formatter.date(from: "2026-09-05T07:00:00Z")!

    let first = ClockRefreshPolicy.marker(at: beforeHour, calendar: calendar)
    let second = ClockRefreshPolicy.marker(at: localMidnight, calendar: calendar)

    XCTAssertNotEqual(first.utcHour, second.utcHour)
    XCTAssertEqual(first.localDay, "2026-09-04")
    XCTAssertEqual(second.localDay, "2026-09-05")
    XCTAssertTrue(ClockRefreshPolicy.shouldRefresh(from: first, to: second))
  }

  func testRefreshMarkerDetectsLocalDayChangeWithinSameUTCHour() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Kathmandu")!
    let formatter = ISO8601DateFormatter()
    let beforeMidnight = formatter.date(from: "2026-09-04T18:14:59Z")!
    let localMidnight = formatter.date(from: "2026-09-04T18:15:00Z")!

    let first = ClockRefreshPolicy.marker(at: beforeMidnight, calendar: calendar)
    let second = ClockRefreshPolicy.marker(at: localMidnight, calendar: calendar)

    XCTAssertEqual(first.utcHour, second.utcHour)
    XCTAssertEqual(first.localDay, "2026-09-04")
    XCTAssertEqual(second.localDay, "2026-09-05")
    XCTAssertTrue(ClockRefreshPolicy.shouldRefresh(from: first, to: second))
  }

  func testRefreshMarkerStaysStableWithinOneHour() {
    let first = Date(timeIntervalSince1970: 1_800_000_010)
    let second = Date(timeIntervalSince1970: 1_800_003_599)

    XCTAssertFalse(ClockRefreshPolicy.shouldRefresh(
      from: ClockRefreshPolicy.marker(at: first),
      to: ClockRefreshPolicy.marker(at: second)
    ))
  }

  func testLiveFreshnessExpiresAtExactlyTwoMinutes() {
    let updatedAt = 10_000.0

    XCTAssertTrue(LiveFreshness.isFresh(updatedAt: updatedAt, now: updatedAt + 119_999))
    XCTAssertFalse(LiveFreshness.isFresh(updatedAt: updatedAt, now: updatedAt + 120_000))
  }

  func testAdvancingPayloadTimeExpiresTopLevelDeviceAndMemberLiveState() throws {
    let snapshot = LiveSnapshot(
      sessionId: "session-a",
      model: "gpt-5.6-sol",
      tokensPerSecond: 4,
      lastEventAt: 9_000,
      todayTotal: 100,
      todayCost: 0.1,
      updatedAt: 10_000
    )
    let user = PublicUser(id: "user-a", name: "Alex", email: nil, imageUrl: nil)
    let payload = RepositoryPayload(
      now: 10_000,
      users: [user],
      organizations: [],
      rows: [],
      sessions: [],
      members: [MemberItem(
        id: user.id, name: user.name, email: nil, imageUrl: nil, role: "org:member",
        joinedAt: 1, deviceCount: 1, lastSeenAt: 10_000, live: snapshot
      )],
      devices: [DeviceItem(
        id: "device-a", name: "Mac", platform: "darwin", hostname: nil, appVersion: nil,
        timezone: nil, createdAt: 1, lastSeenAt: 10_000, live: snapshot, logins: 1
      )],
      live: [LiveItem(user: user, deviceId: "device-a", deviceName: "Mac", platform: "darwin", live: snapshot)]
    )

    let justBeforeBoundary = payload.advanced(to: 129_999)
    XCTAssertEqual(justBeforeBoundary.live.count, 1)
    XCTAssertNotNil(justBeforeBoundary.devices.first?.live)
    XCTAssertNotNil(justBeforeBoundary.members.first?.live)

    let expired = payload.advanced(to: 130_000)
    XCTAssertEqual(expired.now, 130_000)
    XCTAssertTrue(expired.live.isEmpty)
    XCTAssertNil(expired.devices.first?.live)
    XCTAssertNil(expired.members.first?.live)
  }
}

@MainActor
final class AppModelClockTests: XCTestCase {
  func testInjectedClockAdvancesPayloadAndReloadsOnlyAfterQueryBoundary() async {
    let clockState = TestClockState(Date(timeIntervalSince1970: 1_800_000_010))
    let repository = ClockRepository()
    let clock = MobileClock(
      now: { clockState.now },
      sleep: { _ in throw CancellationError() }
    )
    let model = AppModel(repository: repository, clock: clock)

    await model.start()
    XCTAssertEqual(repository.loadCount, 1)

    clockState.now = Date(timeIntervalSince1970: 1_800_000_100)
    await model.refreshForClockTick()
    XCTAssertEqual(repository.loadCount, 1)
    XCTAssertEqual(model.payloads[.personal]?.now, 1_800_000_100_000)

    clockState.now = Date(timeIntervalSince1970: 1_800_003_601)
    await model.refreshForClockTick()
    await waitUntil { repository.loadCount == 2 }
    XCTAssertEqual(repository.loadCount, 2)
    XCTAssertEqual(model.payloads[.personal]?.now, 1_800_003_601_000)
  }

  func testClockKeepsTickingAndExpiresLiveDataWhileBoundaryReloadIsSuspended() async {
    let start = Date(timeIntervalSince1970: 1_800_003_590)
    let clockDriver = ManualClockDriver(start)
    let repository = SuspendedRefreshRepository(updatedAt: start.timeIntervalSince1970 * 1_000)
    let clock = MobileClock(
      now: { clockDriver.now },
      sleep: { duration in try await clockDriver.sleep(duration) }
    )
    let model = AppModel(repository: repository, clock: clock)
    await model.start()
    await waitUntil { clockDriver.sleepCount >= 1 }

    clockDriver.now = start.addingTimeInterval(11)
    clockDriver.wakeNext()
    await waitUntil { repository.loadCount >= 2 && clockDriver.sleepCount >= 2 }

    clockDriver.now = start.addingTimeInterval(120)
    clockDriver.wakeNext()
    await waitUntil { clockDriver.sleepCount >= 3 }

    XCTAssertEqual(model.payloads[.personal]?.now, clockDriver.now.timeIntervalSince1970 * 1_000)
    XCTAssertTrue(model.payloads[.personal]?.live.isEmpty == true)
    await model.signOut()
  }

  func testLoadStraddlingHourBoundaryImmediatelyStartsReplacementQuery() async {
    let beforeBoundary = Date(timeIntervalSince1970: 1_800_003_599)
    let clockState = TestClockState(beforeBoundary)
    let repository = BoundaryStraddleRepository()
    let model = AppModel(
      repository: repository,
      clock: MobileClock(
        now: { clockState.now },
        sleep: { _ in throw CancellationError() }
      )
    )
    let firstLoad = Task { @MainActor in await model.load(scope: .personal) }
    await waitUntil { repository.loadCount == 1 }

    clockState.now = beforeBoundary.addingTimeInterval(1)
    await model.refreshForClockTick()
    XCTAssertEqual(repository.loadCount, 1)
    repository.finishFirst()
    await firstLoad.value

    await waitUntil { repository.loadCount == 2 }
    repository.finishReplacement()
    await waitUntil { model.payloads[.personal] != nil }
    await model.signOut()
  }

  private func waitUntil(
    _ condition: @escaping @MainActor () -> Bool,
    iterations: Int = 500
  ) async {
    for _ in 0..<iterations {
      if condition() { return }
      await Task.yield()
    }
    XCTFail("Condition was not satisfied before the test yield budget expired")
  }
}

@MainActor
private final class TestClockState {
  var now: Date

  init(_ now: Date) {
    self.now = now
  }
}

@MainActor
private final class ClockRepository: MobileRepository {
  let isDemo = false
  private(set) var loadCount = 0

  func load(scope: UsageScope, organizationID: String?) async throws -> RepositoryPayload {
    loadCount += 1
    return RepositoryPayload(
      now: 0,
      users: [],
      organizations: [],
      rows: [],
      sessions: [],
      members: [],
      devices: [],
      live: []
    )
  }
}

@MainActor
private final class ManualClockDriver {
  var now: Date
  private var sleepers: [PendingLoadResult<Void>] = []
  private var nextSleeper = 0
  var sleepCount: Int { sleepers.count }

  init(_ now: Date) {
    self.now = now
  }

  func sleep(_ duration: Duration) async throws {
    let pending = PendingLoadResult<Void>()
    sleepers.append(pending)
    try await pending.wait()
  }

  func wakeNext() {
    guard sleepers.indices.contains(nextSleeper) else { return }
    sleepers[nextSleeper].resume(returning: ())
    nextSleeper += 1
  }
}

@MainActor
private final class SuspendedRefreshRepository: MobileRepository {
  let isDemo = false
  private let updatedAt: Double
  private let suspended = PendingLoadResult<RepositoryPayload>()
  private(set) var loadCount = 0

  init(updatedAt: Double) {
    self.updatedAt = updatedAt
  }

  func load(scope: UsageScope, organizationID: String?) async throws -> RepositoryPayload {
    loadCount += 1
    if loadCount > 1 { return try await suspended.wait() }
    let user = PublicUser(id: "user-a", name: "Alex", email: nil, imageUrl: nil)
    let live = LiveSnapshot(
      sessionId: "session-a",
      model: "gpt-5.6-sol",
      tokensPerSecond: 1,
      lastEventAt: updatedAt,
      todayTotal: 10,
      todayCost: 0.01,
      updatedAt: updatedAt
    )
    return RepositoryPayload(
      now: updatedAt,
      users: [user],
      organizations: [],
      rows: [],
      sessions: [],
      members: [],
      devices: [],
      live: [LiveItem(user: user, deviceId: "device-a", deviceName: "Mac", platform: "darwin", live: live)]
    )
  }
}

@MainActor
private final class BoundaryStraddleRepository: MobileRepository {
  let isDemo = false
  private let first = PendingLoadResult<RepositoryPayload>()
  private let replacement = PendingLoadResult<RepositoryPayload>()
  private(set) var loadCount = 0

  func load(scope: UsageScope, organizationID: String?) async throws -> RepositoryPayload {
    loadCount += 1
    return try await (loadCount == 1 ? first : replacement).wait()
  }

  func finishFirst() {
    first.resume(returning: payload())
  }

  func finishReplacement() {
    replacement.resume(returning: payload())
  }

  private func payload() -> RepositoryPayload {
    RepositoryPayload(
      now: 0,
      users: [],
      organizations: [],
      rows: [],
      sessions: [],
      members: [],
      devices: [],
      live: []
    )
  }
}
