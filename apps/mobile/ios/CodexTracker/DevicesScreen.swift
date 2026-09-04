import SwiftUI

struct DevicesScreen: View {
  @ObservedObject var model: AppModel

  var body: some View {
    ZStack {
      Color.appBackground.ignoresSafeArea()
      content
    }
    .accessibilityIdentifier("screen.devices")
    .task {
      guard model.payloads[.personal] == nil else { return }
      await model.load(scope: .personal)
    }
  }

  @ViewBuilder
  private var content: some View {
    if let payload = model.payloads[.personal] {
      DevicesList(model: model, payload: payload)
    } else if case .failed = model.phase {
      DevicesErrorState(model: model)
    } else {
      DevicesLoadingState()
    }
  }
}

private struct DevicesList: View {
  @ObservedObject var model: AppModel
  let payload: RepositoryPayload

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 16) {
        ScreenHeader(
          eyebrow: "Codex",
          title: "devices.title",
          subtitle: "devices.subtitle",
          demo: model.isDemo
        )
        StatusBanner(state: model.connection, stale: model.staleScopes.contains(.personal))

        if payload.devices.isEmpty {
          DashboardCard {
            Label("state.emptyDevices", systemImage: "laptopcomputer.slash")
              .font(.subheadline)
              .foregroundStyle(Color.appSecondaryText)
              .frame(maxWidth: .infinity, minHeight: 112)
              .accessibilityAddTraits(.isStaticText)
          }
        } else {
          ForEach(payload.devices) { device in
            DeviceCard(device: device, now: payload.now)
          }
        }
      }
      .padding(16)
      .frame(maxWidth: 900)
      .frame(maxWidth: .infinity)
    }
    .refreshable { await model.load(scope: .personal) }
  }
}

private struct DeviceCard: View {
  let device: DeviceItem
  let now: Double
  @Environment(\.locale) private var locale

  var body: some View {
    DashboardCard {
      HStack(alignment: .top, spacing: 12) {
        Image(systemName: platformIcon)
          .font(.system(size: 18, weight: .medium))
          .foregroundStyle(Color.appAccent)
          .frame(width: 42, height: 42)
          .background(Color.appAccent.opacity(0.12), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
          .accessibilityHidden(true)

        VStack(alignment: .leading, spacing: 6) {
          Text(device.name)
            .font(.headline)
            .foregroundStyle(Color.appText)
            .lineLimit(2)
          HStack(spacing: 6) {
            DeviceBadge(text: device.platform)
            if let appVersion = device.appVersion {
              DeviceBadge(text: formatted("app.version", appVersion))
            }
            if device.logins > 1 {
              DeviceBadge(text: formatted("devices.logins", AppFormat.integer(device.logins, locale: locale)))
            }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }

      Divider().overlay(Color.appBorder)

      if let live = currentLive {
        VStack(alignment: .leading, spacing: 8) {
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Circle()
              .fill(.green)
              .frame(width: 7, height: 7)
              .accessibilityHidden(true)
            Text(liveDescription(live))
              .font(.subheadline.monospacedDigit())
              .foregroundStyle(Color.appText)
          }
          Text(formatted(
            "devices.today",
            AppFormat.tokens(live.todayTotal, locale: locale),
            AppFormat.currency(live.todayCost, locale: locale)
          ))
          .font(.caption.monospacedDigit())
          .foregroundStyle(Color.appSecondaryText)
        }
      } else {
        Label("devices.idle", systemImage: "pause.circle")
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
    if let hostname = device.hostname {
      Label(hostname, systemImage: "network")
    }
    if let timezone = device.timezone {
      Label(timezone, systemImage: "globe.americas")
    }
    Label(
      formatted("devices.lastSeen", AppFormat.relative(device.lastSeenAt, now: now, locale: locale)),
      systemImage: "clock"
    )
    Label(
      formatted("devices.added", AppFormat.date(device.createdAt, locale: locale)),
      systemImage: "calendar.badge.plus"
    )
  }

  private var currentLive: LiveSnapshot? {
    guard let live = device.live, LiveFreshness.isFresh(updatedAt: live.updatedAt, now: now) else { return nil }
    return live
  }

  private var platformIcon: String {
    let platform = device.platform.lowercased()
    if platform.hasPrefix("darwin") || platform.contains("mac") { return "laptopcomputer" }
    if platform.hasPrefix("win") { return "desktopcomputer" }
    return "terminal"
  }

  private var accessibilitySummary: String {
    let status = currentLive.map(liveDescription) ?? String(localized: "devices.idle", locale: locale)
    var values = [device.name, device.platform, status]
    if let appVersion = device.appVersion { values.append(formatted("app.version", appVersion)) }
    if let hostname = device.hostname { values.append(hostname) }
    if let timezone = device.timezone { values.append(timezone) }
    values.append(formatted("devices.logins", AppFormat.integer(device.logins, locale: locale)))
    values.append(formatted("devices.lastSeen", AppFormat.relative(device.lastSeenAt, now: now, locale: locale)))
    values.append(formatted("devices.added", AppFormat.date(device.createdAt, locale: locale)))
    if let live = currentLive {
      values.append(formatted(
        "devices.today",
        AppFormat.tokens(live.todayTotal, locale: locale),
        AppFormat.currency(live.todayCost, locale: locale)
      ))
    }
    return values.joined(separator: ", ")
  }

  private func liveDescription(_ live: LiveSnapshot) -> String {
    guard live.sessionId != nil else { return String(localized: "devices.idle", locale: locale) }
    return formatted(
      "devices.live",
      live.model ?? String(localized: "common.unknown", locale: locale),
      live.tokensPerSecond.formatted(.number.precision(.fractionLength(1)).locale(locale))
    )
  }

  private func formatted(_ key: String, _ arguments: CVarArg...) -> String {
    let template: String
    switch key {
    case "app.version": template = String(localized: "app.version", locale: locale)
    case "devices.live": template = String(localized: "devices.live", locale: locale)
    case "devices.logins": template = String(localized: "devices.logins", locale: locale)
    case "devices.today": template = String(localized: "devices.today", locale: locale)
    case "devices.lastSeen": template = String(localized: "devices.lastSeen", locale: locale)
    case "devices.added": template = String(localized: "devices.added", locale: locale)
    default: return key
    }
    return String(format: template, locale: locale, arguments: arguments)
  }
}

private struct DeviceBadge: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.caption2.weight(.medium))
      .foregroundStyle(Color.appSecondaryText)
      .lineLimit(1)
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(Color.appCardSecondary, in: Capsule())
  }
}

private struct DevicesErrorState: View {
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

private struct DevicesLoadingState: View {
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
