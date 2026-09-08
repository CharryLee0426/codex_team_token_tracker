import SwiftUI
import XCTest
@testable import CodexTracker

@MainActor
final class RecoveryAndSharingTests: XCTestCase {
  func testForegroundRecoversBothScopesAfterHoursAway() async throws {
    let repository = try RecoveryRepository()
    let model = AppModel(repository: repository)
    await model.start()
    XCTAssertNotNil(model.payloads[.team])
    await model.setForeground(false)
    repository.fail = true
    await model.load(scope: .team)
    XCTAssertTrue(model.teamUnavailable)
    repository.fail = false
    await model.setForeground(true)
    XCTAssertEqual(repository.preparations, 2)
    XCTAssertNotNil(model.payloads[.personal])
    XCTAssertNotNil(model.payloads[.team])
    XCTAssertFalse(model.teamUnavailable)
    XCTAssertEqual(model.connection, .live)
    await model.signOut()
  }

  func testRecoveryKeepsPersonalCacheOnTransientFailureAndClearsItOnExpiredSession() async throws {
    let repository = try RecoveryRepository()
    let model = AppModel(repository: repository)
    await model.start()
    await model.setForeground(false)
    repository.fail = true
    await model.recover()
    XCTAssertNotNil(model.payloads[.personal])
    XCTAssertEqual(model.connection, .offline)
    repository.fail = false
    repository.signedIn = false
    await model.recover()
    XCTAssertTrue(model.payloads.isEmpty)
    XCTAssertEqual(model.phase, .signedOut)
    let preparations = repository.preparations
    await model.setForeground(true)
    XCTAssertEqual(repository.preparations, preparations)
  }

  func testAutomaticRetryRestartsFailedSubscriptionsWhileAppStaysOpen() async throws {
    let repository = try RecoveryRepository()
    let model = AppModel(repository: repository)
    await model.start()
    repository.fail = true
    await model.load(scope: .personal)
    repository.fail = false
    try await Task.sleep(for: .milliseconds(1_300))
    XCTAssertGreaterThan(repository.preparations, 1)
    XCTAssertTrue(model.staleScopes.isEmpty)
    XCTAssertEqual(model.connection, .live)
    await model.signOut()
  }

  func testCardExportsPNGInBothLanguages() async throws {
    let model = AppModel(repository: try DemoRepository())
    await model.start()
    let payload = try XCTUnwrap(model.payloads[.personal])
    for language in ["en", "zh-Hans"] {
      let locale = Locale(identifier: language)
      let snapshot = UsageShareSnapshot(summary: model.summary(for: .personal), scope: .personal,
        from: Date(timeIntervalSince1970: payload.now / 1_000 - 86_400),
        to: Date(timeIntervalSince1970: payload.now / 1_000),
        capturedAt: Date(timeIntervalSince1970: payload.now / 1_000), demo: true, stale: true)
      let renderer = ImageRenderer(content: UsageShareCard(snapshot: snapshot, locale: locale).frame(width: 360))
      renderer.scale = 3
      let image = try XCTUnwrap(renderer.uiImage)
      XCTAssertEqual(image.cgImage?.width, 1080)
      XCTAssertGreaterThan(image.cgImage?.height ?? 0, 1000)
      let png = try XCTUnwrap(image.pngData())
      XCTAssertEqual(Array(png.prefix(8)), [137, 80, 78, 71, 13, 10, 26, 10])
      let attachment = XCTAttachment(image: image)
      attachment.name = "Usage card \(language)"
      attachment.lifetime = .keepAlways
      add(attachment)
    }
  }
}

@MainActor
private final class RecoveryRepository: MobileRepository {
  let isDemo = false
  let demo: DemoRepository
  var preparations = 0
  var fail = false
  var signedIn = true

  init() throws { demo = try DemoRepository() }
  func prepare() async throws -> Bool {
    preparations += 1
    if fail { throw URLError(.notConnectedToInternet) }
    return signedIn
  }
  func load(scope: UsageScope, organizationID: String?) async throws -> RepositoryPayload {
    if fail { throw URLError(.notConnectedToInternet) }
    return try await demo.load(scope: scope, organizationID: organizationID)
  }
}
