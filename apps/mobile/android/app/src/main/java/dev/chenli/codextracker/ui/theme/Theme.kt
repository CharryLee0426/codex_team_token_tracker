package dev.chenli.codextracker.ui.theme

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import android.view.Window
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import dev.chenli.codextracker.ui.ThemeMode

/**
 * The exact colour tokens of the iOS viewer's `DesignSystem.swift`, so both native apps share one
 * palette on top of the dashboard's dark-first space theme.
 */
@Immutable
data class TrackerColors(
  val background: Color,
  val card: Color,
  val cardSecondary: Color,
  val text: Color,
  val secondaryText: Color,
  val muted: Color,
  val accent: Color,
  val border: Color,
  val live: Color,
  val warning: Color,
  val destructive: Color,
  val isDark: Boolean,
)

val LightTrackerColors =
  TrackerColors(
    background = Color(0xFFF3F5FA),
    card = Color.White,
    cardSecondary = Color(0xFFEEF2F8),
    text = Color(0xFF0B1220),
    secondaryText = Color(0xFF4B5670),
    muted = Color(0xFF6F7A93),
    accent = Color(0xFF0369A1),
    border = Color(0xFFD9DEE8),
    live = Color(0xFF34C759),
    warning = Color(0xFFFF9500),
    destructive = Color(0xFFFF3B30),
    isDark = false,
  )

val DarkTrackerColors =
  TrackerColors(
    background = Color(0xFF05070D),
    card = Color(0xFF0C1220),
    cardSecondary = Color(0xFF121A2B),
    text = Color(0xFFE8EDF7),
    secondaryText = Color(0xFFA7B1C6),
    muted = Color(0xFF6F7A93),
    accent = Color(0xFF5CC8FF),
    border = Color(0xFF283146),
    live = Color(0xFF30D158),
    warning = Color(0xFFFF9F0A),
    destructive = Color(0xFFFF453A),
    isDark = true,
  )

val LocalTrackerColors = staticCompositionLocalOf { LightTrackerColors }

object TrackerTheme {
  val colors: TrackerColors
    @Composable @ReadOnlyComposable get() = LocalTrackerColors.current
}

private fun appleStyle(size: TextUnit, lineHeight: TextUnit, weight: FontWeight = FontWeight.Normal) =
  TextStyle(
    fontSize = size,
    lineHeight = lineHeight,
    fontWeight = weight,
    platformStyle = PlatformTextStyle(includeFontPadding = false),
    lineHeightStyle =
      LineHeightStyle(alignment = LineHeightStyle.Alignment.Center, trim = LineHeightStyle.Trim.None),
  )

/** The iOS text styles at their default Dynamic Type size, used verbatim by every screen. */
object TrackerType {
  val largeTitle = appleStyle(34.sp, 41.sp, FontWeight.Bold)
  val title = appleStyle(28.sp, 34.sp, FontWeight.Bold)
  val title2 = appleStyle(22.sp, 28.sp, FontWeight.Bold)
  val headline = appleStyle(17.sp, 22.sp, FontWeight.SemiBold)
  val body = appleStyle(17.sp, 22.sp)
  val subheadline = appleStyle(15.sp, 20.sp)
  val footnote = appleStyle(13.sp, 18.sp)
  val caption = appleStyle(12.sp, 16.sp)
  val caption2 = appleStyle(11.sp, 13.sp)
}

fun TextStyle.monospaced(): TextStyle = copy(fontFamily = FontFamily.Monospace)

/** Tabular figures, the Android equivalent of SwiftUI's `monospacedDigit()`. */
fun TextStyle.monospacedDigit(): TextStyle = copy(fontFeatureSettings = "tnum")

fun TextStyle.weight(weight: FontWeight): TextStyle = copy(fontWeight = weight)

