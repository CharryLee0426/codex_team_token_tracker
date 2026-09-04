import SwiftUI

struct OverviewScreen: View {
  @ObservedObject var model: AppModel
  let scope: UsageScope
  @Environment(\.locale) private var locale

  var body: some View {
    Group {
      if scope == .team && (model.selectedOrganizationID == nil || model.teamUnavailable) {
        OrganizationRequiredView(model: model)
      } else if let payload = model.payloads[scope] {
        dashboard(payload)
      } else if case .failed = model.phase {
        ErrorState(model: model)
      } else {
        LoadingState()
      }
    }
    .task {
      if model.payloads[scope] == nil && (scope == .personal || model.selectedOrganizationID != nil) {
        await model.load(scope: scope)
      }
    }
  }

  private func dashboard(_ payload: RepositoryPayload) -> some View {
    let rows = model.visibleRows(for: scope)
    let summary = UsageAggregator.summary(rows)
    let modelStats = UsageAggregator.modelBreakdown(rows)
    let sources = UsageAggregator.sourceBreakdown(rows)
    return ScrollView {
      LazyVStack(alignment: .leading, spacing: 16) {
        HStack(alignment: .bottom) {
          ScreenHeader(
            eyebrow: scope == .team ? selectedOrganizationName(payload) : "Codex",
            title: scope == .team ? "team.title" : "personal.title",
            subtitle: scope == .team ? "team.subtitle" : "personal.subtitle",
            demo: model.isDemo
          )
          .accessibilityIdentifier(scope == .team ? "team.title" : "personal.title")
          Spacer(minLength: 8)
          RangeControl(model: model)
        }
        StatusBanner(state: model.connection, stale: model.staleScopes.contains(scope))
        KPIGrid(
          summary: summary,
          scope: scope,
          deviceCount: payload.devices.count,
          liveCount: payload.live.count,
          locale: locale
        )
        if rows.isEmpty {
          DashboardCard {
            Label("state.emptyUsage", systemImage: "chart.bar.xaxis")
              .foregroundStyle(Color.appSecondaryText)
              .frame(maxWidth: .infinity, minHeight: 100)
          }
        } else {
          if sources.count > 1 { DistributionCard(title: "charts.sources", items: sources, locale: locale) }
          UsageOverTimeCard(rows: rows, locale: locale)
          ContributionHeatmapCard(rows: rows, now: payload.now, locale: locale)
          ActiveHoursCard(rows: rows, locale: locale)
          WeekdayCard(rows: rows, locale: locale)
          DistributionCard(title: "charts.models", items: modelStats, locale: locale)
          if scope == .team {
            DistributionCard(
              title: "charts.memberContribution",
              items: UsageAggregator.memberBreakdown(rows, users: payload.users),
              locale: locale
            )
          }
        }
        RecentSessionsCard(sessions: Array(payload.sessions.prefix(12)), now: payload.now, locale: locale)
      }
      .padding(16)
      .frame(maxWidth: 900)
      .frame(maxWidth: .infinity)
    }
    .background(Color.appBackground)
    .accessibilityIdentifier(scope == .team ? "screen.team" : "screen.personal")
  }

  private func selectedOrganizationName(_ payload: RepositoryPayload) -> String {
    payload.organizations.first { $0.clerkOrgId == model.selectedOrganizationID }?.name ?? "Team"
  }
}

private struct RecentSessionsCard: View {
  let sessions: [SessionItem]
  let now: Double
  let locale: Locale

  var body: some View {
    DashboardCard(title: "sessions.title") {
      if sessions.isEmpty {
        Text("state.emptyUsage").foregroundStyle(Color.appSecondaryText)
      } else {
        ForEach(sessions) { session in
          VStack(alignment: .leading, spacing: 5) {
            HStack {
              Text(session.projectName ?? session.model).font(.subheadline.weight(.semibold))
              Spacer()
              Text(AppFormat.tokens(session.total, locale: locale)).font(.subheadline.monospacedDigit())
            }
            HStack {
              Text("\(session.agent) · \(session.model)")
              Spacer()
              Text(AppFormat.relative(session.lastActivityAt, now: now, locale: locale))
            }
            .font(.caption)
            .foregroundStyle(Color.appSecondaryText)
          }
          .accessibilityElement(children: .combine)
          if session.id != sessions.last?.id { Divider().overlay(Color.appBorder) }
        }
      }
    }
  }
}

struct OrganizationRequiredView: View {
  @ObservedObject var model: AppModel

  var body: some View {
    VStack(spacing: 18) {
      Image(systemName: "person.3.sequence.fill")
        .font(.system(size: 34))
        .foregroundStyle(Color.appAccent)
      Text("state.noOrganization").font(.headline).multilineTextAlignment(.center)
      let organizations = model.payloads[.personal]?.organizations ?? []
      if model.teamUnavailable {
        Text("state.teamUnavailable")
          .foregroundStyle(Color.appSecondaryText)
          .multilineTextAlignment(.center)
      }
      if organizations.isEmpty {
        Text("state.noOrganizations")
          .foregroundStyle(Color.appSecondaryText)
      } else {
        ForEach(organizations) { organization in
          Button(organization.name) { Task { await model.chooseOrganization(organization.clerkOrgId) } }
            .buttonStyle(.borderedProminent)
            .tint(Color.appAccent)
            .frame(minHeight: 44)
        }
      }
    }
    .padding(28)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.appBackground)
    .accessibilityIdentifier("screen.team")
  }
}

private struct ErrorState: View {
  @ObservedObject var model: AppModel

  var body: some View {
    ContentUnavailableView {
      Label("error.load", systemImage: "exclamationmark.triangle")
    } actions: {
      Button("common.retry") { Task { await model.retry() } }
        .buttonStyle(.borderedProminent)
    }
  }
}

private struct LoadingState: View {
  var body: some View {
    VStack(spacing: 14) {
      ProgressView()
      Text("state.loading").foregroundStyle(Color.appSecondaryText)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.appBackground)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.updatesFrequently)
  }
}
