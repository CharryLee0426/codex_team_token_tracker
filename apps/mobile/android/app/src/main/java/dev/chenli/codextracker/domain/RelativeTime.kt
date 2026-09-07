package dev.chenli.codextracker.domain

import kotlin.math.abs

enum class RelativeUnit { Seconds, Minutes, Hours, Days, Weeks, Months, Years }

data class RelativeParts(val quantity: Long, val unit: RelativeUnit, val past: Boolean)

/** Chooses the largest whole unit for a relative timestamp, matching the iOS abbreviated style. */
object RelativeTime {
  private const val Minute = 60L
  private const val Hour = 60L * Minute
  private const val Day = 24L * Hour
  private const val Week = 7L * Day
  private const val Month = 2_629_800L // 30.4375 days
  private const val Year = 31_557_600L // 365.25 days

  fun parts(millis: Long, now: Long): RelativeParts {
    val difference = now - millis
    val seconds = abs(difference) / 1_000L
    val (quantity, unit) =
      when {
        seconds < Minute -> seconds to RelativeUnit.Seconds
        seconds < Hour -> seconds / Minute to RelativeUnit.Minutes
        seconds < Day -> seconds / Hour to RelativeUnit.Hours
        seconds < Week -> seconds / Day to RelativeUnit.Days
        seconds < Month -> seconds / Week to RelativeUnit.Weeks
        seconds < Year -> seconds / Month to RelativeUnit.Months
        else -> seconds / Year to RelativeUnit.Years
      }
    return RelativeParts(quantity = quantity, unit = unit, past = difference >= 0)
  }
}
