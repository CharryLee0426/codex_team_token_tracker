package dev.chenli.codextracker.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.chenli.codextracker.R
import dev.chenli.codextracker.domain.DailyUsage
import dev.chenli.codextracker.domain.MemberContribution
import dev.chenli.codextracker.domain.UsageBreakdown
import dev.chenli.codextracker.domain.UsageRange
import dev.chenli.codextracker.domain.UsageScope
import dev.chenli.codextracker.domain.UsageSession

@Composable
fun UsageScreen(
  scope: UsageScope,
  state: MainUiState,
  contentPadding: PaddingValues,
  onRangeSelected: (UsageRange) -> Unit,
  onOrganizationSelected: (String) -> Unit,
) {
  val loadable = if (scope == UsageScope.Personal) state.personal else state.team
  val screenTag = if (scope == UsageScope.Personal) "personal_screen" else "team_screen"
  val canShowUsage = scope == UsageScope.Personal || state.selectedOrgId != null
  LazyColumn(
    modifier = Modifier.fillMaxSize().testTag(screenTag),
    contentPadding =
      PaddingValues(
        start = 16.dp,
        top = 16.dp,
        end = 16.dp,
        bottom = contentPadding.calculateBottomPadding() + 18.dp,
      ),
    verticalArrangement = Arrangement.spacedBy(14.dp),
  ) {
    item {
      ScreenTitle(
        title = if (scope == UsageScope.Personal) R.string.personal_title else R.string.team_title,
        subtitle =
          if (scope == UsageScope.Personal) R.string.personal_subtitle else R.string.team_subtitle,
      )
    }
    if (scope == UsageScope.Team) {
      item {
        OrganizationSelector(
          organizations = state.organizations,
          selectedClerkOrgId = state.selectedClerkOrgId,
          onSelected = onOrganizationSelected,
        )
      }
      if (state.selectedOrgId == null) {
        item { EmptyState(R.string.team_unavailable) }
      }
    }
    if (canShowUsage) {
      item { RangeSelector(state.range, onRangeSelected) }
      item { StatusMessage(loadable) }

      loadable.data?.let { data ->
        val summary = data.snapshot.summary
        item { KpiGrid(summary, data.live.size) }
        if (summary.usage.total == 0L) {
          item { EmptyState(R.string.no_usage, R.string.no_usage_body) }
        } else {
          item { DailyChart(data.snapshot.daily) }
          item {
            BreakdownCard(stringResource(R.string.model_mix), data.snapshot.models)
          }
          item {
            BreakdownCard(stringResource(R.string.source_mix), data.snapshot.sources)
          }
          if (scope == UsageScope.Team && data.snapshot.members.isNotEmpty()) {
            item { MemberContributionCard(data.snapshot.members) }
          }
        }
        item { SessionsCard(data.sessions) }
      }
    }
  }
}

@Composable
private fun RangeSelector(selected: UsageRange, onSelected: (UsageRange) -> Unit) {
  val ranges =
    listOf(
      UsageRange.Today to R.string.range_today,
      UsageRange.SevenDays to R.string.range_7d,
      UsageRange.ThirtyDays to R.string.range_30d,
      UsageRange.NinetyDays to R.string.range_90d,
    )
  LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    items(ranges, key = { it.first.name }) { (range, label) ->
      FilterChip(
        selected = selected == range,
        onClick = { onSelected(range) },
        label = { Text(stringResource(label)) },
        modifier = Modifier.testTag(range.testTag()),
      )
    }
  }
}

private fun UsageRange.testTag(): String =
  when (this) {
    UsageRange.Today -> "range_today"
    UsageRange.SevenDays -> "range_7d"
    UsageRange.ThirtyDays -> "range_30d"
    UsageRange.NinetyDays -> "range_90d"
  }

@Composable
private fun KpiGrid(summary: dev.chenli.codextracker.domain.UsageSummary, liveCount: Int) {
  val locale = currentAppLocale()
  val items =
    listOf(
      Triple(R.string.kpi_tokens, formatTokens(summary.usage.total, locale), "kpi_total"),
      Triple(R.string.kpi_cost, formatUsd(summary.cost, locale), "kpi_cost"),
      Triple(R.string.kpi_cache, formatPercent(summary.cacheHitRate, locale), "kpi_cache"),
      Triple(R.string.kpi_requests, summary.usage.requests.toString(), "kpi_requests"),
      Triple(R.string.kpi_live, liveCount.toString(), "kpi_live"),
    )
  Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
    items.chunked(2).forEach { rowItems ->
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        rowItems.forEach { (label, value, tag) ->
          KpiCard(label, value, tag, Modifier.weight(1f))
        }
        if (rowItems.size == 1) Spacer(Modifier.weight(1f))
      }
    }
  }
}

