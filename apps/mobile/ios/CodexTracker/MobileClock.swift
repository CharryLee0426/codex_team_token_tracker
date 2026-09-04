import Foundation

@MainActor
struct MobileClock {
  let now: () -> Date
  let sleep: (Duration) async throws -> Void

  var nowMilliseconds: Double {
    now().timeIntervalSince1970 * 1_000
  }

  static let system = MobileClock(
    now: Date.init,
    sleep: { duration in try await Task.sleep(for: duration) }
  )
}

struct ClockRefreshMarker: Equatable, Sendable {
  let utcHour: Int64
  let localDay: String
}

enum ClockRefreshPolicy {
  static func marker(at date: Date, calendar: Calendar = .current) -> ClockRefreshMarker {
    ClockRefreshMarker(
      utcHour: Int64(floor(date.timeIntervalSince1970 / 3_600)),
      localDay: RangeCalculator.dayString(date, calendar: calendar)
    )
  }

  static func shouldRefresh(from previous: ClockRefreshMarker, to current: ClockRefreshMarker) -> Bool {
    previous != current
  }
}

enum LiveFreshness {
  static let maximumAgeMilliseconds = 2 * 60 * 1_000.0

  static func isFresh(updatedAt: Double, now: Double) -> Bool {
    updatedAt.isFinite && now.isFinite && now - updatedAt < maximumAgeMilliseconds
  }
}

extension RepositoryPayload {
  func advanced(to currentTime: Double) -> RepositoryPayload {
    RepositoryPayload(
      now: currentTime,
      users: users,
      organizations: organizations,
      rows: rows,
      sessions: sessions,
      members: members.map { member in
        MemberItem(
          id: member.id,
          name: member.name,
          email: member.email,
          imageUrl: member.imageUrl,
          role: member.role,
          joinedAt: member.joinedAt,
          deviceCount: member.deviceCount,
          lastSeenAt: member.lastSeenAt,
          live: member.live.flatMap {
            LiveFreshness.isFresh(updatedAt: $0.updatedAt, now: currentTime) ? $0 : nil
          }
        )
      },
      devices: devices.map { device in
        DeviceItem(
          id: device.id,
          name: device.name,
          platform: device.platform,
          hostname: device.hostname,
          appVersion: device.appVersion,
          timezone: device.timezone,
          createdAt: device.createdAt,
          lastSeenAt: device.lastSeenAt,
          live: device.live.flatMap {
            LiveFreshness.isFresh(updatedAt: $0.updatedAt, now: currentTime) ? $0 : nil
          },
          logins: device.logins
        )
      },
      live: live.filter {
        LiveFreshness.isFresh(updatedAt: $0.live.updatedAt, now: currentTime)
      }
    )
  }
}
