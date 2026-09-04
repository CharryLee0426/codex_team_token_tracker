import XCTest
@testable import CodexTracker

final class UsageDomainTests: XCTestCase {
  func testCompactRowsExpandPerModelAndPreserveUnknownLegacyRows() {
    let rows = [
      CompactHourRow(
        h: 1_000, u: "alex", d: "mac", i: 20, c: 4, w: 1, o: 8, r: 2,
        t: 28, q: 2, usd: 0.2,
        m: [CompactModelUsage(model: "gpt-5.6-sol", agent: nil, i: 20, c: 4, w: 1, o: 8, r: 2, t: 28, q: 2, usd: 0.2)]
      ),
      CompactHourRow(h: 2_000, u: "alex", d: "mac", i: 9, c: 0, w: 0, o: 3, r: 0, t: 12, q: 1, usd: 0.1, m: [])
    ]

    let expanded = UsageAggregator.expand(rows)

    XCTAssertEqual(expanded.map(\.model), ["gpt-5.6-sol", "unknown"])
    XCTAssertEqual(expanded.map(\.agent), ["codex", "codex"])
    XCTAssertEqual(expanded.map(\.usage.total), [28, 12])
  }

  func testOpenAIFilterAcceptsNormalizedAndUnknownModelsOnly() {
    let accepted = ["gpt-5.6-sol", "openai/gpt-5.6-sol-2026-08-28", "o3-mini", "codex-mini", "unknown", ""]
    let rejected = ["claude-sonnet-4", "gemini-2.5-pro", "deepseek-r1", "llama-4"]

    XCTAssertTrue(accepted.allSatisfy(UsageAggregator.isOpenAIModel))
    XCTAssertTrue(rejected.allSatisfy { !UsageAggregator.isOpenAIModel($0) })
  }

  func testSummaryHandlesZeroRequestsWithoutDivisionByZero() {
    let row = UsageRow(
      hourStart: 0, model: "gpt-5.4", agent: "codex", userID: "alex", deviceID: "mac",
      usage: TokenUsage(input: 12, cached: 6, cacheWrite: 0, output: 3, reasoning: 1, total: 15, requests: 0), cost: 0.1
    )

    let summary = UsageAggregator.summary([row])

    XCTAssertEqual(summary.cacheHit, 0.5)
    XCTAssertEqual(summary.averageTokensPerRequest, 0)
  }

  func testSixtyDayChunksAreConsecutiveAndHalfOpen() {
    let day = 86_400_000.0

    let chunks = RangeCalculator.chunks(from: 0, to: day * 121)

    XCTAssertEqual(chunks, [
      MillisecondRange(from: 0, to: day * 60),
      MillisecondRange(from: day * 60, to: day * 120),
      MillisecondRange(from: day * 120, to: day * 121)
    ])
  }

  func testCustomRangeEndsTodayAndCapsAt366CalendarDays() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!

    let normalized = RangeCalculator.normalizeCustom(
      from: "2024-01-01", to: "2027-01-01", today: "2026-09-04", calendar: calendar
    )

    XCTAssertEqual(normalized.from, "2025-09-04")
    XCTAssertEqual(normalized.to, "2026-09-04")
    XCTAssertEqual(normalized.days, 366)
  }

  func testLocalDayGroupingHonorsSpringDSTBoundary() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
    let beforeMidnight = ISO8601DateFormatter().date(from: "2026-03-08T07:30:00Z")!.timeIntervalSince1970 * 1_000
    let afterMidnight = ISO8601DateFormatter().date(from: "2026-03-08T08:30:00Z")!.timeIntervalSince1970 * 1_000
    let rows = [beforeMidnight, afterMidnight].map {
      UsageRow(
        hourStart: $0, model: "gpt-5.4", agent: "codex", userID: "alex", deviceID: "mac",
        usage: TokenUsage(input: 10, cached: 0, cacheWrite: 0, output: 2, reasoning: 0, total: 12, requests: 1), cost: 0.01
      )
    }

    let days = UsageAggregator.daily(rows, calendar: calendar)

    XCTAssertEqual(days.map(\.day), ["2026-03-07", "2026-03-08"])
    XCTAssertEqual(days.map(\.total), [12, 12])
  }

  func testNinthAndLaterModelsFoldIntoOther() {
    let rows = (0..<10).map { index in
      UsageRow(
        hourStart: Double(index), model: "gpt-5.\(index)", agent: index.isMultiple(of: 2) ? "codex" : "cline",
        userID: "alex", deviceID: "mac",
        usage: TokenUsage(input: 1, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 1, requests: 1), cost: 0.01
      )
    }

    let models = UsageAggregator.modelBreakdown(rows, maxModels: 8)

    XCTAssertEqual(models.count, 9)
    XCTAssertEqual(models.last?.name, UsageAggregator.otherModelName)
    XCTAssertEqual(models.last?.total, 2)
  }
}
