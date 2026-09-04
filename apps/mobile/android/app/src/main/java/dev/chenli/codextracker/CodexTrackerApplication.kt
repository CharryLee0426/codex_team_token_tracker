package dev.chenli.codextracker

import android.app.Application
import com.clerk.api.Clerk
import com.clerk.api.ClerkConfigurationOptions
import com.clerk.convex.createClerkConvexClient
import dev.chenli.codextracker.data.DemoViewerRepository
import dev.chenli.codextracker.data.LiveViewerRepository
import dev.chenli.codextracker.data.ViewerRepository
import dev.chenli.codextracker.domain.DemoFixtureLoader

class CodexTrackerApplication : Application() {
  val demoRepository: ViewerRepository by lazy {
    check(BuildConfig.DEBUG) { "Demo data is unavailable in release builds." }
    val fixture = assets.open("dashboard-demo.json").bufferedReader().use { reader ->
      DemoFixtureLoader.decode(reader.readText())
    }
    DemoViewerRepository(fixture)
  }
  var liveRepository: ViewerRepository? = null
    private set

  override fun onCreate() {
    super.onCreate()
    if (AppConfig.hasLiveConfiguration) {
      Clerk.initialize(
        context = this,
        publishableKey = AppConfig.clerkPublishableKey,
        options = ClerkConfigurationOptions(enableDebugMode = false),
      )
      val client = createClerkConvexClient(AppConfig.convexUrl, applicationContext)
      liveRepository = LiveViewerRepository(client)
    }
  }
}
