package dev.chenli.codextracker.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ThemePolicyTest {
  @Test
  fun `system bar icons contrast with the resolved app theme`() {
    val light = systemBarIconAppearance(isDarkTheme = false)
    val dark = systemBarIconAppearance(isDarkTheme = true)

    assertTrue(light.darkStatusBarIcons)
    assertTrue(light.darkNavigationBarIcons)
    assertEquals(Color(0xFFF3F5FA).toArgb(), light.navigationBarColor)
    assertFalse(dark.darkStatusBarIcons)
    assertFalse(dark.darkNavigationBarIcons)
    assertEquals(Color(0xFF05070D).toArgb(), dark.navigationBarColor)
  }

  @Test
  fun `component color roles stay in the tracker blue palette`() {
    val light = trackerColorScheme(isDarkTheme = false)
    val dark = trackerColorScheme(isDarkTheme = true)

    assertEquals(Color(0xFF075985), light.secondary)
    assertEquals(Color(0xFFDDF3FF), light.secondaryContainer)
    assertEquals(Color(0xFFE9EEF6), light.surfaceContainer)
    assertEquals(Color(0xFF83D7FF), dark.secondary)
    assertEquals(Color(0xFF12334A), dark.secondaryContainer)
    assertEquals(Color(0xFF121A2B), dark.surfaceContainer)
  }
}
