package dev.chenli.codextracker.ui

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.content.edit
import androidx.core.os.LocaleListCompat
import dev.chenli.codextracker.domain.CustomDayRange
import dev.chenli.codextracker.domain.UsageRange
import java.time.LocalDate
import java.util.Locale

enum class ThemeMode { System, Light, Dark }

/** The two app languages offered by both native viewers; English is the shared default. */
enum class LanguageMode(val languageTag: String, val key: String) {
  English("en", "en"),
  Chinese("zh-CN", "zh"),
}

data class ViewerPreferences(
  val theme: ThemeMode = ThemeMode.System,
  val language: LanguageMode = LanguageMode.English,
)

/** Persists the selected usage range the way the iOS viewer keeps it in user defaults. */
interface RangeStore {
  fun loadRange(): UsageRange

  fun saveRange(range: UsageRange)

  fun loadCustomRange(): CustomDayRange?

  fun saveCustomRange(range: CustomDayRange)
}

class InMemoryRangeStore(initial: UsageRange = UsageRange.ThirtyDays) : RangeStore {
  private var range = initial
  private var custom: CustomDayRange? = null

  override fun loadRange(): UsageRange = range

  override fun saveRange(range: UsageRange) {
    this.range = range
  }

  override fun loadCustomRange(): CustomDayRange? = custom

  override fun saveCustomRange(range: CustomDayRange) {
    custom = range
  }
}

class PreferenceStore(context: Context) : RangeStore {
  private val preferences = context.getSharedPreferences("viewer_preferences", Context.MODE_PRIVATE)

  fun load(): ViewerPreferences =
    ViewerPreferences(
      theme =
        runCatching {
            ThemeMode.valueOf(preferences.getString(ThemeKey, null) ?: ThemeMode.System.name)
          }
          .getOrDefault(ThemeMode.System),
      language = languageModeForApplicationLocale(AppCompatDelegate.getApplicationLocales()[0]),
    )

  fun saveTheme(theme: ThemeMode) {
    preferences.edit { putString(ThemeKey, theme.name) }
  }

  fun saveLanguage(language: LanguageMode) {
    AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(language.languageTag))
  }

  /** Applies the shared English default once, before any language has been chosen. */
  fun applyDefaultLanguage() {
    if (AppCompatDelegate.getApplicationLocales().isEmpty) {
      saveLanguage(LanguageMode.English)
    }
  }

  override fun loadRange(): UsageRange =
    UsageRange.fromKey(preferences.getString(RangeKey, null)) ?: UsageRange.ThirtyDays

  override fun saveRange(range: UsageRange) {
    preferences.edit { putString(RangeKey, range.key) }
  }

  override fun loadCustomRange(): CustomDayRange? =
    runCatching {
        val from = preferences.getString(CustomFromKey, null) ?: return null
        val to = preferences.getString(CustomToKey, null) ?: return null
        CustomDayRange(LocalDate.parse(from), LocalDate.parse(to))
      }
      .getOrNull()

  override fun saveCustomRange(range: CustomDayRange) {
    preferences.edit {
      putString(CustomFromKey, range.from.toString())
      putString(CustomToKey, range.to.toString())
    }
  }

  private companion object {
    const val ThemeKey = "theme"
    const val RangeKey = "range"
    const val CustomFromKey = "range.customFrom"
    const val CustomToKey = "range.customTo"
  }
}

internal fun languageModeForApplicationLocale(locale: Locale?): LanguageMode =
  if (locale?.language == "zh") LanguageMode.Chinese else LanguageMode.English
