import SwiftUI
import UIKit

extension UIColor {
  convenience init(hex: UInt32) {
    self.init(
      red: CGFloat((hex >> 16) & 0xff) / 255,
      green: CGFloat((hex >> 8) & 0xff) / 255,
      blue: CGFloat(hex & 0xff) / 255,
      alpha: 1
    )
  }
}
extension Color {
  static let appBackground = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0x05070d) : UIColor(hex: 0xf3f5fa) })
  static let appCard = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0x0c1220) : .white })
  static let appCardSecondary = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0x121a2b) : UIColor(hex: 0xeef2f8) })
  static let appText = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0xe8edf7) : UIColor(hex: 0x0b1220) })
  static let appSecondaryText = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0xa7b1c6) : UIColor(hex: 0x4b5670) })
  static let appMuted = Color(uiColor: UIColor(hex: 0x6f7a93))
  static let appAccent = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0x5cc8ff) : UIColor(hex: 0x0369a1) })
  static let appBorder = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0x283146) : UIColor(hex: 0xd9dee8) })
}

struct DashboardCard<Content: View>: View {
  let title: LocalizedStringKey?
  @ViewBuilder let content: Content

  init(title: LocalizedStringKey? = nil, @ViewBuilder content: () -> Content) {
    self.title = title
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      if let title {
        Text(title)
          .font(.headline)
          .foregroundStyle(Color.appText)
      }
      content
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(16)
    .background(Color.appCard, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .stroke(Color.appBorder, lineWidth: 0.75)
    }
  }
}

struct ScreenHeader: View {
  let eyebrow: String
  let title: LocalizedStringKey
  let subtitle: LocalizedStringKey
  let demo: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Text(eyebrow.uppercased())
          .font(.caption2.monospaced())
          .tracking(1.8)
          .foregroundStyle(Color.appMuted)
        if demo {
          Text("demo.badge")
            .font(.caption2.bold().monospaced())
            .foregroundStyle(Color.appAccent)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.appAccent.opacity(0.12), in: Capsule())
        }
      }
      Text(title)
        .font(.largeTitle.bold())
        .foregroundStyle(Color.appText)
        .accessibilityAddTraits(.isHeader)
      Text(subtitle)
        .font(.subheadline)
        .foregroundStyle(Color.appSecondaryText)
    }
  }
}

struct StatusBanner: View {
  let state: ConnectionState
  let stale: Bool

  var body: some View {
    if state != .live || stale {
      Label {
        Text(state == .offline ? "connection.offline" : state == .reconnecting ? "connection.reconnecting" : "state.stale")
      } icon: {
        Image(systemName: state == .offline ? "wifi.slash" : "arrow.triangle.2.circlepath")
      }
      .font(.footnote.weight(.medium))
      .foregroundStyle(state == .offline ? .orange : Color.appAccent)
      .padding(12)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Color.appCardSecondary, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
      .accessibilityIdentifier(state == .offline ? "connection.offline" : state == .reconnecting ? "connection.reconnecting" : "state.stale")
    }
  }
}

struct InitialsAvatar: View {
  let name: String

  var body: some View {
    Text(initials)
      .font(.subheadline.bold())
      .foregroundStyle(Color.appAccent)
      .frame(width: 42, height: 42)
      .background(Color.appAccent.opacity(0.13), in: Circle())
      .accessibilityHidden(true)
  }

  private var initials: String {
    name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
  }
}
