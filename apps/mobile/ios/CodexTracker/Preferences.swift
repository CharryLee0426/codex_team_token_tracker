import SwiftUI

enum AppAppearance: String, CaseIterable {
  case system
  case light
  case dark

  var localizationKey: String { "theme.\(rawValue)" }
  var colorScheme: ColorScheme? {
    switch self {
    case .system: nil
    case .light: .light
    case .dark: .dark
    }
  }
}
enum AppLanguage: String, CaseIterable {
  case english = "en"
  case simplifiedChinese = "zh-Hans"

  var localizationKey: String {
    switch self {
    case .english: "language.en"
    case .simplifiedChinese: "language.zh"
    }
  }

  var locale: Locale { Locale(identifier: rawValue) }
}

enum AppFormat {
  static func tokens(_ value: Double, locale: Locale) -> String {
    value.formatted(.number.notation(.compactName).precision(.fractionLength(0...1)).locale(locale))
  }

  static func integer(_ value: Double, locale: Locale) -> String {
    value.formatted(.number.precision(.fractionLength(0)).locale(locale))
  }

  static func currency(_ value: Double, locale: Locale) -> String {
    value.formatted(.currency(code: "USD").precision(.fractionLength(2)).locale(locale))
  }

  static func percent(_ value: Double, locale: Locale) -> String {
    value.formatted(.percent.precision(.fractionLength(0)).locale(locale))
  }

  static func date(_ milliseconds: Double, locale: Locale) -> String {
    Date(timeIntervalSince1970: milliseconds / 1_000).formatted(
      Date.FormatStyle(date: .abbreviated, time: .omitted, locale: locale)
    )
  }

  static func relative(_ milliseconds: Double, now: Double, locale: Locale) -> String {
    let formatter = RelativeDateTimeFormatter()
    formatter.locale = locale
    formatter.unitsStyle = .abbreviated
    return formatter.localizedString(
      for: Date(timeIntervalSince1970: milliseconds / 1_000),
      relativeTo: Date(timeIntervalSince1970: now / 1_000)
    )
  }
}
