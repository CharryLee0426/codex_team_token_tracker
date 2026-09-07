package dev.chenli.codextracker.ui

import dev.chenli.codextracker.domain.RelativeTime
import dev.chenli.codextracker.domain.RelativeUnit
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppFormatTest {
  @Test
  fun `token counts use the compact notation shared with the iOS viewer`() {
    assertEquals("620K", AppFormat.tokens(620_000L, Locale.US))
    assertEquals("1.2M", AppFormat.tokens(1_170_000L, Locale.US))
    assertEquals("41.3K", AppFormat.tokens(41_333.33, Locale.US))
    assertEquals("999", AppFormat.tokens(999L, Locale.US))
    assertEquals("1K", AppFormat.tokens(1_000L, Locale.US))
    assertEquals("1M", AppFormat.tokens(999_950L, Locale.US))
    assertEquals("0", AppFormat.tokens(0L, Locale.US))
    assertEquals("2.4B", AppFormat.tokens(2_450_000_000L, Locale.US)) // half-even, like Foundation
  }

  @Test
  fun `Simplified Chinese counts use the 万 and 亿 scales`() {
    assertEquals("62万", AppFormat.tokens(620_000L, Locale.SIMPLIFIED_CHINESE))
    assertEquals("49.5万", AppFormat.tokens(495_000L, Locale.SIMPLIFIED_CHINESE))
    assertEquals("10.3万", AppFormat.tokens(103_000L, Locale.SIMPLIFIED_CHINESE))
    assertEquals("117万", AppFormat.tokens(1_170_000L, Locale.SIMPLIFIED_CHINESE))
    assertEquals("1亿", AppFormat.tokens(100_000_000L, Locale.SIMPLIFIED_CHINESE))
    assertEquals("1234", AppFormat.tokens(1_234L, Locale.SIMPLIFIED_CHINESE))
  }

  @Test
  fun `integers percents and currency follow the app locale`() {
    assertEquals("1,234", AppFormat.integer(1_234L, Locale.US))
    assertEquals("63%", AppFormat.percent(0.6262, Locale.US))
    assertEquals("$7.17", AppFormat.currency(7.17, Locale.US))
    assertTrue(AppFormat.currency(7.17, Locale.SIMPLIFIED_CHINESE).endsWith("7.17"))
    assertEquals("42.6", AppFormat.decimal(42.63, Locale.US))
  }

  @Test
  fun `relative time picks the largest whole unit like the iOS formatter`() {
    val now = 1_788_544_800_000L
    fun parts(secondsAgo: Long) = RelativeTime.parts(now - secondsAgo * 1_000L, now)

    assertEquals(RelativeUnit.Seconds, parts(45).unit)
    assertEquals(5L to RelativeUnit.Minutes, parts(300).let { it.quantity to it.unit })
    assertEquals(2L to RelativeUnit.Hours, parts(7_200).let { it.quantity to it.unit })
    assertEquals(3L to RelativeUnit.Days, parts(3 * 86_400).let { it.quantity to it.unit })
    assertEquals(2L to RelativeUnit.Weeks, parts(15 * 86_400).let { it.quantity to it.unit })
    assertEquals(2L to RelativeUnit.Months, parts(70 * 86_400).let { it.quantity to it.unit })
    assertEquals(1L to RelativeUnit.Years, parts(400 * 86_400).let { it.quantity to it.unit })
    assertTrue(parts(300).past)
    assertFalse(RelativeTime.parts(now + 60_000L, now).past)
  }

  @Test
  fun `axis ticks are round numbers that cover the maximum`() {
    assertEquals(listOf(0.0), niceTicks(0.0))
    assertEquals(listOf(0.0, 100_000.0, 200_000.0, 300_000.0), niceTicks(250_000.0))
    assertEquals(listOf(0.0, 2.0, 4.0, 6.0), niceTicks(5.5))
  }
}
