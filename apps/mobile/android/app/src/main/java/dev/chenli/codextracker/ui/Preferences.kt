package dev.chenli.codextracker.ui

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.content.edit
import androidx.core.os.LocaleListCompat
import java.util.Locale

enum class ThemeMode { System, Light, Dark }

enum class LanguageMode(val languageTag: String?) {
  System(null),
  English("en"),
  Chinese("zh-CN"),
}

data class ViewerPreferences(
  val theme: ThemeMode = ThemeMode.System,
  val language: LanguageMode = LanguageMode.System,
)

class PreferenceStore(context: Context) {
  private val preferences = context.getSharedPreferences("viewer_preferences", Context.MODE_PRIVATE)

  fun load(): ViewerPreferences =
    ViewerPreferences(
      theme =
        runCatching {
            ThemeMode.valueOf(preferences.getString("theme", null) ?: ThemeMode.System.name)
          }
          .getOrDefault(ThemeMode.System),
      language = languageModeForApplicationLocale(AppCompatDelegate.getApplicationLocales()[0]),
    )

  fun saveTheme(theme: ThemeMode) {
    preferences.edit { putString("theme", theme.name) }
  }

  fun saveLanguage(language: LanguageMode) {
    AppCompatDelegate.setApplicationLocales(
      language.languageTag?.let(LocaleListCompat::forLanguageTags)
        ?: LocaleListCompat.getEmptyLocaleList()
    )
  }
}

internal fun languageModeForApplicationLocale(locale: Locale?): LanguageMode =
  when (locale?.language) {
    null, "" -> LanguageMode.System
    "en" -> LanguageMode.English
    "zh" -> LanguageMode.Chinese
    else -> LanguageMode.System
  }
