package dev.chenli.codextracker

object AppConfig {
  val clerkPublishableKey: String
    get() = BuildConfig.CODEX_TRACKER_CLERK_PUBLISHABLE_KEY

  val convexUrl: String
    get() = BuildConfig.CODEX_TRACKER_CONVEX_URL

  val hasLiveConfiguration: Boolean
    get() =
      clerkPublishableKey.startsWith("pk_") &&
        !clerkPublishableKey.contains("replace", ignoreCase = true) &&
        convexUrl.startsWith("https://") &&
        !convexUrl.contains("replace", ignoreCase = true)
}
