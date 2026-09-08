import Photos
import SwiftUI
import UIKit

/// An explicit export contract: aggregates only, never account IDs, emails, devices or sessions.
struct UsageShareSnapshot {
  let summary: UsageSummary
  let scope: UsageScope
  let from: Date
  let to: Date
  let capturedAt: Date
  let demo: Bool
  let stale: Bool
}

struct UsageShareSheet: View {
  @ObservedObject var model: AppModel
  let scope: UsageScope
  @Environment(\.locale) private var locale
  @Environment(\.dismiss) private var dismiss
  @State private var activityImage: ShareImage?
  @State private var message: String?
  @State private var saving = false

  private var snapshot: UsageShareSnapshot {
    let now = model.payloads[scope]?.now ?? Date().timeIntervalSince1970 * 1_000
    let bounds = RangeCalculator.bounds(for: model.range, now: now,
      customFrom: model.customFrom, customTo: model.customTo)
    return UsageShareSnapshot(summary: model.summary(for: scope), scope: scope,
      from: Date(timeIntervalSince1970: bounds.from / 1_000),
      to: Date(timeIntervalSince1970: (bounds.to - 1) / 1_000),
      capturedAt: Date(timeIntervalSince1970: now / 1_000), demo: model.isDemo,
      stale: model.connection != .live || model.staleScopes.contains(scope))
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 20) {
          UsageShareCard(snapshot: snapshot, locale: locale)
            .frame(maxWidth: 360)
            .accessibilityIdentifier("share.preview")
          Text("share.description").font(.footnote).foregroundStyle(.secondary)
          Button {
            guard let image = render() else { return }
            activityImage = ShareImage(image: image)
          } label: { Label("share.action", systemImage: "square.and.arrow.up") }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("share.system")
          Button {
            guard let image = render() else { return }
            saving = true
            Task { await save(image) }
          } label: { Label("share.save", systemImage: "photo.badge.arrow.down") }
            .buttonStyle(.bordered)
            .disabled(saving)
            .accessibilityIdentifier("share.save")
        }
        .padding(20)
      }
      .navigationTitle("share.title")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("share.done") { dismiss() } } }
      .sheet(item: $activityImage) { item in NativeImageShare(image: item.image) }
      .alert("share.title", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
        Button("share.done") { message = nil }
      } message: { Text(message ?? "") }
    }
  }

  @MainActor private func render() -> UIImage? {
    let renderer = ImageRenderer(content: UsageShareCard(snapshot: snapshot, locale: locale)
      .frame(width: 360).environment(\.locale, locale).environment(\.dynamicTypeSize, .medium))
    renderer.scale = 3
    guard let image = renderer.uiImage else {
      message = String(localized: "share.error", locale: locale)
      return nil
    }
    return image
  }

  @MainActor private func save(_ image: UIImage) async {
    defer { saving = false }
    let permission = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
    guard permission == .authorized || permission == .limited else {
      message = String(localized: "share.permission", locale: locale)
      return
    }
    do {
      guard let png = image.pngData() else {
        message = String(localized: "share.error", locale: locale)
        return
      }
      // Photos executes this callback on its own queue; do not inherit MainActor isolation.
      try await PHPhotoLibrary.shared().performChanges { @Sendable in
        PHAssetCreationRequest.forAsset().addResource(with: .photo, data: png, options: nil)
      }
      message = String(localized: "share.saved", locale: locale)
    } catch { message = String(localized: "share.error", locale: locale) }
  }
}

struct UsageShareCard: View {
  let snapshot: UsageShareSnapshot
  let locale: Locale
  private let ink = Color(red: 0.09, green: 0.14, blue: 0.22)

  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      HStack {
        Text("CODEX TRACKER").font(.system(size: 12, weight: .bold, design: .monospaced))
        Spacer()
        Image(systemName: "chart.bar.xaxis").font(.title2)
      }
      VStack(alignment: .leading, spacing: 8) {
        Text(snapshot.scope == .personal ? "personal.title" : "team.title")
          .font(.system(size: 24, weight: .bold))
        Text("\(date(snapshot.from)) – \(date(snapshot.to))")
          .font(.system(size: 12)).foregroundStyle(ink.opacity(0.7))
      }
      VStack(alignment: .leading, spacing: 3) {
        Text(AppFormat.tokens(snapshot.summary.usage.total, locale: locale))
          .font(.system(size: 58, weight: .bold, design: .rounded)).minimumScaleFactor(0.5).lineLimit(1)
        Text("kpi.totalTokens").font(.system(size: 14))
      }
      Rectangle().fill(ink.opacity(0.15)).frame(height: 1)
      HStack(alignment: .top) {
        metric("kpi.cost", AppFormat.currency(snapshot.summary.cost, locale: locale))
        Spacer()
        metric("kpi.requests", AppFormat.integer(snapshot.summary.usage.requests, locale: locale))
      }
      HStack(alignment: .top) {
        metric("kpi.cacheHit", AppFormat.percent(snapshot.summary.cacheHit, locale: locale))
        Spacer()
        VStack(alignment: .leading, spacing: 4) {
          Text("↓ \(AppFormat.tokens(snapshot.summary.usage.input, locale: locale))  ↑ \(AppFormat.tokens(snapshot.summary.usage.output, locale: locale))")
            .font(.system(size: 17, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.5)
          Text("share.inputOutput").font(.system(size: 11)).foregroundStyle(ink.opacity(0.7))
        }
      }
      VStack(alignment: .leading, spacing: 6) {
        if snapshot.demo { Text("share.demo").font(.system(size: 12, weight: .bold)) }
        if snapshot.stale { Text("share.stale").font(.system(size: 12, weight: .bold)) }
        Text(snapshot.capturedAt.formatted(.dateTime.year().month().day().hour().minute().timeZone().locale(locale)))
          .font(.system(size: 10))
        Text("codex.chenli.dev").font(.system(size: 12, weight: .semibold))
      }
      .foregroundStyle(ink.opacity(0.7))
    }
    .padding(28)
    .foregroundStyle(ink)
    .background(LinearGradient(colors: [Color(red: 0.83, green: 0.98, blue: 0.93),
      Color(red: 0.92, green: 0.94, blue: 1)], startPoint: .topLeading, endPoint: .bottomTrailing))
    .clipShape(RoundedRectangle(cornerRadius: 24))
    .environment(\.locale, locale)
  }

  private func date(_ value: Date) -> String {
    value.formatted(.dateTime.year().month(.abbreviated).day().locale(locale))
  }

  private func metric(_ key: LocalizedStringKey, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(value).font(.system(size: 20, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.5)
      Text(key).font(.system(size: 11)).foregroundStyle(ink.opacity(0.7))
    }
  }
}

private struct ShareImage: Identifiable {
  let id = UUID()
  let image: UIImage
}

private struct NativeImageShare: UIViewControllerRepresentable {
  let image: UIImage
  func makeUIViewController(context: Context) -> UIActivityViewController {
    UIActivityViewController(activityItems: [image], applicationActivities: nil)
  }
  func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
