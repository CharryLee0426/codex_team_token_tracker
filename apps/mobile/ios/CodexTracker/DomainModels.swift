import Foundation

struct TokenUsage: Codable, Equatable, Sendable {
  var input: Double
  var cached: Double
  var cacheWrite: Double
  var output: Double
  var reasoning: Double
  var total: Double
  var requests: Double

  static let zero = TokenUsage(input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0, requests: 0)

  static func + (lhs: TokenUsage, rhs: TokenUsage) -> TokenUsage {
    TokenUsage(
      input: lhs.input + rhs.input,
      cached: lhs.cached + rhs.cached,
      cacheWrite: lhs.cacheWrite + rhs.cacheWrite,
      output: lhs.output + rhs.output,
      reasoning: lhs.reasoning + rhs.reasoning,
      total: lhs.total + rhs.total,
      requests: lhs.requests + rhs.requests
    )
  }
}
struct CompactModelUsage: Codable, Equatable, Sendable {
  let model: String
  let agent: String?
  let i: Double
  let c: Double
  let w: Double
  let o: Double
  let r: Double
  let t: Double
  let q: Double
  let usd: Double
}

struct CompactHourRow: Codable, Equatable, Sendable {
  let h: Double
  let u: String
  let d: String
  let i: Double
  let c: Double
  let w: Double
  let o: Double
  let r: Double
  let t: Double
  let q: Double
  let usd: Double
  let m: [CompactModelUsage]
}

struct UsageRow: Equatable, Sendable {
  let hourStart: Double
  let model: String
  let agent: String
  let userID: String
  let deviceID: String
  let usage: TokenUsage
  let cost: Double
}

struct PublicUser: Codable, Equatable, Identifiable, Sendable {
  let id: String
  let name: String?
  let email: String?
  let imageUrl: String?

  var displayName: String { name ?? email ?? String(localized: "common.unknownUser") }
}

struct Organization: Codable, Equatable, Identifiable, Sendable {
  let id: String
  let clerkOrgId: String
  let name: String
  let slug: String?
  let imageUrl: String?
  let role: String
}

struct LiveSnapshot: Codable, Equatable, Sendable {
  let sessionId: String?
  let model: String?
  let tokensPerSecond: Double
  let lastEventAt: Double?
  let todayTotal: Double
  let todayCost: Double
  let updatedAt: Double
}

struct SessionItem: Codable, Equatable, Identifiable, Sendable {
  let id: String
  let user: PublicUser
  let deviceId: String
  let sessionId: String
  let agent: String
  let model: String
  let projectName: String?
  let startedAt: Double
  let lastActivityAt: Double
  let input: Double
  let cached: Double
  let cacheWrite: Double
  let output: Double
  let reasoning: Double
  let total: Double
  let requests: Double
  let cost: Double
  let source: String?
  let cliVersion: String?
}

struct MemberItem: Codable, Equatable, Identifiable, Sendable {
  let id: String
  let name: String?
  let email: String?
  let imageUrl: String?
  let role: String
  let joinedAt: Double
  let deviceCount: Double
  let lastSeenAt: Double?
  let live: LiveSnapshot?

  var displayName: String { name ?? email ?? String(localized: "common.unknownUser") }
}

struct DeviceItem: Codable, Equatable, Identifiable, Sendable {
  let id: String
  let name: String
  let platform: String
  let hostname: String?
  let appVersion: String?
  let timezone: String?
  let createdAt: Double
  let lastSeenAt: Double
  let live: LiveSnapshot?
  let logins: Double
}

struct LiveItem: Codable, Equatable, Sendable {
  let user: PublicUser
  let deviceId: String
  let deviceName: String
  let platform: String
  let live: LiveSnapshot
}

struct ExpectedMetrics: Codable, Equatable, Sendable {
  let input: Double
  let cached: Double
  let cacheWrite: Double
  let output: Double
  let reasoning: Double
  let total: Double
  let requests: Double
  let cost: Double
  let activeUsers: Int
  let models: Int
}

struct FixtureExpectations: Codable, Equatable, Sendable {
  let personal: ExpectedMetrics
  let team: ExpectedMetrics
}

struct DemoFixture: Codable, Equatable, Sendable {
  let now: Double
  let expected: FixtureExpectations
  let users: [PublicUser]
  let organizations: [Organization]
  let rows: [CompactHourRow]
  let sessions: [SessionItem]
  let members: [MemberItem]
  let devices: [DeviceItem]
  let live: [LiveItem]

  static func load(bundle: Bundle = .main) throws -> DemoFixture {
    guard let url = bundle.url(forResource: "dashboard-demo", withExtension: "json") else {
      throw CocoaError(.fileNoSuchFile)
    }
    return try JSONDecoder().decode(DemoFixture.self, from: Data(contentsOf: url))
  }
}
