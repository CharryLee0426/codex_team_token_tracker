package dev.chenli.codextracker.ui

import android.icu.text.DisplayContext
import android.icu.text.RelativeDateTimeFormatter
import android.icu.util.ULocale
import dev.chenli.codextracker.domain.RelativeTime
import dev.chenli.codextracker.domain.RelativeUnit
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Currency
import java.util.Locale
import kotlin.math.abs

/**
 * Number and date presentation shared by every screen. The rules mirror the iOS viewer's
 * `AppFormat`: compact token counts with at most one fraction digit ("620K", "1.2M", "62万"),
 * grouped integers, two-decimal USD, whole percents, medium dates, and abbreviated relative time
 * ("5m ago", the narrow ICU style that Foundation's `.abbreviated` produces).
 */
object AppFormat {
  private data class CompactScale(val divisor: Double, val suffix: String)

  private val latinScales =
    listOf(
      CompactScale(1e3, "K"),
      CompactScale(1e6, "M"),
      CompactScale(1e9, "B"),
      CompactScale(1e12, "T"),
    )
  private val hanScales =
    listOf(CompactScale(1e4, "万"), CompactScale(1e8, "亿"), CompactScale(1e12, "万亿"))

  fun tokens(value: Long, locale: Locale): String = tokens(value.toDouble(), locale)

  fun tokens(value: Double, locale: Locale): String {
    if (value.isNaN() || value.isInfinite()) return plain(0.0, locale)
    val scales = if (locale.language == "zh") hanScales else latinScales
    val magnitude = abs(value)
    var index = scales.indexOfLast { magnitude >= it.divisor }
    while (true) {
      val divisor = if (index < 0) 1.0 else scales[index].divisor
      val scaled = roundHalfEven(value / divisor)
      val next = scales.getOrNull(index + 1)
      if (next != null && abs(scaled) * divisor >= next.divisor) {
        index += 1
        continue
      }
      return plain(scaled, locale) + (if (index < 0) "" else scales[index].suffix)
    }
  }

  fun integer(value: Long, locale: Locale): String =
    NumberFormat.getIntegerInstance(locale).format(value)

  fun currency(value: Double, locale: Locale): String =
    NumberFormat.getCurrencyInstance(locale)
      .apply {
        currency = Currency.getInstance("USD")
        minimumFractionDigits = 2
        maximumFractionDigits = 2
      }
      .format(value)

  fun percent(value: Double, locale: Locale): String =
    NumberFormat.getPercentInstance(locale).apply { maximumFractionDigits = 0 }.format(value)

  fun decimal(value: Double, locale: Locale, fractionDigits: Int = 1): String =
    NumberFormat.getNumberInstance(locale)
      .apply {
        minimumFractionDigits = fractionDigits
        maximumFractionDigits = fractionDigits
      }
      .format(value)

  fun date(millis: Long, locale: Locale, zoneId: ZoneId = ZoneId.systemDefault()): String =
    date(Instant.ofEpochMilli(millis).atZone(zoneId).toLocalDate(), locale)

  fun date(date: LocalDate, locale: Locale): String =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).format(date)

  fun relative(millis: Long, now: Long, locale: Locale): String {
    val parts = RelativeTime.parts(millis, now)
    val formatter =
      RelativeDateTimeFormatter.getInstance(
        ULocale.forLocale(locale),
        null,
        RelativeDateTimeFormatter.Style.NARROW,
        DisplayContext.CAPITALIZATION_NONE,
      )
    val unit =
      when (parts.unit) {
        RelativeUnit.Seconds -> RelativeDateTimeFormatter.RelativeUnit.SECONDS
        RelativeUnit.Minutes -> RelativeDateTimeFormatter.RelativeUnit.MINUTES
        RelativeUnit.Hours -> RelativeDateTimeFormatter.RelativeUnit.HOURS
        RelativeUnit.Days -> RelativeDateTimeFormatter.RelativeUnit.DAYS
        RelativeUnit.Weeks -> RelativeDateTimeFormatter.RelativeUnit.WEEKS
        RelativeUnit.Months -> RelativeDateTimeFormatter.RelativeUnit.MONTHS
        RelativeUnit.Years -> RelativeDateTimeFormatter.RelativeUnit.YEARS
      }
    val direction =
      if (parts.past) RelativeDateTimeFormatter.Direction.LAST
      else RelativeDateTimeFormatter.Direction.NEXT
    return formatter.format(parts.quantity.toDouble(), direction, unit)
  }

  private fun plain(value: Double, locale: Locale): String =
    DecimalFormat("0.#", DecimalFormatSymbols.getInstance(locale))
      .apply { roundingMode = RoundingMode.HALF_EVEN }
      .format(value)

  private fun roundHalfEven(value: Double): Double =
    BigDecimal.valueOf(value).setScale(1, RoundingMode.HALF_EVEN).toDouble()
}
