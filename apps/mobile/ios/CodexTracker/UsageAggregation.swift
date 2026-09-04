import Foundation

struct UsageSummary: Equatable, Sendable {
  let usage: TokenUsage
  let cost: Double
  let cacheHit: Double
  let averageTokensPerRequest: Double
  let activeUsers: Int
  let models: Int
}

struct DailyUsage: Equatable, Identifiable, Sendable {
  var id: String { day }
  let day: String
  let total: Double
  let cost: Double
}

struct BreakdownItem: Equatable, Identifiable, Sendable {
  var id: String { name }
  let name: String
  let total: Double
  let cost: Double
  let share: Double
}

struct ActivityCell: Equatable, Identifiable, Sendable {
  var id: String { "\(weekday)-\(hour)" }
  let weekday: Int
  let hour: Int
  let total: Double
}

struct WeekdayUsage: Equatable, Identifiable, Sendable {
  var id: Int { weekday }
  let weekday: Int
  let total: Double
}

enum UsageAggregator {
  static let otherModelName = "Other"

  static func expand(_ compactRows: [CompactHourRow]) -> [UsageRow] {
    compactRows.flatMap { row in
      let models = row.m.isEmpty
        ? [CompactModelUsage(model: "unknown", agent: nil, i: row.i, c: row.c, w: row.w, o: row.o, r: row.r, t: row.t, q: row.q, usd: row.usd)]
        : row.m
      return models.map { model in
        UsageRow(
          hourStart: row.h,
          model: model.model.isEmpty ? "unknown" : model.model,
          agent: model.agent ?? "codex",
          userID: row.u,
          deviceID: row.d,
          usage: TokenUsage(
            input: model.i, cached: model.c, cacheWrite: model.w, output: model.o,
            reasoning: model.r, total: model.t, requests: model.q
          ),
          cost: model.usd
        )
      }
    }
  }

