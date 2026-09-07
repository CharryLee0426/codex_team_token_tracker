package dev.chenli.codextracker.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.chenli.codextracker.R
import dev.chenli.codextracker.domain.UsageScope
import dev.chenli.codextracker.domain.UsageSummary
import dev.chenli.codextracker.ui.theme.TrackerTheme
import dev.chenli.codextracker.ui.theme.TrackerType
import dev.chenli.codextracker.ui.theme.monospaced
import dev.chenli.codextracker.ui.theme.monospacedDigit
import java.util.Locale
import kotlin.math.max

private data class KpiSpec(
  val label: String,
  val value: String,
  val detail: String?,
  val tag: String,
  val hero: Boolean = false,
)

/** The iOS adaptive KPI grid: as many 145pt-minimum columns as fit, 12pt gutters, six tiles. */
@Composable
fun KpiGrid(
  summary: UsageSummary,
  scope: UsageScope,
  deviceCount: Int,
  liveCount: Int,
  locale: Locale,
  modifier: Modifier = Modifier,
) {
  val usage = summary.usage
  val items =
    listOf(
      KpiSpec(
        label = stringResource(R.string.kpi_total_tokens),
        value = AppFormat.tokens(usage.total, locale),
        detail =
          stringResource(
            R.string.kpi_token_flow,
            AppFormat.tokens(usage.input, locale),
            AppFormat.tokens(usage.output, locale),
          ),
        tag = "kpi_total",
        hero = true,
      ),
      KpiSpec(
        label = stringResource(R.string.kpi_cost),
        value = AppFormat.currency(summary.cost, locale),
        detail = null,
        tag = "kpi_cost",
      ),
      KpiSpec(
        label = stringResource(R.string.kpi_cache_hit),
        value = AppFormat.percent(summary.cacheHitRate, locale),
        detail = AppFormat.tokens(usage.cached, locale),
        tag = "kpi_cache",
      ),
      KpiSpec(
        label = stringResource(R.string.kpi_requests),
        value = AppFormat.integer(usage.requests, locale),
        detail =
          if (usage.requests == 0L) null
          else
            stringResource(
              R.string.kpi_average,
              AppFormat.tokens(summary.averageTokensPerRequest, locale),
            ),
        tag = "kpi_requests",
      ),
      if (scope == UsageScope.Personal) {
        KpiSpec(
          label = stringResource(R.string.kpi_devices),
          value = deviceCount.toString(),
          detail = null,
          tag = "kpi_devices",
        )
      } else {
        KpiSpec(
          label = stringResource(R.string.kpi_active_members),
          value = summary.activeUsers.toString(),
          detail = null,
          tag = "kpi_members",
        )
      },
      KpiSpec(
        label = stringResource(R.string.kpi_live_now),
        value = liveCount.toString(),
        detail = if (liveCount > 0) "●" else null,
        tag = "kpi_live",
      ),
    )
  val spacing = 12.dp
  BoxWithConstraints(modifier.fillMaxWidth()) {
    val columns = max(1, ((maxWidth + spacing) / (145.dp + spacing)).toInt())
    Column(verticalArrangement = Arrangement.spacedBy(spacing)) {
      items.chunked(columns).forEach { rowItems ->
        Row(
          modifier = Modifier.height(IntrinsicSize.Max),
          horizontalArrangement = Arrangement.spacedBy(spacing),
        ) {
          rowItems.forEach { item -> KpiItem(item, Modifier.weight(1f).fillMaxHeight()) }
          repeat(columns - rowItems.size) { Spacer(Modifier.weight(1f)) }
        }
      }
    }
  }
}

@Composable
private fun KpiItem(item: KpiSpec, modifier: Modifier = Modifier) {
  val colors = TrackerTheme.colors
  val shape = RoundedCornerShape(CardCornerRadius)
  Column(
    modifier =
      modifier
        .heightIn(min = 92.dp)
        .clip(shape)
        .background(colors.card)
        .border(CardBorderWidth, colors.border, shape)
        .padding(14.dp)
        .semantics(mergeDescendants = true) {},
    verticalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    Text(
      text = item.label.uppercase(),
      style = TrackerType.caption.monospaced().copy(letterSpacing = 0.8.sp),
      color = colors.muted,
      modifier = Modifier.testTag("${item.tag}_label"),
    )
    Text(
      text = item.value,
      style = (if (item.hero) TrackerType.title else TrackerType.title2).monospacedDigit(),
      color = if (item.hero) colors.accent else colors.text,
      maxLines = 1,
      softWrap = false,
      modifier = Modifier.testTag(item.tag),
    )
    if (item.detail != null) {
      Text(
        text = item.detail,
        style = TrackerType.caption.monospacedDigit(),
        color = colors.secondaryText,
      )
    }
  }
}
