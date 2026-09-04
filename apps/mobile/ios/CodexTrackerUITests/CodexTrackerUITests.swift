import XCTest

@MainActor
final class CodexTrackerUITests: XCTestCase {
  private func launchDemo() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["--demo", "--reset-preferences"]
    app.launch()
    return app
  }

  func testReviewOnlyDemoNavigatesEveryTabAndChangesPreferences() {
    continueAfterFailure = false
    let app = launchDemo()
    XCTAssertTrue(app.staticTexts["personal.title"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["kpi.totalTokens"].exists)
    app.buttons["range.selector"].tap()
    app.buttons["range.7d"].tap()

    for tab in ["tab.team", "tab.members", "tab.devices", "tab.settings"] {
      app.buttons[tab].tap()
      let screen = app.descendants(matching: .any)["screen.\(tab.dropFirst(4))"]
      XCTAssertTrue(screen.waitForExistence(timeout: 3))
    }

    app.buttons["settings.theme.light"].tap()
    XCTAssertEqual(app.buttons["settings.theme.light"].value as? String, "selected")
    app.buttons["settings.language.zh"].tap()
    XCTAssertTrue(app.staticTexts["设置"].waitForExistence(timeout: 3))
  }

  func testDemoReconnectAndReadOnlyBoundaries() {
    continueAfterFailure = false
    let app = launchDemo()
    app.buttons["tab.settings"].tap()
    app.buttons["demo.connection.toggle"].tap()
    XCTAssertTrue(app.staticTexts["connection.offline"].waitForExistence(timeout: 3))
    app.buttons["demo.connection.toggle"].tap()
    XCTAssertTrue(app.staticTexts["connection.live"].waitForExistence(timeout: 3))

    let forbidden = ["revoke", "invite", "npx", "menu bar", "menubar", "tray", "upload usage"]
    for phrase in forbidden {
      XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", phrase)).firstMatch.exists)
      XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", phrase)).firstMatch.exists)
    }
  }
}
