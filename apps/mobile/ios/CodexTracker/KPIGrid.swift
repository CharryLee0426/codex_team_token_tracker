import SwiftUI

struct KPIGrid: View {
  let summary: UsageSummary
  let scope: UsageScope
  let deviceCount: Int
  let liveCount: Int
  let locale: Locale

  private let columns = [GridItem(.adaptive(minimum: 145), spacing: 12)]

  var body: some View {
    LazyVGrid(columns: columns, spacing: 12) {
      KPIItem(
        label: "kpi.totalTokens",
        value: AppFormat.tokens(summary.usage.total, locale: locale),
        detail: "↓ \(AppFormat.tokens(summary.usage.input, locale: locale)) · ↑ \(AppFormat.tokens(summary.usage.output, locale: locale))",
        hero: true
      )
      KPIItem(label: "kpi.cost", value: AppFormat.currency(summary.cost, locale: locale), detail: nil)
      KPIItem(
        label: "kpi.cacheHit",
        value: AppFormat.percent(summary.cacheHit, locale: locale),
        detail: AppFormat.tokens(summary.usage.cached, locale: locale)
      )
      KPIItem(
        label: "kpi.requests",
        value: AppFormat.integer(summary.usage.requests, locale: locale),
        detail: summary.usage.requests == 0 ? nil : "Ø \(AppFormat.tokens(summary.averageTokensPerRequest, locale: locale))"
      )
      KPIItem(
        label: scope == .personal ? "kpi.devices" : "kpi.activeMembers",
        value: String(scope == .personal ? deviceCount : summary.activeUsers),
        detail: nil
      )
      KPIItem(label: "kpi.liveNow", value: String(liveCount), detail: liveCount > 0 ? "●" : nil)
    }
  }
}

private struct KPIItem: View {
  let label: String
  let value: String
  let detail: String?
  var hero = false

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(LocalizedStringKey(label))
        .font(.caption.monospaced())
        .textCase(.uppercase)
        .tracking(0.8)
        .foregroundStyle(Color.appMuted)
        .accessibilityIdentifier(label)
      Text(value)
        .font(hero ? .title.bold().monospacedDigit() : .title2.bold().monospacedDigit())
        .foregroundStyle(hero ? Color.appAccent : Color.appText)
        .minimumScaleFactor(0.7)
      if let detail {
        Text(detail).font(.caption.monospacedDigit()).foregroundStyle(Color.appSecondaryText)
      }
    }
    .frame(maxWidth: .infinity, minHeight: 92, alignment: .leading)
    .padding(14)
    .background(Color.appCard, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(Color.appBorder, lineWidth: 0.75) }
    .accessibilityElement(children: .combine)
  }
}
