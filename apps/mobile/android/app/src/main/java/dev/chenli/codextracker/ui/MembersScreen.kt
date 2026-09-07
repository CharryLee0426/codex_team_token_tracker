package dev.chenli.codextracker.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.chenli.codextracker.R
import dev.chenli.codextracker.domain.ConnectionState
import dev.chenli.codextracker.domain.Member
import dev.chenli.codextracker.ui.theme.TrackerTheme
import dev.chenli.codextracker.ui.theme.TrackerType
import dev.chenli.codextracker.ui.theme.weight
import java.util.Locale

@Composable
internal fun MembersScreen(
  state: MainUiState,
  isDemo: Boolean,
  contentPadding: PaddingValues,
  actions: ShellActions,
) {
  val members = state.members.data
  Box(Modifier.fillMaxSize().testTag("members_screen")) {
    when {
      state.selectedOrgId == null && !state.activatingOrganization ->
        MembersOrganizationState(state, actions.onOrganizationSelected)
      members != null -> MembersList(state, members, isDemo, contentPadding, actions)
      state.members.error != null && !state.activatingOrganization -> ErrorState(actions.onRetry)
      else -> LoadingState(stringResource(R.string.state_loading))
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MembersList(
  state: MainUiState,
  members: List<Member>,
  isDemo: Boolean,
  contentPadding: PaddingValues,
  actions: ShellActions,
) {
  val locale = currentAppLocale()
  val organizationName =
    state.organizations.data?.firstOrNull { it.clerkOrgId == state.selectedClerkOrgId }?.name
  val connection = bannerConnection(state.connection, state.members)
  val showBanner = connection != ConnectionState.Live || state.members.stale
  PullToRefreshBox(
    isRefreshing = state.refreshing,
    onRefresh = actions.onRefresh,
    modifier = Modifier.fillMaxSize(),
  ) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
      LazyColumn(
        modifier = Modifier.fillMaxHeight().widthIn(max = ScreenMaxWidth).fillMaxWidth(),
        contentPadding = screenPadding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(16.dp),
      ) {
        item("header") {
          ScreenHeader(
            eyebrow = organizationName ?: stringResource(R.string.common_eyebrow),
            title = stringResource(R.string.members_title),
            subtitle = stringResource(R.string.members_subtitle),
            demo = isDemo,
            titleTag = "members_title",
          )
        }
        if (showBanner) item("status") { StatusBanner(connection, state.members.stale) }
        if (members.isEmpty()) {
          item("empty") {
            EmptyCard(
              stringResource(R.string.state_empty_members),
              TrackerIcons.emptyMembers,
              112.dp,
            )
          }
        } else {
          items(members, key = Member::id) { member -> MemberCard(member, state.now, locale) }
        }
      }
    }
  }
}

@Composable
private fun MemberCard(member: Member, now: Long, locale: Locale) {
  val colors = TrackerTheme.colors
  val displayName = member.name ?: member.email ?: stringResource(R.string.common_unknown_user)
  val live = member.live
  DashboardCard(modifier = Modifier.semantics(mergeDescendants = true) {}) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
      RemoteAvatar(member.imageUrl, displayName)
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(
          displayName,
          style = TrackerType.headline,
          color = colors.text,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
        val email = member.email
        if (email != null && email != displayName) {
          Text(
            email,
            style = TrackerType.caption,
            color = colors.secondaryText,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
        }
      }
      RoleBadge(member.role)
    }
    CardDivider()
    if (live != null) {
      LiveLine(
        stringResource(
          R.string.members_live,
          live.model ?: stringResource(R.string.common_unknown),
          AppFormat.decimal(live.tokensPerSecond, locale),
        )
      )
    } else {
      IdleLine(stringResource(R.string.members_offline), TrackerIcons.offline)
    }
    RowOrColumn {
      MetadataLabel(
        pluralStringResource(
          R.plurals.members_devices,
          member.deviceCount,
          AppFormat.integer(member.deviceCount.toLong(), locale),
        ),
        TrackerIcons.memberDevices,
      )
      MetadataLabel(
        member.lastSeenAt?.let {
          stringResource(R.string.devices_last_seen, AppFormat.relative(it, now, locale))
        } ?: stringResource(R.string.common_unknown),
        TrackerIcons.clock,
      )
      MetadataLabel(
        stringResource(R.string.members_joined, AppFormat.date(member.joinedAt, locale)),
        TrackerIcons.joined,
      )
    }
  }
}

internal enum class KnownOrganizationRole { Admin, Member }

internal fun knownOrganizationRole(role: String): KnownOrganizationRole? =
  when (role.removePrefix("org:").lowercase()) {
    "admin" -> KnownOrganizationRole.Admin
    "member" -> KnownOrganizationRole.Member
    else -> null
  }

@Composable
internal fun localizedOrganizationRole(role: String): String =
  when (knownOrganizationRole(role)) {
    KnownOrganizationRole.Admin -> stringResource(R.string.members_admin)
    KnownOrganizationRole.Member -> stringResource(R.string.members_member)
    null -> role.removePrefix("org:")
  }

@Composable
private fun RoleBadge(role: String) {
  val colors = TrackerTheme.colors
  val admin = knownOrganizationRole(role) == KnownOrganizationRole.Admin
  Text(
    text = localizedOrganizationRole(role),
    style = TrackerType.caption2.weight(FontWeight.SemiBold),
    color = if (admin) colors.accent else colors.secondaryText,
    modifier =
      Modifier
        .background(
          if (admin) colors.accent.copy(alpha = 0.12f) else colors.cardSecondary,
          CircleShape,
        )
        .padding(horizontal = 9.dp, vertical = 5.dp),
  )
}

@Composable
private fun MembersOrganizationState(state: MainUiState, onOrganizationSelected: (String) -> Unit) {
  val organizations = state.organizations.data.orEmpty()
  ContentUnavailable(
    title = stringResource(R.string.state_no_organization),
    icon = TrackerIcons.emptyMembers,
    modifier = Modifier.testTag("organization_required"),
    description =
      when {
        state.teamUnavailable -> stringResource(R.string.state_team_unavailable)
        organizations.isEmpty() && !state.organizations.loading ->
          stringResource(R.string.state_no_organizations)
        else -> stringResource(R.string.settings_organization_hint)
      },
  ) {
    organizations.forEach { organization ->
      ProminentButton(
        text = organization.name,
        onClick = { onOrganizationSelected(organization.clerkOrgId) },
        modifier = Modifier.padding(top = 8.dp),
        testTag = "organization_${organization.clerkOrgId}",
      )
    }
  }
}
