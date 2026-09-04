import Foundation

struct AppConfiguration: Equatable, Sendable {
  let clerkPublishableKey: String
  let convexURL: String
  let isDemo: Bool

  init(
    info: [String: Any] = Bundle.main.infoDictionary ?? [:],
    arguments: [String] = ProcessInfo.processInfo.arguments
  ) {
    clerkPublishableKey = info["CLERK_PUBLISHABLE_KEY"] as? String ?? ""
    convexURL = info["CONVEX_URL"] as? String ?? ""
    let hasClerkKey = clerkPublishableKey.hasPrefix("pk_") && !clerkPublishableKey.localizedCaseInsensitiveContains("replace")
    let parsedURL = URL(string: convexURL)
    let hasConvexURL = parsedURL?.scheme == "https"
      && parsedURL?.host?.hasSuffix(".convex.cloud") == true
      && parsedURL?.host != "example.convex.cloud"
    isDemo = arguments.contains("--demo") || !hasClerkKey || !hasConvexURL
  }
}
