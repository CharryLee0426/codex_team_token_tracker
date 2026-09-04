import SwiftUI

struct SettingsScreen: View {
  @ObservedObject var model: AppModel
  @Binding var appearance: AppAppearance
  @Binding var language: AppLanguage

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 16) {
        ScreenHeader(
          eyebrow: "Codex",
          title: "settings.title",
          subtitle: "settings.subtitle",
          demo: model.isDemo
        )
        accountCard
        preferenceCard
        connectionCard
        DashboardCard(title: "settings.pricing") {
          Text("settings.pricingBody")
            .font(.subheadline)
            .foregroundStyle(Color.appSecondaryText)
        }
        DashboardCard(title: "settings.privacy") {
          Text("settings.privacyBody")
            .font(.subheadline)
            .foregroundStyle(Color.appSecondaryText)
        }
        DashboardCard(title: "settings.about") {
          Label("app.name", systemImage: "chart.bar.doc.horizontal")
            .font(.headline)
          Text(versionLabel)
            .font(.caption.monospaced())
            .foregroundStyle(Color.appSecondaryText)
        }
      }
      .padding(16)
      .frame(maxWidth: 720)
      .frame(maxWidth: .infinity)
    }
    .background(Color.appBackground)
    .accessibilityIdentifier("screen.settings")
  }

  private var accountCard: some View {
    DashboardCard(title: "settings.organization") {
      if let account = model.payloads[.personal]?.users.first {
        HStack(spacing: 12) {
          InitialsAvatar(name: account.displayName)
          VStack(alignment: .leading, spacing: 3) {
            Text(account.displayName).font(.headline)
            if let email = account.email, email != account.displayName {
              Text(email).font(.caption).foregroundStyle(Color.appSecondaryText)
            }
          }
        }
      }
      Text("settings.organizationHint")
        .font(.caption)
        .foregroundStyle(Color.appSecondaryText)
      organizationChoices
      if model.teamUnavailable {
        Label("state.teamUnavailable", systemImage: "exclamationmark.shield")
          .font(.footnote)
          .foregroundStyle(.orange)
      }
      if !model.isDemo {
        Button(role: .destructive) {
          Task { await model.signOut() }
        } label: {
          Label("settings.signOut", systemImage: "rectangle.portrait.and.arrow.right")
            .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)
      }
    }
  }

  @ViewBuilder
  private var organizationChoices: some View {
    let organizations = model.payloads[.personal]?.organizations ?? []
    if organizations.isEmpty {
      Text("state.noOrganizations")
        .font(.subheadline)
        .foregroundStyle(Color.appSecondaryText)
    } else {
      ForEach(organizations) { organization in
        SelectionRow(
          label: organization.name,
          icon: "building.2",
          selected: model.selectedOrganizationID == organization.clerkOrgId,
          identifier: "settings.organization.\(organization.clerkOrgId)"
        ) {
          Task { await model.chooseOrganization(organization.clerkOrgId) }
        }
      }
    }
  }

  private var preferenceCard: some View {
    DashboardCard {
      Text("settings.appearance").font(.headline)
      ForEach(AppAppearance.allCases, id: \.self) { option in
        SelectionRow(
          label: String(localized: String.LocalizationValue(option.localizationKey), locale: language.locale),
          icon: appearanceIcon(option),
          selected: appearance == option,
          identifier: "settings.theme.\(option.rawValue)"
        ) { appearance = option }
      }
      Divider().overlay(Color.appBorder)
      Text("settings.language").font(.headline)
      ForEach(AppLanguage.allCases, id: \.self) { option in
        SelectionRow(
          label: option == .english ? "English" : "简体中文",
          icon: "character.bubble",
          selected: language == option,
          identifier: "settings.language.\(option.rawValue == "en" ? "en" : "zh")"
        ) { language = option }
      }
    }
  }

  private var connectionCard: some View {
    DashboardCard(title: "settings.connection") {
      let key = connectionKey
      Label(LocalizedStringKey(key), systemImage: connectionIcon)
        .foregroundStyle(model.connection == .live ? Color.appAccent : Color.appSecondaryText)
        .accessibilityIdentifier(key)
      #if DEBUG
      if model.isDemo {
        Button(model.connection == .live ? "connection.simulateOffline" : "connection.reconnect") {
          model.simulateConnectionChange()
        }
        .buttonStyle(.bordered)
        .frame(minHeight: 44)
        .accessibilityIdentifier("demo.connection.toggle")
      }
      #endif
    }
  }

  private var connectionKey: String {
    switch model.connection {
    case .live: "connection.live"
    case .reconnecting: "connection.reconnecting"
    case .offline: "connection.offline"
    }
  }

  private var connectionIcon: String {
    switch model.connection {
    case .live: "checkmark.circle.fill"
    case .reconnecting: "arrow.triangle.2.circlepath"
    case .offline: "wifi.slash"
    }
  }

  private var versionLabel: String {
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    return String(format: String(localized: "app.version", locale: language.locale), version)
  }

  private func appearanceIcon(_ option: AppAppearance) -> String {
    switch option {
    case .system: "circle.lefthalf.filled"
    case .light: "sun.max"
    case .dark: "moon"
    }
  }
}

private struct SelectionRow: View {
  let label: String
  let icon: String
  let selected: Bool
  let identifier: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 12) {
        Image(systemName: icon)
          .frame(width: 22)
          .foregroundStyle(Color.appAccent)
        Text(label).foregroundStyle(Color.appText)
        Spacer()
        if selected {
          Image(systemName: "checkmark.circle.fill")
            .foregroundStyle(Color.appAccent)
        }
      }
      .frame(minHeight: 44)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier(identifier)
    .accessibilityValue(selected ? "selected" : "")
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}
