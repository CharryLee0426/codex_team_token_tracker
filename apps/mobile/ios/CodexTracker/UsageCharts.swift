import Charts
import SwiftUI

// Swift Charts is Apple's native, localized, accessible chart framework.
// Source: https://developer.apple.com/documentation/Charts
struct UsageOverTimeCard: View {
  let rows: [UsageRow]
  let locale: Locale

  private var daily: [DailyUsage] { UsageAggregator.daily(rows) }

  var body: some View {
    DashboardCard(title: "charts.usage") {
      Chart(daily) { item in
        AreaMark(x: .value("Day", item.day), y: .value("Tokens", item.total))
          .foregroundStyle(Color.appAccent.opacity(0.16))
        LineMark(x: .value("Day", item.day), y: .value("Tokens", item.total))
          .foregroundStyle(Color.appAccent)
          .interpolationMethod(.monotone)
      }
      .chartXAxis(.hidden)
      .chartYAxis {
        AxisMarks(position: .leading) { value in
          AxisGridLine().foregroundStyle(Color.appBorder)
          AxisValueLabel {
            if let number = value.as(Double.self) { Text(AppFormat.tokens(number, locale: locale)) }
          }
        }
      }
      .frame(height: 180)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(Text("charts.usage"))
      .accessibilityValue(daily.map { "\($0.day), \(AppFormat.tokens($0.total, locale: locale))" }.joined(separator: "; "))
      AccessibleDataList(items: daily.map { ($0.day, AppFormat.tokens($0.total, locale: locale)) })
    }
  }
}
struct DistributionCard: View {
  let title: LocalizedStringKey
  let items: [BreakdownItem]
  let locale: Locale

  var body: some View {
    DashboardCard(title: title) {
      Chart(items) { item in
        BarMark(x: .value("Tokens", item.total), y: .value("Name", item.name))
          .foregroundStyle(Color.appAccent.gradient)
          .cornerRadius(3)
      }
      .chartXAxis(.hidden)
      .frame(height: max(140, CGFloat(items.count) * 32))
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(Text(title))
      .accessibilityValue(items.map { "\($0.name), \(AppFormat.percent($0.share, locale: locale))" }.joined(separator: "; "))
      AccessibleDataList(items: items.map {
        ($0.name, "\(AppFormat.tokens($0.total, locale: locale)) · \(AppFormat.percent($0.share, locale: locale))")
      })
    }
  }
}

struct WeekdayCard: View {
  let rows: [UsageRow]
  let locale: Locale

  private var values: [WeekdayUsage] { UsageAggregator.weekdays(rows) }

  var body: some View {
    DashboardCard(title: "charts.weekday") {
      Chart(values) { item in
        BarMark(x: .value("Weekday", weekday(item.weekday)), y: .value("Tokens", item.total))
          .foregroundStyle(Color.appAccent)
          .cornerRadius(3)
      }
      .chartYAxis(.hidden)
      .frame(height: 150)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(Text("charts.weekday"))
      AccessibleDataList(items: values.map { (weekday($0.weekday), AppFormat.tokens($0.total, locale: locale)) })
    }
  }

  private func weekday(_ index: Int) -> String {
    var calendar = Calendar.current
    calendar.locale = locale
    return calendar.shortWeekdaySymbols[index]
  }
}

struct AccessibleDataList: View {
  let items: [(String, String)]
  @State private var expanded = false

  var body: some View {
    DisclosureGroup(isExpanded: $expanded) {
      VStack(spacing: 8) {
        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
          HStack {
            Text(item.0).foregroundStyle(Color.appSecondaryText)
            Spacer()
            Text(item.1).font(.caption.monospacedDigit()).foregroundStyle(Color.appText)
          }
          .font(.caption)
        }
      }
      .padding(.top, 8)
    } label: {
      Label("common.viewData", systemImage: "list.bullet.rectangle")
        .font(.footnote.weight(.medium))
        .foregroundStyle(Color.appAccent)
    }
    .accessibilityIdentifier("chart.data.toggle")
  }
}
