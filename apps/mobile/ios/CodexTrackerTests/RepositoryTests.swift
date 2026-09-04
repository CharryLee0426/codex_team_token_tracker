import XCTest
@testable import CodexTracker

@MainActor
final class RepositoryTests: XCTestCase {
  func testPlaceholderConfigurationUsesDemoMode() {
    let configuration = AppConfiguration(
      info: [
        "CLERK_PUBLISHABLE_KEY": "pk_test_REPLACE_ME",
        "CONVEX_URL": "https://example.convex.cloud"
      ],
      arguments: []
    )

    XCTAssertTrue(configuration.isDemo)
  }

  func testExplicitDemoArgumentWinsOverValidConfiguration() {
    let configuration = AppConfiguration(
      info: [
        "CLERK_PUBLISHABLE_KEY": "pk_test_valid-key",
        "CONVEX_URL": "https://valid-deployment.convex.cloud"
      ],
      arguments: ["--demo"]
    )

    XCTAssertTrue(configuration.isDemo)
  }

  func testValidConfigurationEnablesLiveMode() {
    let configuration = AppConfiguration(
      info: [
        "CLERK_PUBLISHABLE_KEY": "pk_test_valid-key",
        "CONVEX_URL": "https://valid-deployment.convex.cloud"
      ],
      arguments: []
    )

    XCTAssertFalse(configuration.isDemo)
  }

  func testDemoRepositoryScopesPersonalDataToFixtureOwner() async throws {
    let repository = try DemoRepository()

    let payload = try await repository.load(scope: .personal, organizationID: nil)
    let rows = UsageAggregator.filterCodex(UsageAggregator.expand(payload.rows))

    XCTAssertEqual(Set(rows.map(\.userID)), ["user-alex"])
    XCTAssertEqual(payload.sessions.count, 1)
    XCTAssertEqual(payload.live.count, 1)
    XCTAssertEqual(payload.members.count, 0)
  }

  func testDemoRepositoryTeamDataIncludesBothMembersAndFiltersSessions() async throws {
    let repository = try DemoRepository()

    let payload = try await repository.load(scope: .team, organizationID: "org-orbital")

    XCTAssertEqual(Set(payload.rows.map(\.u)), ["user-alex", "user-sam"])
    XCTAssertEqual(payload.sessions.map(\.id), ["session-alex-1", "session-sam-1"])
    XCTAssertEqual(payload.members.count, 2)
    XCTAssertEqual(payload.live.count, 2)
  }

  func testTeamReadsRequireTheRequestedClerkOrganizationToBeActiveAndResolved() {
    XCTAssertFalse(OrganizationActivationGate.canReadTeam(
      requestedClerkID: "org_clerk_one",
      activeClerkID: nil,
      backendOrganizationID: "backend_org",
      hasMembership: true
    ))
    XCTAssertFalse(OrganizationActivationGate.canReadTeam(
      requestedClerkID: "org_clerk_one",
      activeClerkID: "org_clerk_two",
      backendOrganizationID: "backend_org",
      hasMembership: true
    ))
    XCTAssertFalse(OrganizationActivationGate.canReadTeam(
      requestedClerkID: "org_clerk_one",
      activeClerkID: "org_clerk_one",
      backendOrganizationID: nil,
      hasMembership: true
    ))
    XCTAssertFalse(OrganizationActivationGate.canReadTeam(
      requestedClerkID: "org_clerk_one",
      activeClerkID: "org_clerk_one",
      backendOrganizationID: "backend_org",
      hasMembership: false
    ))
    XCTAssertTrue(OrganizationActivationGate.canReadTeam(
      requestedClerkID: "org_clerk_one",
      activeClerkID: "org_clerk_one",
      backendOrganizationID: "backend_org",
      hasMembership: true
    ))
  }

  func testLiveEndpointAllowlistContainsOnlyReviewAndBootstrapOperations() {
    XCTAssertEqual(
      Set(LiveEndpoint.reads),
      ["users:me", "usage:hourly", "usage:recentSessions", "usage:liveNow", "usage:myDevices", "orgs:byClerkId", "orgs:members"]
    )
    XCTAssertEqual(Set(LiveEndpoint.bootstrapMutations), ["users:ensureUser", "orgs:ensureCurrentOrg"])
  }

  func testTeamConvexApplicationErrorFailsClosedButTransportFailureRetainsStaleData() {
    XCTAssertTrue(TeamSubscriptionFailurePolicy.shouldInvalidateAuthorization(
      scope: .team,
      isConvexApplicationError: true
    ))
    XCTAssertFalse(TeamSubscriptionFailurePolicy.shouldInvalidateAuthorization(
      scope: .team,
      isConvexApplicationError: false
    ))
    XCTAssertFalse(TeamSubscriptionFailurePolicy.shouldInvalidateAuthorization(
      scope: .personal,
      isConvexApplicationError: true
    ))
  }
}
