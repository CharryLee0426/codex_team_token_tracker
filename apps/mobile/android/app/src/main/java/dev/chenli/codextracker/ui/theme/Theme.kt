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
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import dev.chenli.codextracker.ui.ThemeMode
import androidx.core.view.WindowCompat

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
    onSurfaceVariant = Color(0xFFA7B1C6),
    outline = Color(0xFF39445B),
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
    onSurfaceVariant = Color(0xFF4B5670),
    outline = Color(0xFFCBD2DF),
    error = Color(0xFFB42318),
  )

private val TrackerTypography =
  Typography(
    headlineSmall = TextStyle(fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.SemiBold),
    titleLarge = TextStyle(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    labelLarge = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium),
    labelSmall =
      TextStyle(
        fontFamily = FontFamily.Monospace,
        fontSize = 11.sp,
        lineHeight = 15.sp,
        letterSpacing = 1.2.sp,
      ),
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
  MaterialTheme(
    colorScheme = trackerColorScheme(dark),
    typography = TrackerTypography,
    content = content,
  )
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