  static func normalizeModel(_ model: String) -> String {
    var normalized = model.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if normalized.isEmpty { return "unknown" }
    if normalized.hasPrefix("openai/") { normalized.removeFirst("openai/".count) }
    normalized = normalized.replacingOccurrences(of: #"-\d{4}-\d{2}-\d{2}$"#, with: "", options: .regularExpression)
    if normalized.hasSuffix("-preview") { normalized.removeLast("-preview".count) }
    return normalized
  }

  static func isOpenAIModel(_ model: String) -> Bool {
    let normalized = normalizeModel(model)
    if normalized == "unknown" { return true }
    return normalized.range(
      of: #"^(gpt[-.]|chatgpt|chat-latest|o[1-9](?:[-.]|$)|codex|text-|davinci|babbage|ada|curie)"#,
      options: .regularExpression
    ) != nil
  }

  static func filterCodex(_ rows: [UsageRow]) -> [UsageRow] {
    rows.filter { isOpenAIModel($0.model) && $0.cost.isFinite && $0.cost >= 0 }
  }

  static func summary(_ rows: [UsageRow]) -> UsageSummary {
    let validRows = filterCodex(rows)
    let usage = validRows.reduce(.zero) { $0 + $1.usage }
    let cost = validRows.reduce(0) { $0 + $1.cost }
    return UsageSummary(
      usage: usage,
      cost: cost,
      cacheHit: usage.input == 0 ? 0 : min(1, max(0, usage.cached / usage.input)),
      averageTokensPerRequest: usage.requests == 0 ? 0 : usage.total / usage.requests,
      activeUsers: Set(validRows.map(\.userID)).count,
      models: Set(validRows.map(\.model)).count
    )
  }

  static func daily(_ rows: [UsageRow], calendar: Calendar = .current) -> [DailyUsage] {
    let formatter = dayFormatter(calendar: calendar)
    let grouped = Dictionary(grouping: filterCodex(rows)) { row in
      formatter.string(from: Date(timeIntervalSince1970: row.hourStart / 1_000))
    }
    return grouped.keys.sorted().map { day in
      let values = grouped[day, default: []]
      return DailyUsage(
        day: day,
        total: values.reduce(0) { $0 + $1.usage.total },
        cost: values.reduce(0) { $0 + $1.cost }
      )
    }
  }

  static func modelBreakdown(_ rows: [UsageRow], maxModels: Int = 8) -> [BreakdownItem] {
    breakdown(filterCodex(rows), key: \.model, limit: maxModels, overflowName: otherModelName)
  }

  static func sourceBreakdown(_ rows: [UsageRow]) -> [BreakdownItem] {
    breakdown(filterCodex(rows), key: \.agent)
  }

  static func memberBreakdown(_ rows: [UsageRow], users: [PublicUser]) -> [BreakdownItem] {
    let names = Dictionary(uniqueKeysWithValues: users.map { ($0.id, $0.displayName) })
    let normalized = filterCodex(rows).map { row in
      UsageRow(
        hourStart: row.hourStart, model: row.model, agent: row.agent,
        userID: names[row.userID] ?? row.userID, deviceID: row.deviceID,
        usage: row.usage, cost: row.cost
      )
    }
    return breakdown(normalized, key: \.userID)
  }

  static func activeHours(_ rows: [UsageRow], calendar: Calendar = .current) -> [ActivityCell] {
    var totals: [String: Double] = [:]
    for row in filterCodex(rows) {
      let date = Date(timeIntervalSince1970: row.hourStart / 1_000)
      let weekday = calendar.component(.weekday, from: date) - 1
      let hour = calendar.component(.hour, from: date)
      totals["\(weekday)-\(hour)", default: 0] += row.usage.total
    }
    return (0..<7).flatMap { weekday in
      (0..<24).map { hour in
        ActivityCell(weekday: weekday, hour: hour, total: totals["\(weekday)-\(hour)", default: 0])
      }
    }
  }

  static func weekdays(_ rows: [UsageRow], calendar: Calendar = .current) -> [WeekdayUsage] {
    let cells = activeHours(rows, calendar: calendar)
    return [1, 2, 3, 4, 5, 6, 0].map { weekday in
      WeekdayUsage(weekday: weekday, total: cells.filter { $0.weekday == weekday }.reduce(0) { $0 + $1.total })
    }
  }

  private static func breakdown(
    _ rows: [UsageRow],
    key: KeyPath<UsageRow, String>,
    limit: Int? = nil,
    overflowName: String? = nil
  ) -> [BreakdownItem] {
    struct NamedTotal {
      let name: String
      let total: Double
      let cost: Double
    }
    let buckets = Dictionary(grouping: rows) { $0[keyPath: key] }
    let unsorted: [NamedTotal] = buckets.map { name, values in
      let total = values.reduce(0.0) { result, row in result + row.usage.total }
      let cost = values.reduce(0.0) { result, row in result + row.cost }
      return NamedTotal(name: name, total: total, cost: cost)
    }
    let grouped = unsorted.sorted { lhs, rhs in
      lhs.total == rhs.total ? lhs.name < rhs.name : lhs.total > rhs.total
    }
    let grandTotal = grouped.reduce(0.0) { $0 + $1.total }
    guard let limit, grouped.count > limit, let overflowName else {
      return grouped.map { BreakdownItem(name: $0.name, total: $0.total, cost: $0.cost, share: grandTotal == 0 ? 0 : $0.total / grandTotal) }
    }
    let shown = grouped.prefix(limit)
    let hidden = grouped.dropFirst(limit)
    var output = shown.map {
      BreakdownItem(name: $0.name, total: $0.total, cost: $0.cost, share: grandTotal == 0 ? 0 : $0.total / grandTotal)
    }
    let hiddenTotal = hidden.reduce(0.0) { $0 + $1.total }
    let hiddenCost = hidden.reduce(0.0) { $0 + $1.cost }
    output.append(BreakdownItem(
      name: overflowName,
      total: hiddenTotal,
      cost: hiddenCost,
      share: grandTotal == 0 ? 0 : hiddenTotal / grandTotal
    ))
    return output
  }

  private static func dayFormatter(calendar: Calendar) -> DateFormatter {
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter
  }
}
