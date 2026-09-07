package dev.chenli.codextracker.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.chenli.codextracker.R
import dev.chenli.codextracker.domain.ActivityCell
import dev.chenli.codextracker.domain.DailyUsage
import dev.chenli.codextracker.domain.RangePlanner
import dev.chenli.codextracker.domain.UsageAggregator
import dev.chenli.codextracker.ui.theme.TrackerTheme
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale

private const val ContributionWeeks = 26

/** GitHub-style daily grid for the last 26 weeks ending today, scrolled horizontally. */
@Composable
fun ContributionHeatmapCard(
  daily: List<DailyUsage>,
  now: Long,
  locale: Locale,
  zoneId: ZoneId = ZoneId.systemDefault(),
) {
  val title = stringResource(R.string.charts_contribution)
  val cells: List<Pair<LocalDate, Long>> =
    remember(daily, now, zoneId) {
      val end = RangePlanner.today(now, zoneId)
      val totals = daily.associate { it.date to it.total }
      (0 until ContributionWeeks * 7).reversed().map { offset ->
        val day = end.minusDays(offset.toLong())
        day to (totals[day] ?: 0L)
      }
    }
  val maximum = cells.maxOf { it.second }
  val active = remember(cells) { cells.filter { it.second > 0 } }
  val description =
    remember(active, locale, title) {
      title + ". " + active.joinToString("; ") { "${it.first}, ${AppFormat.tokens(it.second, locale)}" }
    }
  DashboardCard(title = title) {
    Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 2.dp)) {
      HeatmapGrid(
        columns = ContributionWeeks,
        rows = 7,
        maximum = maximum,
        modifier = Modifier.testTag("contribution_chart").semantics { contentDescription = description },
      ) { column, row ->
        cells[column * 7 + row].second
      }
    }
    AccessibleDataList(active.map { it.first.toString() to AppFormat.tokens(it.second, locale) })
  }
}

/** 24 hour columns × Monday–Sunday rows of local activity. */
@Composable
fun ActiveHoursCard(cells: List<ActivityCell>, locale: Locale) {
  val title = stringResource(R.string.charts_active_hours)
  val byKey = remember(cells) { cells.associateBy { it.weekday * 24 + it.hour } }
  val order = UsageAggregator.weekdayOrder
  val maximum = cells.maxOfOrNull { it.total } ?: 0L
  val names =
    remember(locale) {
      (0..6).map { UsageAggregator.dayOfWeek(it).getDisplayName(TextStyle.SHORT, locale) }
    }
  val active =
    remember(cells) {
      order.flatMap { weekday ->
        (0 until 24).mapNotNull { hour -> byKey[weekday * 24 + hour]?.takeIf { it.total > 0 } }
      }
    }
  val labels = active.map { stringResource(R.string.charts_hour_label, names[it.weekday], it.hour) }
  val description =
    remember(active, labels, locale, title) {
      title + ". " +
        active.zip(labels).joinToString("; ") { (cell, label) ->
          "$label, ${AppFormat.tokens(cell.total, locale)}"
        }
    }
  DashboardCard(title = title) {
    Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 2.dp)) {
      HeatmapGrid(
        columns = 24,
        rows = 7,
        maximum = maximum,
        modifier = Modifier.testTag("active_hours_chart").semantics { contentDescription = description },
      ) { hour, row ->
        byKey[order[row] * 24 + hour]?.total ?: 0L
      }
    }
    AccessibleDataList(
      active.zip(labels) { cell, label -> label to AppFormat.tokens(cell.total, locale) }
    )
  }
}

/** 11pt rounded cells with 3pt gaps; intensity is 20–100 % accent, empty cells use the card tint. */
@Composable
internal fun HeatmapGrid(
  columns: Int,
  rows: Int,
  maximum: Long,
  modifier: Modifier = Modifier,
  valueAt: (column: Int, row: Int) -> Long,
) {
  val colors = TrackerTheme.colors
  val cell = 11.dp
  val gap = 3.dp
  Canvas(
    modifier.size(width = cell * columns + gap * (columns - 1), height = cell * rows + gap * (rows - 1))
  ) {
    val cellPx = cell.toPx()
    val step = cellPx + gap.toPx()
    val radius = CornerRadius(2.dp.toPx())
    for (column in 0 until columns) {
      for (row in 0 until rows) {
        val value = valueAt(column, row)
        val color =
          if (value <= 0L || maximum <= 0L) colors.cardSecondary
          else colors.accent.copy(alpha = 0.2f + 0.8f * value.toFloat() / maximum)
        drawRoundRect(color, Offset(column * step, row * step), Size(cellPx, cellPx), radius)
      }
    }
  }
}
