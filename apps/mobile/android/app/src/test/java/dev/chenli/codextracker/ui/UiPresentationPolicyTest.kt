package dev.chenli.codextracker.ui

import java.time.LocalDate
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UiPresentationPolicyTest {
  @Test
  fun `application locale is the language picker authority with an English default`() {
    assertEquals(LanguageMode.English, languageModeForApplicationLocale(null))
    assertEquals(LanguageMode.English, languageModeForApplicationLocale(Locale.forLanguageTag("en-US")))
    assertEquals(LanguageMode.Chinese, languageModeForApplicationLocale(Locale.forLanguageTag("zh-Hans-CN")))
    assertEquals(LanguageMode.English, languageModeForApplicationLocale(Locale.forLanguageTag("fr-FR")))
  }

  @Test
  fun `known Clerk roles are localized and unknown roles remain available as fallback`() {
    assertEquals(KnownOrganizationRole.Admin, knownOrganizationRole("org:admin"))
    assertEquals(KnownOrganizationRole.Member, knownOrganizationRole("MEMBER"))
    assertNull(knownOrganizationRole("org:auditor"))
  }

  @Test
  fun `dates use the supplied app locale rather than a process default`() {
    val date = LocalDate.of(2026, 9, 1)
    val english = AppFormat.date(date, Locale.US)
    val chinese = AppFormat.date(date, Locale.SIMPLIFIED_CHINESE)

    assertTrue(english.contains("Sep"))
    assertTrue(chinese.contains("2026"))
    assertNotEquals(english, chinese)
  }

  @Test
  fun `platform icons follow the iOS mapping`() {
    assertEquals(TrackerIcons.laptop, platformIcon("darwin"))
    assertEquals(TrackerIcons.laptop, platformIcon("macOS 15"))
    assertEquals(TrackerIcons.desktop, platformIcon("win32"))
    assertEquals(TrackerIcons.terminal, platformIcon("linux"))
  }
}
