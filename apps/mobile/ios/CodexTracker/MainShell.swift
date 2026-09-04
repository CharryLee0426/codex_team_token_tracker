import SwiftUI

enum AppTab: String, CaseIterable, Identifiable {
  case personal
  case team
  case members
  case devices
  case settings

  var id: String { rawValue }
  var titleKey: LocalizedStringKey {
    switch self {
    case .personal: "tab.personal"
    case .team: "tab.team"
    case .members: "tab.members"
    case .devices: "tab.devices"
    case .settings: "tab.settings"
    }
  }
  var icon: String {
    switch self {
    case .personal: "chart.xyaxis.line"
    case .team: "person.3.fill"
    case .members: "person.2.fill"
    case .devices: "laptopcomputer.and.iphone"
    case .settings: "gearshape.fill"
    }
  }
}

struct MainShell: View {
  @ObservedObject var model: AppModel
  @Binding var appearance: AppAppearance
  @Binding var language: AppLanguage
  @State private var selection: AppTab = .personal

  var body: some View {
    Group {
      if UIDevice.current.userInterfaceIdiom == .pad {
        NavigationSplitView {
          List(AppTab.allCases) { tab in
            Button {
              selection = tab
            } label: {
              Label(tab.titleKey, systemImage: tab.icon)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .foregroundStyle(selection == tab ? Color.appAccent : Color.appText)
            .accessibilityIdentifier("tab.\(tab.rawValue)")
            .accessibilityAddTraits(selection == tab ? .isSelected : [])
          }
          .navigationTitle("app.name")
        } detail: {
          selectedScreen
        }
      } else {
        selectedScreen
          .safeAreaInset(edge: .bottom, spacing: 0) {
            CompactTabBar(selection: $selection)
          }
      }
    }
    .tint(Color.appAccent)
  }

  @ViewBuilder
  private var selectedScreen: some View {
    switch selection {
    case .personal:
      OverviewScreen(model: model, scope: .personal)
    case .team:
      OverviewScreen(model: model, scope: .team)
    case .members:
      MembersScreen(model: model)
    case .devices:
      DevicesScreen(model: model)
    case .settings:
      SettingsScreen(
        model: model,
        appearance: $appearance,
        language: $language
      )
    }
  }
}

private struct CompactTabBar: View {
  @Binding var selection: AppTab

  var body: some View {
    HStack(spacing: 0) {
      ForEach(AppTab.allCases) { tab in
        Button {
          selection = tab
        } label: {
          VStack(spacing: 4) {
            Image(systemName: tab.icon).font(.system(size: 17, weight: .semibold))
            Text(tab.titleKey)
              .font(.caption2.weight(selection == tab ? .semibold : .regular))
              .lineLimit(1)
              .minimumScaleFactor(0.75)
          }
          .foregroundStyle(selection == tab ? Color.appAccent : Color.appMuted)
          .frame(maxWidth: .infinity, minHeight: 62)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("tab.\(tab.rawValue)")
        .accessibilityAddTraits(selection == tab ? .isSelected : [])
      }
    }
    .background(.ultraThinMaterial)
    .overlay(alignment: .top) { Divider().overlay(Color.appBorder) }
  }
}
