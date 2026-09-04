package dev.chenli.codextracker

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.core.os.LocaleListCompat
import androidx.core.view.WindowCompat
import androidx.appcompat.app.AppCompatDelegate
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalTestApi::class)
class ViewerSmokeTest {
  @get:Rule val compose = createAndroidComposeRule<MainActivity>()

  @Before
  fun useEnglish() {
    compose.activityRule.scenario.onActivity {
      AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags("en"))
    }
    compose.waitForIdle()
  }

  @After
  fun restoreSystemLanguage() {
    compose.activityRule.scenario.onActivity {
      AppCompatDelegate.setApplicationLocales(LocaleListCompat.getEmptyLocaleList())
    }
  }

  @Test
  fun demoOverviewTraversesAllReadOnlyTabs() {
    compose.waitUntilExactlyOneExists(hasTestTag("demo_banner"))
    compose.onNodeWithTag("personal_screen").assertIsDisplayed()
    compose.onNodeWithTag("kpi_total").assertTextEquals("620K")
    val chartDescription =
      compose
        .onNodeWithTag("daily_chart")
        .fetchSemanticsNode()
        .config[SemanticsProperties.ContentDescription]
        .joinToString(" ")
    assertTrue(chartDescription.contains(":"))
    assertTrue(chartDescription.length > compose.activity.getString(R.string.daily_usage_description).length)
    compose.onNodeWithTag("daily_data_toggle").performClick()
    compose.onNodeWithTag("daily_data_list").assertIsDisplayed()
    assertTrue(compose.onAllNodesWithTag("daily_data_point").fetchSemanticsNodes().size >= 2)

    compose.onNodeWithTag("tab_team").performClick()
    compose.onNodeWithTag("team_screen").assertIsDisplayed()
    waitForKpi("1.17M")
    compose.onNodeWithTag("kpi_total").assertTextEquals("1.17M")

    compose.onNodeWithTag("tab_members").performClick()
    compose.onNodeWithTag("members_screen").assertIsDisplayed()
    assertTrue(compose.onAllNodesWithText("1 device").fetchSemanticsNodes().isNotEmpty())

    compose.onNodeWithTag("tab_devices").performClick()
    compose.onNodeWithTag("devices_screen").assertIsDisplayed()
    compose.onNodeWithText("2 active logins").assertIsDisplayed()

    compose.onNodeWithTag("tab_settings").performClick()
    compose.onNodeWithTag("settings_screen").assertIsDisplayed()

    compose.onNodeWithTag("theme_light").performClick().assertIsSelected()
    compose.waitForIdle()
    compose.activityRule.scenario.onActivity {
      val controller = WindowCompat.getInsetsController(it.window, it.window.decorView)
      assertTrue(controller.isAppearanceLightStatusBars)
      assertTrue(controller.isAppearanceLightNavigationBars)
    }
    compose.onNodeWithTag("theme_dark").performClick().assertIsSelected()
    compose.waitForIdle()
    compose.activityRule.scenario.onActivity {
      val controller = WindowCompat.getInsetsController(it.window, it.window.decorView)
      assertFalse(controller.isAppearanceLightStatusBars)
      assertFalse(controller.isAppearanceLightNavigationBars)
    }
    compose.onNodeWithTag("device_revoke_action").assertDoesNotExist()
    compose.onNodeWithTag("tracker_setup").assertDoesNotExist()
    assertTrue(compose.activity.isDemoMode)
    assertTrue(compose.activity.applicationInfo.icon != 0)
  }

  @Test
  fun appLanguageSelectionLocalizesKnownOrganizationRoles() {
    compose.waitUntilExactlyOneExists(hasTestTag("personal_screen"))
    compose.onNodeWithTag("tab_settings").performClick()
    compose.onNodeWithTag("language_chinese").performClick()
    compose.waitUntilExactlyOneExists(hasTestTag("settings_screen"))
    compose.onNodeWithTag("language_chinese").assertIsSelected()
    compose.onNodeWithTag("tab_members").performClick()
    compose.onNodeWithText("管理员").assertIsDisplayed()
    assertTrue(compose.onAllNodesWithText("成员").fetchSemanticsNodes().isNotEmpty())
  }

  @Test
  fun rangeControlUpdatesOverviewTotals() {
    compose.waitUntilExactlyOneExists(hasTestTag("personal_screen"))
    compose.onNodeWithTag("range_today").performClick()
    waitForKpi("0")
    compose.onNodeWithTag("kpi_total").assertTextEquals("0")
    compose.onNodeWithTag("range_30d").performClick()
    waitForKpi("620K")
    compose.onNodeWithTag("kpi_total").assertTextEquals("620K")
  }

  private fun waitForKpi(expected: String) {
    compose.waitUntil {
      runCatching {
          compose
            .onNodeWithTag("kpi_total")
            .fetchSemanticsNode()
            .config[SemanticsProperties.Text]
            .any { it.text == expected }
        }
        .getOrDefault(false)
    }
  }
}
