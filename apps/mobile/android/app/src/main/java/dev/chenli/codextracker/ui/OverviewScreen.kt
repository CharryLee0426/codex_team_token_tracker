package dev.chenli.codextracker.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.chenli.codextracker.R
import dev.chenli.codextracker.domain.ConnectionState
import dev.chenli.codextracker.domain.RangePlanner
import dev.chenli.codextracker.domain.UsageScope
import dev.chenli.codextracker.domain.UsageSession
import dev.chenli.codextracker.ui.theme.TrackerTheme
import dev.chenli.codextracker.ui.theme.TrackerType
import dev.chenli.codextracker.ui.theme.monospacedDigit
import dev.chenli.codextracker.ui.theme.weight
import java.time.ZoneId
import java.util.Locale

internal val ScreenMaxWidth = 900.dp

internal fun screenPadding(contentPadding: PaddingValues) =
  PaddingValues(
    start = 16.dp,
    top = 16.dp,
    end = 16.dp,
    bottom = contentPadding.calculateBottomPadding() + 16.dp,
  )

/** Effective banner state: a failed subscription with retained data reads as offline, like iOS. */
internal fun bannerConnection(connection: ConnectionState, loadable: Loadable<*>): ConnectionState =
  if (connection == ConnectionState.Live && loadable.failed) ConnectionState.Offline else connection

@Composable
internal fun OverviewScreen(
  scope: UsageScope,
  state: MainUiState,
  isDemo: Boolean,
  contentPadding: PaddingValues,
  actions: ShellActions,
) {
  val loadable = if (scope == UsageScope.Personal) state.personal else state.team
  val screenTag = if (scope == UsageScope.Personal) "personal_screen" else "team_screen"
  Box(Modifier.fillMaxSize().testTag(screenTag)) {
    when {
      scope == UsageScope.Team && state.selectedOrgId == null && !state.activatingOrganization ->
        OrganizationRequiredView(state, actions.onOrganizationSelected)
      loadable.data != null ->
        Dashboard(scope, state, loadable, loadable.data, isDemo, contentPadding, actions)
      loadable.error != null && !state.activatingOrganization -> ErrorState(actions.onRetry)
      else -> LoadingState(stringResource(R.string.state_loading))
    }
  }
}

@Composable
private fun Dashboard(
  scope: UsageScope,
  state: MainUiState,
  loadable: Loadable<DashboardData>,
  data: DashboardData,
  isDemo: Boolean,
  contentPadding: PaddingValues,
  actions: ShellActions,
) {
  var sharing by remember { mutableStateOf(false) }
  val locale = currentAppLocale()
  val snapshot = data.snapshot
  val organizationName =
    state.organizations.data?.firstOrNull { it.clerkOrgId == state.selectedClerkOrgId }?.name
  val eyebrow =
    if (scope == UsageScope.Team) organizationName ?: stringResource(R.string.common_team_eyebrow)
    else stringResource(R.string.common_eyebrow)
  val connection = bannerConnection(state.connection, loadable)
  val showBanner = connection != ConnectionState.Live || loadable.stale
  val today = RangePlanner.today(state.now, ZoneId.systemDefault())
  if (sharing) UsageShareDialog(state, scope, snapshot.summary, isDemo) { sharing = false }
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    LazyColumn(
      modifier =
        Modifier.fillMaxHeight().widthIn(max = ScreenMaxWidth).fillMaxWidth().testTag("overview_list"),
      contentPadding = screenPadding(contentPadding),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      item("header") {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
          ScreenHeader(
            eyebrow = eyebrow,
            title =
              stringResource(
                if (scope == UsageScope.Team) R.string.team_title else R.string.personal_title
              ),
            subtitle =
              stringResource(
                if (scope == UsageScope.Team) R.string.team_subtitle
                else R.string.personal_subtitle
              ),
            demo = isDemo,
            modifier = Modifier.weight(1f),
            titleTag = if (scope == UsageScope.Team) "team_title" else "personal_title",
          )
          Spacer(Modifier.width(8.dp))
          RangeControl(
            range = state.range,
            customRange = state.customRange ?: RangePlanner.defaultCustomRange(today),
            today = today,
            onRangeSelected = actions.onRangeSelected,
            onCustomRangeApplied = actions.onCustomRangeApplied,
          )
        }
      }
      item("share") {
        OutlinedButton(onClick = { sharing = true }, modifier = Modifier.testTag("share_open")) {
          Text(stringResource(R.string.share_title))
        }
      }
      if (showBanner) item("status") { StatusBanner(connection, loadable.stale) }
      item("kpis") {
        KpiGrid(
          summary = snapshot.summary,
          scope = scope,
          deviceCount = state.devices.data?.size ?: 0,
          liveCount = data.live.size,
          locale = locale,
        )
      }
      if (snapshot.isEmpty) {
        item("empty") {
          EmptyCard(stringResource(R.string.state_empty_usage), TrackerIcons.emptyUsage, 100.dp)
        }
      } else {
        if (snapshot.sources.size > 1) {
          item("sources") {
            DistributionCard(
              title = stringResource(R.string.charts_sources),
              rows = snapshot.sources.map { BreakdownRow(it.name, it.usage.total, it.share) },
              locale = locale,
              testTag = "sources_chart",
            )
          }
        }
        item("usage") { UsageOverTimeCard(snapshot.daily, locale) }
        item("contribution") { ContributionHeatmapCard(snapshot.daily, state.now, locale) }
        item("hours") { ActiveHoursCard(snapshot.activeHours, locale) }
        item("weekday") { WeekdayCard(snapshot.weekdays, locale) }
        item("models") {
          DistributionCard(
            title = stringResource(R.string.charts_models),
            rows = snapshot.models.map { BreakdownRow(it.name, it.usage.total, it.share) },
            locale = locale,
            testTag = "models_chart",
          )
        }
        if (scope == UsageScope.Team) {
          item("members") {
            DistributionCard(
              title = stringResource(R.string.charts_member_contribution),
              rows = snapshot.members.map { BreakdownRow(it.displayName, it.total, it.share) },
              locale = locale,
              testTag = "members_chart",
            )
          }
        }
      }
      item("sessions") { RecentSessionsCard(data.sessions.take(12), state.now, locale) }
    }
  }
}

