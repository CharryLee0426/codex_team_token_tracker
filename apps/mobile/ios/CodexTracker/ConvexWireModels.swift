@preconcurrency import ConvexMobile
import Foundation

/// Convex encodes exceptional Float64 values as tagged objects. Keep that transport
/// representation out of fixture/domain models and normalize non-finite data at the boundary.
/// https://docs.convex.dev/client/swift/data-types#numerical-types
private func normalizedConvexNumber(_ value: Double) -> Double {
  value.isFinite ? value : 0
}

private func normalizedConvexNumber(_ value: Double?) -> Double? {
  value.map(normalizedConvexNumber)
}

struct ConvexCompactModelUsage: Decodable {
  let model: String
  let agent: String?
  @ConvexFloat var i: Double
  @ConvexFloat var c: Double
  @ConvexFloat var w: Double
  @ConvexFloat var o: Double
  @ConvexFloat var r: Double
  @ConvexFloat var t: Double
  @ConvexFloat var q: Double
  @ConvexFloat var usd: Double

  var domain: CompactModelUsage {
    CompactModelUsage(
      model: model,
      agent: agent,
      i: normalizedConvexNumber(i),
      c: normalizedConvexNumber(c),
      w: normalizedConvexNumber(w),
      o: normalizedConvexNumber(o),
      r: normalizedConvexNumber(r),
      t: normalizedConvexNumber(t),
      q: normalizedConvexNumber(q),
      usd: normalizedConvexNumber(usd)
    )
  }
}

struct ConvexCompactHourRow: Decodable {
  @ConvexFloat var h: Double
  let u: String
  let d: String
  @ConvexFloat var i: Double
  @ConvexFloat var c: Double
  @ConvexFloat var w: Double
  @ConvexFloat var o: Double
  @ConvexFloat var r: Double
  @ConvexFloat var t: Double
  @ConvexFloat var q: Double
  @ConvexFloat var usd: Double
  let m: [ConvexCompactModelUsage]

  var domain: CompactHourRow {
    CompactHourRow(
      h: normalizedConvexNumber(h),
      u: u,
      d: d,
      i: normalizedConvexNumber(i),
      c: normalizedConvexNumber(c),
      w: normalizedConvexNumber(w),
      o: normalizedConvexNumber(o),
      r: normalizedConvexNumber(r),
      t: normalizedConvexNumber(t),
      q: normalizedConvexNumber(q),
      usd: normalizedConvexNumber(usd),
      m: m.map(\.domain)
    )
  }
}

struct ConvexHourlyResponse: Decodable {
  let rows: [ConvexCompactHourRow]
  let users: [PublicUser]
}

struct ConvexLiveSnapshot: Decodable {
  let sessionId: String?
  let model: String?
  @ConvexFloat var tokensPerSecond: Double
  @OptionalConvexFloat var lastEventAt: Double?
  @ConvexFloat var todayTotal: Double
  @ConvexFloat var todayCost: Double
  @ConvexFloat var updatedAt: Double

  var domain: LiveSnapshot {
    LiveSnapshot(
      sessionId: sessionId,
      model: model,
      tokensPerSecond: normalizedConvexNumber(tokensPerSecond),
      lastEventAt: normalizedConvexNumber(lastEventAt),
      todayTotal: normalizedConvexNumber(todayTotal),
      todayCost: normalizedConvexNumber(todayCost),
      updatedAt: normalizedConvexNumber(updatedAt)
    )
  }
}

struct ConvexSessionItem: Decodable {
  let id: String
  let user: PublicUser
  let deviceId: String
  let sessionId: String
  let agent: String
  let model: String
  let projectName: String?
  @ConvexFloat var startedAt: Double
  @ConvexFloat var lastActivityAt: Double
  @ConvexFloat var input: Double
  @ConvexFloat var cached: Double
  @ConvexFloat var cacheWrite: Double
  @ConvexFloat var output: Double
  @ConvexFloat var reasoning: Double
  @ConvexFloat var total: Double
  @ConvexFloat var requests: Double
  @ConvexFloat var cost: Double
  let source: String?
  let cliVersion: String?

  var domain: SessionItem {
    SessionItem(
      id: id,
      user: user,
      deviceId: deviceId,
      sessionId: sessionId,
      agent: agent,
      model: model,
      projectName: projectName,
      startedAt: normalizedConvexNumber(startedAt),
      lastActivityAt: normalizedConvexNumber(lastActivityAt),
      input: normalizedConvexNumber(input),
      cached: normalizedConvexNumber(cached),
      cacheWrite: normalizedConvexNumber(cacheWrite),
      output: normalizedConvexNumber(output),
      reasoning: normalizedConvexNumber(reasoning),
      total: normalizedConvexNumber(total),
      requests: normalizedConvexNumber(requests),
      cost: normalizedConvexNumber(cost),
      source: source,
      cliVersion: cliVersion
    )
  }
}

struct ConvexMemberItem: Decodable {
  let id: String
  let name: String?
  let email: String?
  let imageUrl: String?
  let role: String
  @ConvexFloat var joinedAt: Double
  @ConvexFloat var deviceCount: Double
  @OptionalConvexFloat var lastSeenAt: Double?
  let live: ConvexLiveSnapshot?

  var domain: MemberItem {
    MemberItem(
      id: id,
      name: name,
      email: email,
      imageUrl: imageUrl,
      role: role,
      joinedAt: normalizedConvexNumber(joinedAt),
      deviceCount: normalizedConvexNumber(deviceCount),
      lastSeenAt: normalizedConvexNumber(lastSeenAt),
      live: live?.domain
    )
  }
}

struct ConvexDeviceItem: Decodable {
  let id: String
  let name: String
  let platform: String
  let hostname: String?
  let appVersion: String?
  let timezone: String?
  @ConvexFloat var createdAt: Double
  @ConvexFloat var lastSeenAt: Double
  let live: ConvexLiveSnapshot?
  @ConvexFloat var logins: Double

  var domain: DeviceItem {
    DeviceItem(
      id: id,
      name: name,
      platform: platform,
      hostname: hostname,
      appVersion: appVersion,
      timezone: timezone,
      createdAt: normalizedConvexNumber(createdAt),
      lastSeenAt: normalizedConvexNumber(lastSeenAt),
      live: live?.domain,
      logins: normalizedConvexNumber(logins)
    )
  }
}

struct ConvexLiveItem: Decodable {
  let user: PublicUser
  let deviceId: String
  let deviceName: String
  let platform: String
  let live: ConvexLiveSnapshot

  var domain: LiveItem {
    LiveItem(
      user: user,
      deviceId: deviceId,
      deviceName: deviceName,
      platform: platform,
      live: live.domain
    )
  }
}