private val DarkColors =
  darkColorScheme(
    primary = Color(0xFF5CC8FF),
    onPrimary = Color(0xFF041019),
    secondary = Color(0xFF83D7FF),
    onSecondary = Color(0xFF06141C),
    secondaryContainer = Color(0xFF12334A),
    onSecondaryContainer = Color(0xFFCEF0FF),
    background = Color(0xFF05070D),
    onBackground = Color(0xFFE8EDF7),
    surface = Color(0xFF0C1220),
    onSurface = Color(0xFFE8EDF7),
    surfaceVariant = Color(0xFF121A2B),
    surfaceContainer = Color(0xFF121A2B),
    surfaceContainerHigh = Color(0xFF182238),
    surfaceContainerLow = Color(0xFF0C1220),
    surfaceContainerLowest = Color(0xFF05070D),
    surfaceContainerHighest = Color(0xFF1C2740),
    onSurfaceVariant = Color(0xFFA7B1C6),
    outline = Color(0xFF283146),
    outlineVariant = Color(0xFF283146),
    error = Color(0xFFFF8A8A),
  )

private val LightColors =
  lightColorScheme(
    primary = Color(0xFF0369A1),
    onPrimary = Color.White,
    secondary = Color(0xFF075985),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFDDF3FF),
    onSecondaryContainer = Color(0xFF082F49),
    background = Color(0xFFF3F5FA),
    onBackground = Color(0xFF0B1220),
    surface = Color.White,
    onSurface = Color(0xFF0B1220),
    surfaceVariant = Color(0xFFEEF2F8),
    surfaceContainer = Color(0xFFE9EEF6),
    surfaceContainerHigh = Color(0xFFDDE5F0),
    surfaceContainerLow = Color.White,
    surfaceContainerLowest = Color.White,
    surfaceContainerHighest = Color(0xFFD3DCE9),
    onSurfaceVariant = Color(0xFF4B5670),
    outline = Color(0xFFD9DEE8),
    outlineVariant = Color(0xFFD9DEE8),
    error = Color(0xFFB42318),
  )

private val TrackerTypography =
  Typography(
    headlineLarge = TrackerType.largeTitle,
    headlineMedium = TrackerType.title,
    headlineSmall = TrackerType.title2,
    titleLarge = TrackerType.title2,
    titleMedium = TrackerType.headline,
    titleSmall = TrackerType.subheadline.weight(FontWeight.SemiBold),
    bodyLarge = TrackerType.body,
    bodyMedium = TrackerType.subheadline,
    bodySmall = TrackerType.footnote,
    labelLarge = TrackerType.subheadline.weight(FontWeight.SemiBold),
    labelMedium = TrackerType.caption.weight(FontWeight.Medium),
    labelSmall = TrackerType.caption2.monospaced(),
  )

@Composable
fun CodexTrackerTheme(themeMode: ThemeMode, content: @Composable () -> Unit) {
  val dark =
    when (themeMode) {
      ThemeMode.System -> isSystemInDarkTheme()
      ThemeMode.Light -> false
      ThemeMode.Dark -> true
    }
  val view = LocalView.current
  val barAppearance = systemBarIconAppearance(dark)
  if (!view.isInEditMode) {
    SideEffect {
      view.context.findActivity()?.window?.let { window ->
        applyLegacyNavigationBarColor(window, barAppearance.navigationBarColor)
        WindowCompat.getInsetsController(window, window.decorView).apply {
          isAppearanceLightStatusBars = barAppearance.darkStatusBarIcons
          isAppearanceLightNavigationBars = barAppearance.darkNavigationBarIcons
        }
      }
    }
  }
  CompositionLocalProvider(
    LocalTrackerColors provides if (dark) DarkTrackerColors else LightTrackerColors
  ) {
    MaterialTheme(
      colorScheme = trackerColorScheme(dark),
      typography = TrackerTypography,
      content = content,
    )
  }
}

internal data class SystemBarIconAppearance(
  val darkStatusBarIcons: Boolean,
  val darkNavigationBarIcons: Boolean,
  val navigationBarColor: Int,
)

internal fun systemBarIconAppearance(isDarkTheme: Boolean): SystemBarIconAppearance =
  SystemBarIconAppearance(
    darkStatusBarIcons = !isDarkTheme,
    darkNavigationBarIcons = !isDarkTheme,
    navigationBarColor = trackerColorScheme(isDarkTheme).background.toArgb(),
  )

internal fun trackerColorScheme(isDarkTheme: Boolean): ColorScheme =
  if (isDarkTheme) DarkColors else LightColors

private tailrec fun Context.findActivity(): Activity? =
  when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
  }

@Suppress("DEPRECATION")
private fun applyLegacyNavigationBarColor(window: Window, color: Int) {
  if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) window.navigationBarColor = color
}