@Composable
private fun RecentSessionsCard(sessions: List<UsageSession>, now: Long, locale: Locale) {
  val colors = TrackerTheme.colors
  DashboardCard(title = stringResource(R.string.sessions_title), modifier = Modifier.testTag("sessions_card")) {
    if (sessions.isEmpty()) {
      Text(
        stringResource(R.string.state_empty_usage),
        style = TrackerType.body,
        color = colors.secondaryText,
      )
    } else {
      sessions.forEachIndexed { index, session ->
        Column(
          modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
          verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
          Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
              session.projectName ?: session.model,
              style = TrackerType.subheadline.weight(FontWeight.SemiBold),
              color = colors.text,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
              modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(12.dp))
            Text(
              AppFormat.tokens(session.total, locale),
              style = TrackerType.subheadline.monospacedDigit(),
              color = colors.text,
            )
          }
          Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
              stringResource(R.string.sessions_agent_model, session.agent, session.model),
              style = TrackerType.caption,
              color = colors.secondaryText,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
              modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(12.dp))
            Text(
              AppFormat.relative(session.lastActivityAt, now, locale),
              style = TrackerType.caption,
              color = colors.secondaryText,
            )
          }
        }
        if (index != sessions.lastIndex) CardDivider()
      }
    }
  }
}

/** The iOS `OrganizationRequiredView` shown on the Team tab until an organization is active. */
@Composable
internal fun OrganizationRequiredView(state: MainUiState, onOrganizationSelected: (String) -> Unit) {
  val colors = TrackerTheme.colors
  val organizations = state.organizations.data.orEmpty()
  Column(
    modifier = Modifier.fillMaxSize().padding(28.dp).testTag("organization_required"),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterVertically),
  ) {
    Icon(
      TrackerIcons.organizationRequired,
      contentDescription = null,
      tint = colors.accent,
      modifier = Modifier.size(34.dp),
    )
    Text(
      stringResource(R.string.state_no_organization),
      style = TrackerType.headline,
      color = colors.text,
      textAlign = TextAlign.Center,
    )
    if (state.teamUnavailable) {
      Text(
        stringResource(R.string.state_team_unavailable),
        style = TrackerType.body,
        color = colors.secondaryText,
        textAlign = TextAlign.Center,
      )
    }
    when {
      state.organizations.loading && state.organizations.data == null ->
        CircularProgressIndicator(modifier = Modifier.size(22.dp), color = colors.secondaryText)
      organizations.isEmpty() ->
        Text(
          stringResource(R.string.state_no_organizations),
          style = TrackerType.body,
          color = colors.secondaryText,
          textAlign = TextAlign.Center,
        )
      else ->
        organizations.forEach { organization ->
          ProminentButton(
            text = organization.name,
            onClick = { onOrganizationSelected(organization.clerkOrgId) },
            testTag = "organization_${organization.clerkOrgId}",
          )
        }
    }
  }
}

@Composable
internal fun ErrorState(onRetry: () -> Unit) {
  ContentUnavailable(
    title = stringResource(R.string.error_load),
    icon = TrackerIcons.warning,
    modifier = Modifier.testTag("error_state"),
  ) {
    ProminentButton(stringResource(R.string.common_retry), onClick = onRetry, testTag = "retry")
  }
}
