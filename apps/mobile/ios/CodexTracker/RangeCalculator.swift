import Foundation

struct MillisecondRange: Equatable, Sendable {
  let from: Double
  let to: Double
}

struct NormalizedDayRange: Equatable, Sendable {
  let from: String
  let to: String
  let days: Int
}

enum UsageRange: String, CaseIterable, Codable, Sendable {
  case today
  case sevenDays = "7d"
  case thirtyDays = "30d"
  case ninetyDays = "90d"
  case oneYear = "365d"
  case planStart
  case custom

  var localizationKey: String { "range.\(rawValue)" }
}

enum RangeCalculator {
  static let dayMilliseconds = 86_400_000.0
  static let maxChunkMilliseconds = 60 * dayMilliseconds
  static let maxCustomDays = 366
  static let planStartMilliseconds = 1_787_641_200_000.0 // 2026-08-25T00:00:00-07:00

  static func chunks(from: Double, to: Double, maxMilliseconds: Double = maxChunkMilliseconds) -> [MillisecondRange] {
    guard to > from, maxMilliseconds > 0 else { return [] }
    var chunks: [MillisecondRange] = []
    var start = from
    while start < to {
      let end = min(to, start + maxMilliseconds)
      chunks.append(MillisecondRange(from: start, to: end))
      start = end
    }
    return chunks
  }

  static func bounds(
    for range: UsageRange,
    now: Double,
    customFrom: Date,
    customTo: Date,
    calendar: Calendar = .current
  ) -> MillisecondRange {
    let nowDate = Date(timeIntervalSince1970: now / 1_000)
    let liveHour = calendar.dateInterval(of: .hour, for: nowDate)?.start ?? nowDate
    let liveEnd = (calendar.date(byAdding: .hour, value: 1, to: liveHour) ?? nowDate).timeIntervalSince1970 * 1_000
    if range == .planStart {
      return MillisecondRange(from: min(planStartMilliseconds, liveEnd), to: liveEnd)
    }
    if range == .custom {
      let today = dayString(nowDate, calendar: calendar)
      let normalized = normalizeCustom(
        from: dayString(customFrom, calendar: calendar),
        to: dayString(customTo, calendar: calendar),
        today: today,
        calendar: calendar
      )
      let start = date(from: normalized.from, calendar: calendar) ?? nowDate
      let finalDay = date(from: normalized.to, calendar: calendar) ?? nowDate
      let end = calendar.date(byAdding: .day, value: 1, to: finalDay) ?? nowDate
      return MillisecondRange(from: start.timeIntervalSince1970 * 1_000, to: min(end.timeIntervalSince1970 * 1_000, liveEnd))
    }
    let days: Int
    switch range {
    case .today: days = 1
    case .sevenDays: days = 7
    case .thirtyDays: days = 30
    case .ninetyDays: days = 90
    case .oneYear: days = 365
    case .planStart, .custom: days = 1
    }
    let todayStart = calendar.startOfDay(for: nowDate)
    let start = calendar.date(byAdding: .day, value: -(days - 1), to: todayStart) ?? todayStart
    return MillisecondRange(from: start.timeIntervalSince1970 * 1_000, to: liveEnd)
  }

  static func normalizeCustom(from: String, to: String, today: String, calendar: Calendar = .current) -> NormalizedDayRange {
    guard let todayDate = date(from: today, calendar: calendar) else {
      return NormalizedDayRange(from: today, to: today, days: 1)
    }
    var start = date(from: from, calendar: calendar) ?? todayDate
    var end = date(from: to, calendar: calendar) ?? todayDate
    if start > end { swap(&start, &end) }
    if end > todayDate { end = todayDate }
    if start > end { start = end }
    let earliest = calendar.date(byAdding: .day, value: -(maxCustomDays - 1), to: end) ?? end
    if start < earliest { start = earliest }
    let days = max(1, (calendar.dateComponents([.day], from: start, to: end).day ?? 0) + 1)
    return NormalizedDayRange(from: dayString(start, calendar: calendar), to: dayString(end, calendar: calendar), days: days)
  }

  static func dayString(_ date: Date, calendar: Calendar = .current) -> String {
    String(
      format: "%04d-%02d-%02d",
      locale: Locale(identifier: "en_US_POSIX"),
      calendar.component(.year, from: date),
      calendar.component(.month, from: date),
      calendar.component(.day, from: date)
    )
  }

  static func date(from day: String, calendar: Calendar = .current) -> Date? {
    let parts = day.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    let components = DateComponents(calendar: calendar, timeZone: calendar.timeZone, year: parts[0], month: parts[1], day: parts[2])
    guard let value = calendar.date(from: components), dayString(value, calendar: calendar) == day else { return nil }
    return value
  }
}
