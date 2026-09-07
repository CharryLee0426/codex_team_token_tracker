package dev.chenli.codextracker.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.chenli.codextracker.R
import dev.chenli.codextracker.domain.DailyUsage
import dev.chenli.codextracker.domain.UsageAggregator
import dev.chenli.codextracker.domain.WeekdayUsage
import dev.chenli.codextracker.ui.theme.TrackerTheme
import dev.chenli.codextracker.ui.theme.TrackerType
import dev.chenli.codextracker.ui.theme.monospacedDigit
import dev.chenli.codextracker.ui.theme.weight
import java.time.format.TextStyle as WeekdayTextStyle
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sqrt

data class BreakdownRow(val name: String, val total: Long, val share: Double)

/** Round axis ticks from zero to just above [maxValue], the way Swift Charts picks them. */
internal fun niceTicks(maxValue: Double, targetCount: Int = 3): List<Double> {
  if (maxValue <= 0.0 || maxValue.isNaN()) return listOf(0.0)
  val rawStep = maxValue / targetCount
  val magnitude = 10.0.pow(floor(log10(rawStep)))
  val normalized = rawStep / magnitude
  val step =
    when {
      normalized <= 1.0 -> 1.0
      normalized <= 2.0 -> 2.0
      normalized <= 5.0 -> 5.0
      else -> 10.0
    } * magnitude
  val top = ceil(maxValue / step) * step
  return generateSequence(0.0) { it + step }.takeWhile { it <= top + step / 2 }.toList()
}

/** Fritsch–Carlson monotone cubic interpolation, matching Swift Charts' `.monotone`. */
internal fun monotonePath(points: List<Offset>): Path {
  val path = Path()
  if (points.isEmpty()) return path
  path.moveTo(points[0].x, points[0].y)
  val n = points.size
  if (n == 1) return path
  if (n == 2) {
    path.lineTo(points[1].x, points[1].y)
    return path
  }
  val dx = FloatArray(n - 1)
  val slopes = FloatArray(n - 1)
  for (i in 0 until n - 1) {
    dx[i] = points[i + 1].x - points[i].x
    slopes[i] = if (dx[i] == 0f) 0f else (points[i + 1].y - points[i].y) / dx[i]
  }
  val tangents = FloatArray(n)
  tangents[0] = slopes[0]
  tangents[n - 1] = slopes[n - 2]
  for (i in 1 until n - 1) {
    tangents[i] = if (slopes[i - 1] * slopes[i] <= 0f) 0f else (slopes[i - 1] + slopes[i]) / 2f
  }
  for (i in 0 until n - 1) {
    if (slopes[i] == 0f) {
      tangents[i] = 0f
      tangents[i + 1] = 0f
    } else {
      val a = tangents[i] / slopes[i]
      val b = tangents[i + 1] / slopes[i]
      val s = a * a + b * b
      if (s > 9f) {
        val tau = 3f / sqrt(s)
        tangents[i] = tau * a * slopes[i]
        tangents[i + 1] = tau * b * slopes[i]
      }
    }
  }
  for (i in 0 until n - 1) {
    val start = points[i]
    val end = points[i + 1]
    val third = dx[i] / 3f
    path.cubicTo(
      start.x + third,
      start.y + tangents[i] * third,
      end.x - third,
      end.y - tangents[i + 1] * third,
      end.x,
      end.y,
    )
  }
  return path
}

