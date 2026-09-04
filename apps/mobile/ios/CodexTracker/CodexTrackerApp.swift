import ClerkKit
import SwiftUI

@main
struct CodexTrackerApp: App {
  @StateObject private var model: AppModel
  @AppStorage("mobile.appearance") private var appearanceRaw = AppAppearance.system.rawValue
  @AppStorage("mobile.language") private var languageRaw = AppLanguage.english.rawValue

  @MainActor
  init() {
    AppModel.resetPreferencesIfRequested()
    let configuration = AppConfiguration()
    let repository: any MobileRepository
    if configuration.isDemo {
      do {
        repository = try DemoRepository()
      } catch {
        preconditionFailure("The deterministic demo fixture is missing from the app bundle.")
      }
    } else {
      Clerk.configure(publishableKey: configuration.clerkPublishableKey)
      repository = LiveMobileRepository(deploymentURL: configuration.convexURL)
    }
    _model = StateObject(wrappedValue: AppModel(repository: repository))
  }

  var body: some Scene {
    WindowGroup {
      RootContent(
        model: model,
        appearance: appearanceBinding,
        language: languageBinding
      )
      .environment(\.locale, languageBinding.wrappedValue.locale)
      .preferredColorScheme(appearanceBinding.wrappedValue.colorScheme)
      .task {
        if model.phase == .initializing { await model.start() }
      }
    }
  }

  private var appearanceBinding: Binding<AppAppearance> {
    Binding(
      get: { AppAppearance(rawValue: appearanceRaw) ?? .system },
      set: { appearanceRaw = $0.rawValue }
    )
  }

  private var languageBinding: Binding<AppLanguage> {
    Binding(
      get: { AppLanguage(rawValue: languageRaw) ?? .english },
      set: { languageRaw = $0.rawValue }
    )
  }
}

private struct RootContent: View {
  @ObservedObject var model: AppModel
  @Binding var appearance: AppAppearance
  @Binding var language: AppLanguage

  var body: some View {
    if model.payloads[.personal] != nil {
      MainShell(model: model, appearance: $appearance, language: $language)
    } else {
      switch model.phase {
      case .signedOut:
        SignInScreen(model: model)
      case .failed:
        ContentUnavailableView {
          Label("error.load", systemImage: "exclamationmark.triangle")
        } actions: {
          Button("common.retry") { Task { await model.start() } }
            .buttonStyle(.borderedProminent)
        }
      default:
        VStack(spacing: 14) {
          ProgressView()
          Text(
            model.phase == .bootstrapping
              ? "state.syncing"
              : (model.phase == .signingOut ? "state.signingOut" : "state.initializing")
          )
            .foregroundStyle(Color.appSecondaryText)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.appBackground)
      }
    }
  }
}

private struct SignInScreen: View {
  @ObservedObject var model: AppModel

  var body: some View {
    VStack(spacing: 18) {
      Image(systemName: "chart.bar.doc.horizontal.fill")
        .font(.system(size: 44))
        .foregroundStyle(Color.appAccent)
      Text("state.signedOut")
        .font(.title2.bold())
        .multilineTextAlignment(.center)
      Text("state.signInBody")
        .font(.subheadline)
        .foregroundStyle(Color.appSecondaryText)
        .multilineTextAlignment(.center)
      Button("state.signIn") { Task { await model.signIn() } }
        .buttonStyle(.borderedProminent)
        .tint(Color.appAccent)
        .frame(minHeight: 44)
    }
    .padding(32)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.appBackground)
  }
}
