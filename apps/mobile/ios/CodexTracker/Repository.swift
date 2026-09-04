import Foundation

enum UsageScope: String, Sendable, Hashable {
  case personal
  case team
}

struct RepositoryPayload: Equatable, Sendable {
  let now: Double
  let users: [PublicUser]
  let organizations: [Organization]
  let rows: [CompactHourRow]
  let sessions: [SessionItem]
  let members: [MemberItem]
  let devices: [DeviceItem]
  let live: [LiveItem]
}

@MainActor
protocol MobileRepository {
  var isDemo: Bool { get }
  func prepare() async throws -> Bool
  func signIn() async throws
  func signOut() async
  func load(scope: UsageScope, organizationID: String?) async throws -> RepositoryPayload
}

@MainActor
protocol StreamingMobileRepository: AnyObject {
  func setPayloadHandler(_ handler: @escaping (UsageScope, RepositoryPayload) -> Void)
  func setConnectionHandler(_ handler: @escaping (ConnectionState) -> Void)
  func setAuthorizationInvalidationHandler(_ handler: @escaping (UsageScope) -> Void)
  func cancel(scope: UsageScope)
}

extension StreamingMobileRepository {
  func cancel(scope: UsageScope) {}
}

extension MobileRepository {
  func prepare() async throws -> Bool { true }
  func signIn() async throws {}
  func signOut() async {}
}

enum OrganizationActivationGate {
  static func canReadTeam(
    requestedClerkID: String,
    activeClerkID: String?,
    backendOrganizationID: String?,
    hasMembership: Bool
  ) -> Bool {
    hasMembership && requestedClerkID == activeClerkID && !(backendOrganizationID?.isEmpty ?? true)
  }
}

enum TeamSubscriptionFailurePolicy {
  static func shouldInvalidateAuthorization(
    scope: UsageScope,
    isConvexApplicationError: Bool
  ) -> Bool {
    scope == .team && isConvexApplicationError
  }
}

enum LiveEndpoint {
  static let reads = [
    "users:me",
    "usage:hourly",
    "usage:recentSessions",
    "usage:liveNow",
    "usage:myDevices",
    "orgs:byClerkId",
    "orgs:members"
  ]
  static let bootstrapMutations = ["users:ensureUser", "orgs:ensureCurrentOrg"]
}

struct DemoRepository: MobileRepository {
  let isDemo = true
  private let fixture: DemoFixture
  private let viewerID: String

  init(bundle: Bundle = .main, viewerID: String = "user-alex") throws {
    fixture = try DemoFixture.load(bundle: bundle)
    self.viewerID = viewerID
  }

  func load(scope: UsageScope, organizationID: String?) async throws -> RepositoryPayload {
    let sessions = fixture.sessions.filter { session in
      UsageAggregator.isOpenAIModel(session.model) && (scope == .team || session.user.id == viewerID)
    }
    return RepositoryPayload(
      now: fixture.now,
      users: scope == .personal ? fixture.users.filter { $0.id == viewerID } : fixture.users,
      organizations: fixture.organizations,
      rows: scope == .personal ? fixture.rows.filter { $0.u == viewerID } : fixture.rows,
      sessions: sessions,
      members: scope == .team ? fixture.members : [],
      devices: fixture.devices,
      live: scope == .personal ? fixture.live.filter { $0.user.id == viewerID } : fixture.live
    )
  }
}