/** Area + monotone line of daily totals with a leading value axis, like the iOS card. */
@Composable
fun UsageOverTimeCard(daily: List<DailyUsage>, locale: Locale) {
  val colors = TrackerTheme.colors
  val title = stringResource(R.string.charts_usage)
  val measurer = rememberTextMeasurer()
  val ticks = remember(daily) { niceTicks(daily.maxOfOrNull { it.total }?.toDouble() ?: 0.0) }
  val maxTick = ticks.last().coerceAtLeast(1.0)
  val labelStyle = TrackerType.caption2.copy(color = colors.secondaryText)
  val description =
    remember(daily, locale, title) {
      title + ". " + daily.joinToString("; ") { "${it.date}, ${AppFormat.tokens(it.total, locale)}" }
    }
  DashboardCard(title = title) {
    Canvas(
      modifier =
        Modifier
          .fillMaxWidth()
          .height(180.dp)
          .testTag("usage_chart")
          .semantics { contentDescription = description }
    ) {
      val labels = ticks.map { measurer.measure(AppFormat.tokens(it, locale), labelStyle) }
      val plotLeft = (labels.maxOfOrNull { it.size.width } ?: 0) + 8.dp.toPx()
      val plotRight = size.width
      val plotTop = 8.dp.toPx()
      val plotBottom = size.height - 8.dp.toPx()
      fun yFor(value: Double): Float =
        plotBottom - (value / maxTick).toFloat() * (plotBottom - plotTop)
      ticks.forEachIndexed { index, tick ->
        val y = yFor(tick)
        drawLine(colors.border, Offset(plotLeft, y), Offset(plotRight, y), 1.dp.toPx())
        val label = labels[index]
        drawText(
          textLayoutResult = label,
          topLeft =
            Offset(
              0f,
              (y - label.size.height / 2f).coerceIn(0f, size.height - label.size.height),
            ),
        )
      }
      if (daily.isEmpty()) return@Canvas
      val count = daily.size
      val points =
        daily.mapIndexed { index, day ->
          val x =
            if (count == 1) (plotLeft + plotRight) / 2f
            else plotLeft + (plotRight - plotLeft) * index / (count - 1)
          Offset(x, yFor(day.total.toDouble()))
        }
      if (count == 1) {
        drawCircle(colors.accent, 4.dp.toPx(), points[0])
        return@Canvas
      }
      val line = monotonePath(points)
      val area =
        Path().apply {
          addPath(line)
          lineTo(points.last().x, plotBottom)
          lineTo(points.first().x, plotBottom)
          close()
        }
      drawPath(area, colors.accent.copy(alpha = 0.16f))
      drawPath(
        line,
        colors.accent,
        style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
      )
    }
    AccessibleDataList(daily.map { it.date.toString() to AppFormat.tokens(it.total, locale) })
  }
}

/** Horizontal bars per category with the label above each bar, as Swift Charts renders them. */
@Composable
fun DistributionCard(title: String, rows: List<BreakdownRow>, locale: Locale, testTag: String) {
  val colors = TrackerTheme.colors
  val maximum = (rows.maxOfOrNull { it.total } ?: 0L).coerceAtLeast(1L)
  val height = max(140, rows.size * 32).dp
  val description =
    remember(rows, locale, title) {
      title + ". " + rows.joinToString("; ") { "${it.name}, ${AppFormat.percent(it.share, locale)}" }
    }
  val gradient =
    Brush.verticalGradient(listOf(lerp(colors.accent, Color.White, 0.22f), colors.accent))
  DashboardCard(title = title) {
    Column(
      modifier =
        Modifier
          .fillMaxWidth()
          .height(height)
          .testTag(testTag)
          .semantics { contentDescription = description }
    ) {
      rows.forEach { row ->
        Column(Modifier.weight(1f).fillMaxWidth()) {
          HorizontalDivider(color = colors.border, thickness = 1.dp)
          Text(
            row.name,
            style = TrackerType.caption,
            color = colors.secondaryText,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 6.dp, top = 3.dp),
          )
          Box(Modifier.weight(1f).fillMaxWidth().padding(top = 4.dp, bottom = 6.dp)) {
            Box(
              Modifier
                .fillMaxHeight()
                .fillMaxWidth((row.total.toFloat() / maximum).coerceIn(0f, 1f))
                .clip(RoundedCornerShape(3.dp))
                .background(gradient)
            )
          }
        }
      }
    }
    AccessibleDataList(
      rows.map {
        it.name to
          stringResource(
            R.string.charts_tokens_share,
            AppFormat.tokens(it.total, locale),
            AppFormat.percent(it.share, locale),
          )
      }
    )
  }
}