@Composable
private fun KpiCard(label: Int, value: String, tag: String, modifier: Modifier = Modifier) {
  TrackerCard(modifier) {
    Text(
      text = stringResource(label).uppercase(),
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      style = MaterialTheme.typography.labelSmall,
    )
    Text(
      text = value,
      fontFamily = MetricFont,
      fontWeight = FontWeight.SemiBold,
      style = MaterialTheme.typography.titleLarge,
      modifier = Modifier.testTag(tag),
    )
  }
}

@Composable
private fun DailyChart(daily: List<DailyUsage>) {
  val description = stringResource(R.string.daily_usage_description)
  val locale = currentAppLocale()
  var showData by rememberSaveable { mutableStateOf(false) }
  TrackerCard(Modifier.fillMaxWidth()) {
    SectionTitle(stringResource(R.string.daily_usage))
    Spacer(Modifier.height(14.dp))
    val visible = daily.takeLast(14)
    val pointDescriptions =
      visible.map { day ->
        pluralStringResource(
          R.plurals.daily_usage_point,
          if (day.total == 1L) 1 else 2,
          formatDate(day.date, locale),
          formatTokens(day.total, locale),
        )
      }
    val accessibleDescription = (listOf(description) + pointDescriptions).joinToString(". ")
    val maximum = visible.maxOfOrNull(DailyUsage::total)?.coerceAtLeast(1) ?: 1
    Row(
      modifier =
        Modifier
          .fillMaxWidth()
          .height(96.dp)
          .testTag("daily_chart")
          .semantics { contentDescription = accessibleDescription },
      horizontalArrangement = Arrangement.spacedBy(4.dp),
      verticalAlignment = Alignment.Bottom,
    ) {
      visible.forEach { day ->
        Box(modifier = Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.BottomCenter) {
          Box(
            modifier =
              Modifier.fillMaxWidth()
                .height((84f * day.total.toFloat() / maximum).dp.coerceAtLeast(2.dp))
                .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(3.dp))
          )
        }
      }
    }
    TextButton(
      onClick = { showData = !showData },
      modifier = Modifier.testTag("daily_data_toggle"),
    ) {
      Text(
        stringResource(
          if (showData) R.string.hide_daily_usage_data else R.string.show_daily_usage_data
        )
      )
    }
    if (showData) {
      Column(
        modifier = Modifier.fillMaxWidth().testTag("daily_data_list"),
        verticalArrangement = Arrangement.spacedBy(5.dp),
      ) {
        pointDescriptions.forEach { point ->
          Text(
            text = point,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.testTag("daily_data_point"),
          )
        }
      }
    }
  }
}

private fun Dp.coerceAtLeast(minimum: Dp): Dp = if (this < minimum) minimum else this

@Composable
private fun BreakdownCard(title: String, breakdown: List<UsageBreakdown>) {
  val locale = currentAppLocale()
  TrackerCard(Modifier.fillMaxWidth()) {
    SectionTitle(title)
    Spacer(Modifier.height(12.dp))
    breakdown.take(6).forEach { item ->
      Column(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
          Text(item.name, modifier = Modifier.weight(1f), maxLines = 1)
          Text(formatTokens(item.usage.total, locale), fontFamily = MetricFont)
        }
        LinearProgressIndicator(
          progress = { item.share.toFloat().coerceIn(0f, 1f) },
          modifier = Modifier.fillMaxWidth().padding(top = 5.dp),
        )
      }
    }
  }
}

@Composable
private fun MemberContributionCard(members: List<MemberContribution>) {
  val locale = currentAppLocale()
  TrackerCard(Modifier.fillMaxWidth()) {
    SectionTitle(stringResource(R.string.member_contribution))
    Spacer(Modifier.height(10.dp))
    members.forEach { member ->
      Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 7.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
      ) {
        Text(member.user.name ?: member.user.email ?: stringResource(R.string.unknown))
        Text(formatTokens(member.total, locale), fontFamily = MetricFont)
      }
    }
  }
}

@Composable
private fun SessionsCard(sessions: List<UsageSession>) {
  val locale = currentAppLocale()
  TrackerCard(Modifier.fillMaxWidth()) {
    SectionTitle(stringResource(R.string.recent_sessions))
    Spacer(Modifier.height(10.dp))
    if (sessions.isEmpty()) {
      Text(
        stringResource(R.string.no_sessions),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    } else {
      sessions.take(8).forEach { session ->
        Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
          Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
              session.projectName ?: session.agent,
              modifier = Modifier.weight(1f),
              fontWeight = FontWeight.Medium,
            )
            Text(formatTokens(session.total, locale), fontFamily = MetricFont)
          }
          Text(
            "${session.model} · ${formatUsd(session.cost, locale)}",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
          )
        }
      }
    }
  }
}
