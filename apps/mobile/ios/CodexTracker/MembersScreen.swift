import SwiftUI

struct MembersScreen: View {
  @ObservedObject var model: AppModel

  var body: some View {
    ZStack {
      Color.appBackground.ignoresSafeArea()
      content
    }
    .accessibilityIdentifier("screen.members")
    .task {
      guard model.selectedOrganizationID != nil, model.payloads[.team] == nil else { return }
      await model.load(scope: .team)
    }
  }

  @ViewBuilder
  private var content: some View {
    if model.selectedOrganizationID == nil {
      MembersOrganizationState(model: model)
    } else if model.teamUnavailable {
      MembersOrganizationState(model: model)
    } else if let payload = model.payloads[.team] {
      MembersList(model: model, payload: payload)
    } else if case .failed = model.phase {
      MembersErrorState(model: model)
    } else {
      MembersLoadingState()
    }
  }
}

private struct MembersList: View {
  @ObservedObject var model: AppModel
  let payload: RepositoryPayload
  @Environment(\.locale) private var locale

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 16) {
        ScreenHeader(
          eyebrow: organizationName,
          title: "members.title",
          subtitle: "members.subtitle",
          demo: model.isDemo
        )
        StatusBanner(state: model.connection, stale: model.staleScopes.contains(.team))

        if payload.members.isEmpty {
          DashboardCard {
            Label("state.emptyMembers", systemImage: "person.3")
              .font(.subheadline)
              .foregroundStyle(Color.appSecondaryText)
              .frame(maxWidth: .infinity, minHeight: 112)
              .accessibilityAddTraits(.isStaticText)
          }
        } else {
          ForEach(payload.members) { member in
            MemberCard(member: member, now: payload.now, locale: locale)
          }
        }
      }
      .padding(16)
      .frame(maxWidth: 900)
      .frame(maxWidth: .infinity)
    }
    .refreshable { await model.load(scope: .team) }
  }

  private var organizationName: String {
    payload.organizations.first { $0.clerkOrgId == model.selectedOrganizationID }?.name ?? "Codex"
  }
}

private struct MemberCard: View {
  let member: MemberItem
  let now: Double
  let locale: Locale

  var body: some View {
    DashboardCard {
      HStack(alignment: .top, spacing: 12) {
        MemberAvatar(member: member)

        VStack(alignment: .leading, spacing: 3) {
          Text(member.displayName)
            .font(.headline)
            .foregroundStyle(Color.appText)
            .lineLimit(1)
          if let email = member.email, email != member.displayName {
            Text(email)
              .font(.caption)
              .foregroundStyle(Color.appSecondaryText)
              .lineLimit(1)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)

        MemberRoleBadge(role: member.role)
      }

      Divider().overlay(Color.appBorder)

      if let live = member.live {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Circle()
            .fill(.green)
            .frame(width: 7, height: 7)
            .accessibilityHidden(true)
          Text(liveDescription(live))
            .font(.subheadline.monospacedDigit())
            .foregroundStyle(Color.appText)
            .fixedSize(horizontal: false, vertical: true)
        }
      } else {
        Label("members.offline", systemImage: "moon.zzz")
          .font(.subheadline)
          .foregroundStyle(Color.appMuted)
      }

      ViewThatFits(in: .horizontal) {
        HStack(spacing: 14) { metadata }
        VStack(alignment: .leading, spacing: 8) { metadata }
      }
      .font(.caption)
      .foregroundStyle(Color.appSecondaryText)
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel(accessibilitySummary)
  }

  @ViewBuilder
  private var metadata: some View {
    Label(deviceCount, systemImage: "laptopcomputer.and.iphone")
    Label(lastSeen, systemImage: "clock")
    Label(joined, systemImage: "calendar")
  }

  private var deviceCount: String {
    formatted("members.devices", AppFormat.integer(member.deviceCount, locale: locale))
  }

  private var lastSeen: String {
    guard let lastSeenAt = member.lastSeenAt else { return String(localized: "common.unknown", locale: locale) }
    return formatted(
      "devices.lastSeen",
      AppFormat.relative(lastSeenAt, now: now, locale: locale)
    )
  }

  private var joined: String {
    formatted("members.joined", AppFormat.date(member.joinedAt, locale: locale))
  }

  private var accessibilitySummary: String {
    let status = member.live.map(liveDescription) ?? String(localized: "members.offline", locale: locale)
    return [member.displayName, roleName, status, deviceCount, lastSeen, joined].joined(separator: ", ")
  }

  private var roleName: String {
    switch member.role {
    case "org:admin": String(localized: "members.admin", locale: locale)
    case "org:member": String(localized: "members.member", locale: locale)
    default: member.role.replacingOccurrences(of: "org:", with: "")
    }
  }

  private func liveDescription(_ live: LiveSnapshot) -> String {
    formatted(
      "members.live",
      live.model ?? String(localized: "common.unknown", locale: locale),
      live.tokensPerSecond.formatted(.number.precision(.fractionLength(1)).locale(locale))
    )
  }

  private func formatted(_ key: String, _ arguments: CVarArg...) -> String {
    let template: String
    switch key {
    case "members.devices": template = String(localized: "members.devices", locale: locale)
    case "members.joined": template = String(localized: "members.joined", locale: locale)
    case "members.live": template = String(localized: "members.live", locale: locale)
    case "devices.lastSeen": template = String(localized: "devices.lastSeen", locale: locale)
    default: return key
    }
    return String(format: template, locale: locale, arguments: arguments)
  }
}

private struct MemberAvatar: View {
  let member: MemberItem