/** Monday–Sunday bars with weekday labels and a hidden value axis. */
@Composable
fun WeekdayCard(values: List<WeekdayUsage>, locale: Locale) {
  val colors = TrackerTheme.colors
  val title = stringResource(R.string.charts_weekday)
  val measurer = rememberTextMeasurer()
  val labels =
    remember(values, locale) {
      values.map {
        UsageAggregator.dayOfWeek(it.weekday).getDisplayName(WeekdayTextStyle.SHORT, locale)
      }
    }
  val labelStyle = TrackerType.caption2.copy(color = colors.secondaryText)
  val description =
    remember(values, locale, title) {
      title + ". " +
        labels.zip(values).joinToString("; ") { (label, value) ->
          "$label, ${AppFormat.tokens(value.total, locale)}"
        }
    }
  DashboardCard(title = title) {
    Canvas(
      modifier =
        Modifier
          .fillMaxWidth()
          .height(150.dp)
          .testTag("weekday_chart")
          .semantics { contentDescription = description }
    ) {
      if (values.isEmpty()) return@Canvas
      val measured = labels.map { measurer.measure(it, labelStyle) }
      val labelHeight = measured.maxOf { it.size.height }
      val plotBottom = size.height - labelHeight - 6.dp.toPx()
      val plotTop = 4.dp.toPx()
      val band = size.width / values.size
      val barWidth = band * 0.62f
      val maximum = values.maxOf { it.total }.coerceAtLeast(1L)
      values.forEachIndexed { index, value ->
        val left = band * index
        drawLine(colors.border, Offset(left, plotTop), Offset(left, plotBottom), 1.dp.toPx())
        val barHeight = (value.total.toFloat() / maximum) * (plotBottom - plotTop)
        if (barHeight > 0f) {
          drawRoundRect(
            color = colors.accent,
            topLeft = Offset(left + (band - barWidth) / 2f, plotBottom - barHeight),
            size = Size(barWidth, barHeight),
            cornerRadius = CornerRadius(3.dp.toPx()),
          )
        }
        val label = measured[index]
        drawText(
          textLayoutResult = label,
          topLeft = Offset(left + (band - label.size.width) / 2f, plotBottom + 6.dp.toPx()),
        )
      }
      drawLine(colors.border, Offset(0f, plotBottom), Offset(size.width, plotBottom), 1.dp.toPx())
    }
    AccessibleDataList(labels.zip(values) { label, value -> label to AppFormat.tokens(value.total, locale) })
  }
}

/** The iOS `AccessibleDataList` disclosure: a text alternative under every chart. */
@Composable
fun AccessibleDataList(items: List<Pair<String, String>>, modifier: Modifier = Modifier) {
  val colors = TrackerTheme.colors
  var expanded by rememberSaveable { mutableStateOf(false) }
  val expandLabel = stringResource(R.string.a11y_expand)
  val collapseLabel = stringResource(R.string.a11y_collapse)
  Column(modifier.fillMaxWidth()) {
    Row(
      modifier =
        Modifier
          .fillMaxWidth()
          .heightIn(min = 32.dp)
          .clickable(
            interactionSource = remember { MutableInteractionSource() },
            indication = null,
            role = Role.Button,
          ) {
            expanded = !expanded
          }
          .semantics { stateDescription = if (expanded) collapseLabel else expandLabel }
          .testTag("chart_data_toggle"),
      horizontalArrangement = Arrangement.spacedBy(6.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(
        TrackerIcons.dataList,
        contentDescription = null,
        tint = colors.accent,
        modifier = Modifier.size(18.dp),
      )
      Text(
        stringResource(R.string.common_view_data),
        style = TrackerType.footnote.weight(FontWeight.Medium),
        color = colors.accent,
        modifier = Modifier.weight(1f),
      )
      Icon(
        TrackerIcons.chevron,
        contentDescription = null,
        tint = colors.accent,
        modifier = Modifier.size(18.dp).rotate(if (expanded) 90f else 0f),
      )
    }
    if (expanded) {
      Column(
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp).testTag("chart_data_list"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        items.forEach { (name, value) ->
          Row(
            modifier = Modifier.fillMaxWidth().testTag("chart_data_point"),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Text(
              name,
              style = TrackerType.caption,
              color = colors.secondaryText,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
              modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(12.dp))
            Text(value, style = TrackerType.caption.monospacedDigit(), color = colors.text)
          }
        }
      }
    }
  }
}
