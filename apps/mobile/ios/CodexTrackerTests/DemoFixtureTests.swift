import XCTest
@testable import CodexTracker

final class DemoFixtureTests: XCTestCase {
  func testFixturePersonalAndTeamHeadlinesMatchSharedExpectations() throws {
    let fixture = try DemoFixture.load()
    let allRows = UsageAggregator.filterCodex(UsageAggregator.expand(fixture.rows))
    let personal = UsageAggregator.summary(allRows.filter { $0.userID == "user-alex" })
    let team = UsageAggregator.summary(allRows)

    XCTAssertEqual(personal.usage.total, fixture.expected.personal.total)
    XCTAssertEqual(personal.usage.requests, fixture.expected.personal.requests)
    XCTAssertEqual(personal.cost, fixture.expected.personal.cost, accuracy: 0.001)
    XCTAssertEqual(personal.activeUsers, fixture.expected.personal.activeUsers)
    XCTAssertEqual(personal.models, fixture.expected.personal.models)
    XCTAssertEqual(team.usage.total, fixture.expected.team.total)
    XCTAssertEqual(team.usage.requests, fixture.expected.team.requests)
    XCTAssertEqual(team.cost, fixture.expected.team.cost, accuracy: 0.001)
    XCTAssertEqual(team.activeUsers, fixture.expected.team.activeUsers)
    XCTAssertEqual(team.models, fixture.expected.team.models)
  }

  func testFixtureLoaderIsDeterministic() throws {
    let first = try DemoFixture.load()
    let second = try DemoFixture.load()

    XCTAssertEqual(first.now, second.now)
    XCTAssertEqual(first.rows, second.rows)
    XCTAssertEqual(first.sessions, second.sessions)
  }
}
