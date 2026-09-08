package dev.chenli.codextracker

import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.core.os.LocaleListCompat
import androidx.core.view.WindowCompat
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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
  fun usageCardPreviewOpensAndSavesAnImage() {
    compose.waitUntilExactlyOneExists(hasTestTag("share_open"))
    compose.onNodeWithTag("share_open").performClick()
    compose.onNodeWithTag("share_preview").assertIsDisplayed()
    compose.onNodeWithTag("share_save").performClick()
    compose.waitUntil(timeoutMillis = 10_000) {
      compose.onAllNodesWithText("Image saved.").fetchSemanticsNodes().isNotEmpty()
    }
    compose.onNodeWithText("Image saved.").assertIsDisplayed()
  }

  @Test
  fun demoOverviewTraversesAllReadOnlyTabs() {
    compose.waitUntilExactlyOneExists(hasTestTag("demo_badge"))
    compose.onNodeWithTag("personal_screen").assertIsDisplayed()
    compose.onNodeWithTag("kpi_total", useUnmergedTree = true).assertTextEquals("620K")
    compose.onNodeWithTag("kpi_live", useUnmergedTree = true).assertTextEquals("1")

    compose.onNodeWithTag("overview_list").performScrollToNode(hasTestTag("usage_chart"))
    val chartDescription =
      compose
        .onNodeWithTag("usage_chart")
        .fetchSemanticsNode()
        .config[SemanticsProperties.ContentDescription]
        .joinToString(" ")
    assertTrue(chartDescription.contains(","))
    assertTrue(chartDescription.length > compose.activity.getString(R.string.charts_usage).length)
    compose.onNodeWithTag("overview_list").performScrollToNode(hasTestTag("chart_data_toggle"))
    compose.onAllNodesWithTag("chart_data_toggle").onFirst().performClick()
    compose.onAllNodesWithTag("chart_data_list").onFirst().assertIsDisplayed()
    assertTrue(compose.onAllNodesWithTag("chart_data_point").fetchSemanticsNodes().size >= 2)

    compose.onNodeWithTag("tab_team").performClick()
    compose.onNodeWithTag("team_screen").assertIsDisplayed()
    waitForKpi("1.2M")
    compose.onNodeWithTag("kpi_total", useUnmergedTree = true).assertTextEquals("1.2M")
    compose.onNodeWithTag("kpi_members", useUnmergedTree = true).assertTextEquals("2")
    compose.onNodeWithTag("kpi_live", useUnmergedTree = true).assertTextEquals("2")

    compose.onNodeWithTag("tab_members").performClick()
    compose.onNodeWithTag("members_screen").assertIsDisplayed()
    compose.onAllNodesWithText("Admin", useUnmergedTree = true).onFirst().assertIsDisplayed()
    compose
      .onAllNodesWithText("Live · gpt-5.6-sol · 42.6 tok/s", useUnmergedTree = true)
      .onFirst()
      .assertIsDisplayed()
    assertTrue(
      compose.onAllNodesWithText("1 device", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
    )

    compose.onNodeWithTag("tab_devices").performClick()
    compose.onNodeWithTag("devices_screen").assertIsDisplayed()
    compose.onAllNodesWithText("2 logins", useUnmergedTree = true).onFirst().assertIsDisplayed()
    compose.onAllNodesWithText("Idle", useUnmergedTree = true).onFirst().assertIsDisplayed()

    compose.onNodeWithTag("tab_settings").performClick()
    compose.onNodeWithTag("settings_screen").assertIsDisplayed()
    compose.onNodeWithTag("settings_organization_org_demo_orbital").assertIsSelected()

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
    compose.onNodeWithTag("sign_out").assertDoesNotExist()
    assertTrue(compose.activity.isDemoMode)
    assertTrue(compose.activity.applicationInfo.icon != 0)
  }

  @Test
  fun appLanguageSelectionLocalizesKnownOrganizationRoles() {
    compose.waitUntilExactlyOneExists(hasTestTag("personal_screen"))
    compose.onNodeWithTag("tab_settings").performClick()
    compose.onNodeWithTag("language_zh").performClick()
    compose.waitUntilExactlyOneExists(hasTestTag("settings_screen"))
    compose.onNodeWithTag("language_zh").assertIsSelected()
    compose.onNodeWithText("外观").assertIsDisplayed()
    compose.onNodeWithTag("tab_members").performClick()
    compose.onAllNodesWithText("管理员", useUnmergedTree = true).onFirst().assertIsDisplayed()
    assertTrue(compose.onAllNodesWithText("成员", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
  }

  @Test
  fun rangeMenuUpdatesOverviewTotals() {
    compose.waitUntilExactlyOneExists(hasTestTag("personal_screen"))
    compose.onNodeWithTag("range_selector").performClick()
    compose.onNodeWithTag("range_today").performClick()
    waitForKpi("0")
    compose.onNodeWithTag("kpi_total", useUnmergedTree = true).assertTextEquals("0")
    compose.onNodeWithTag("range_selector").performClick()
    compose.onNodeWithTag("range_30d").performClick()
    waitForKpi("620K")
    compose.onNodeWithTag("kpi_total", useUnmergedTree = true).assertTextEquals("620K")
  }

  @Test
  fun customRangeSheetAppliesTheLastThirtyDaysByDefault() {
    compose.waitUntilExactlyOneExists(hasTestTag("personal_screen"))
    compose.onNodeWithTag("range_selector").performClick()
    compose.onNodeWithTag("range_custom").performClick()
    compose.waitUntilExactlyOneExists(hasTestTag("custom_range_sheet"))
    compose.onNodeWithTag("range_from").assertIsDisplayed()
    compose.onNodeWithTag("range_apply").performClick()
    compose.waitUntilDoesNotExist(hasTestTag("custom_range_sheet"))
    compose.onNodeWithText("Custom").assertIsDisplayed()
    waitForKpi("620K")
  }

  @Test
  fun demoConnectionToggleShowsOfflineAndRecovers() {
    compose.waitUntilExactlyOneExists(hasTestTag("personal_screen"))
    compose.onNodeWithTag("tab_settings").performClick()
    compose.onNodeWithTag("connection_live").assertIsDisplayed()
    compose.onNodeWithTag("demo_connection_toggle").performClick()
    compose.waitUntilExactlyOneExists(hasTestTag("connection_offline"))
    compose.onNodeWithTag("demo_connection_toggle").performClick()
    compose.waitUntilExactlyOneExists(hasTestTag("connection_live"), timeoutMillis = 5_000)
  }

  private fun waitForKpi(expected: String) {
    compose.waitUntil {
      runCatching {
          compose
            .onNodeWithTag("kpi_total", useUnmergedTree = true)
            .fetchSemanticsNode()
            .config[SemanticsProperties.Text]
            .any { it.text == expected }
        }
        .getOrDefault(false)
    }
  }
}
