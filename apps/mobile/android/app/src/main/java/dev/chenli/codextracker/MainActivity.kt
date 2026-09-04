package dev.chenli.codextracker

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.chenli.codextracker.ui.PreferenceStore
import dev.chenli.codextracker.ui.ViewerApp
import dev.chenli.codextracker.ui.theme.CodexTrackerTheme

class MainActivity : AppCompatActivity() {
  var isDemoMode: Boolean = false
    private set

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()

    val application = application as CodexTrackerApplication
    val forcedDemo = BuildConfig.DEBUG && intent.getBooleanExtra(DemoModeExtra, false)
    val repository =
      if (forcedDemo || application.liveRepository == null) application.demoRepository
      else checkNotNull(application.liveRepository)
    isDemoMode = repository.isDemo

    setContent {
      val preferenceStore = remember { PreferenceStore(applicationContext) }
      var preferences by remember { mutableStateOf(preferenceStore.load()) }
      CodexTrackerTheme(preferences.theme) {
        ViewerApp(
          repository = repository,
          preferences = preferences,
          onThemeSelected = { theme ->
            preferenceStore.saveTheme(theme)
            preferences = preferences.copy(theme = theme)
          },
          onLanguageSelected = { language ->
            preferenceStore.saveLanguage(language)
            preferences = preferences.copy(language = language)
          },
        )
      }
    }
  }

  companion object {
    const val DemoModeExtra = "dev.chenli.codextracker.DEMO_MODE"
  }
}
