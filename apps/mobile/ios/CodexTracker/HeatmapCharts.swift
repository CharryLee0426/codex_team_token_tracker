import SwiftUI

struct ContributionHeatmapCard: View {
  let rows: [UsageRow]
  let now: Double
  let locale: Locale

  private var cells: [(day: String, total: Double)] {
    let calendar = Calendar.current
    let end = calendar.startOfDay(for: Date(timeIntervalSince1970: now / 1_000))
    let totals = Dictionary(uniqueKeysWithValues: UsageAggregator.daily(rows, calendar: calendar).map { ($0.day, $0.total) })
    return (0..<(26 * 7)).reversed().compactMap { offset in
      guard let date = calendar.date(byAdding: .day, value: -offset, to: end) else { return nil }
      let day = RangeCalculator.dayString(date, calendar: calendar)
      return (day, totals[day, default: 0])
    }
  }

  var body: some View {
    let values = cells
    let maximum = values.map(\.total).max() ?? 0
    DashboardCard(title: "charts.contribution") {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(alignment: .top, spacing: 3) {
          ForEach(0..<26, id: \.self) { week in
            VStack(spacing: 3) {
              ForEach(0..<7, id: \.self) { day in
                let cell = values[week * 7 + day]
                RoundedRectangle(cornerRadius: 2)
                  .fill(color(for: cell.total, maximum: maximum))
                  .frame(width: 11, height: 11)
                  .accessibilityLabel("\(cell.day), \(AppFormat.tokens(cell.total, locale: locale))")
              }
            }
          }
        }
        .padding(.vertical, 2)
      }
      .accessibilityElement(children: .contain)
      AccessibleDataList(items: values.filter { $0.total > 0 }.map { ($0.day, AppFormat.tokens($0.total, locale: locale)) })
    }
  }

  private func color(for total: Double, maximum: Double) -> Color {
    guard total > 0, maximum > 0 else { return Color.appCardSecondary }
    return Color.appAccent.opacity(0.2 + 0.8 * total / maximum)
  }
}

struct ActiveHoursCard: View {
  let rows: [UsageRow]
  let locale: Locale

  private var cells: [ActivityCell] { UsageAggregator.activeHours(rows) }

  var body: some View {
    let values = cells
    let maximum = values.map(\.total).max() ?? 0
    DashboardCard(title: "charts.activeHours") {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 3) {
          ForEach(0..<24, id: \.self) { hour in
            VStack(spacing: 3) {
              ForEach(0..<7, id: \.self) { row in
                let weekday = [1, 2, 3, 4, 5, 6, 0][row]
                let cell = values.first { $0.weekday == weekday && $0.hour == hour }!
                RoundedRectangle(cornerRadius: 2)
                  .fill(color(for: cell.total, maximum: maximum))
                  .frame(width: 11, height: 11)
                  .accessibilityLabel("\(weekdayName(weekday)), \(hour):00, \(AppFormat.tokens(cell.total, locale: locale))")
              }
            }
          }
        }
        .padding(.vertical, 2)
      }
      .accessibilityElement(children: .contain)
      AccessibleDataList(items: values.filter { $0.total > 0 }.map {
        ("\(weekdayName($0.weekday)) \($0.hour):00", AppFormat.tokens($0.total, locale: locale))
      })
    }
  }

  private func color(for total: Double, maximum: Double) -> Color {
    guard total > 0, maximum > 0 else { return Color.appCardSecondary }
    return Color.appAccent.opacity(0.2 + 0.8 * total / maximum)
  }

  private func weekdayName(_ index: Int) -> String {
    var calendar = Calendar.current
    calendar.locale = locale
    return calendar.shortWeekdaySymbols[index]
  }
}