  var body: some View {
    if let imageUrl = member.imageUrl, let url = URL(string: imageUrl) {
      AsyncImage(url: url) { phase in
        switch phase {
        case let .success(image):
          image.resizable().scaledToFill()
        default:
          InitialsAvatar(name: member.displayName)
        }
      }
      .frame(width: 42, height: 42)
      .clipShape(Circle())
      .accessibilityHidden(true)
    } else {
      InitialsAvatar(name: member.displayName)
    }
  }
}

private struct MemberRoleBadge: View {
  let role: String

  var body: some View {
    Text(label)
      .font(.caption2.weight(.semibold))
      .foregroundStyle(role == "org:admin" ? Color.appAccent : Color.appSecondaryText)
      .padding(.horizontal, 9)
      .padding(.vertical, 5)
      .background(
        role == "org:admin" ? Color.appAccent.opacity(0.12) : Color.appCardSecondary,
        in: Capsule()
      )
  }

  private var label: LocalizedStringKey {
    switch role {
    case "org:admin": "members.admin"
    case "org:member": "members.member"
    default: LocalizedStringKey(role.replacingOccurrences(of: "org:", with: ""))
    }
  }
}

private struct MembersOrganizationState: View {
  @ObservedObject var model: AppModel

  var body: some View {
    ContentUnavailableView {
      Label("state.noOrganization", systemImage: "person.3.sequence")
    } description: {
      if model.teamUnavailable {
        Text("state.teamUnavailable")
      } else if organizations.isEmpty {
        Text("state.noOrganizations")
      } else {
        Text("settings.organizationHint")
      }
    } actions: {
      ForEach(organizations) { organization in
        Button(organization.name) {
          Task { await model.chooseOrganization(organization.clerkOrgId) }
        }
        .buttonStyle(.borderedProminent)
        .tint(Color.appAccent)
        .frame(minHeight: 44)
      }
    }
  }

  private var organizations: [Organization] {
    model.payloads[.personal]?.organizations ?? []
  }
}

private struct MembersErrorState: View {
  @ObservedObject var model: AppModel

  var body: some View {
    ContentUnavailableView {
      Label("error.load", systemImage: "exclamationmark.triangle")
    } actions: {
      Button("common.retry") { Task { await model.retry() } }
        .buttonStyle(.borderedProminent)
        .tint(Color.appAccent)
        .frame(minHeight: 44)
    }
  }
}

private struct MembersLoadingState: View {
  var body: some View {
    VStack(spacing: 14) {
      ProgressView()
      Text("state.loading").foregroundStyle(Color.appSecondaryText)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.updatesFrequently)
  }
}
