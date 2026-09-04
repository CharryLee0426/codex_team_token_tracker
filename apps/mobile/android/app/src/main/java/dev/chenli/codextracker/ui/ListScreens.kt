package dev.chenli.codextracker.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.chenli.codextracker.R
import dev.chenli.codextracker.domain.Device
import dev.chenli.codextracker.domain.Member

@Composable
fun MembersScreen(
  state: MainUiState,
  contentPadding: PaddingValues,
  onOrganizationSelected: (String) -> Unit,
) {
  LazyColumn(
    modifier = Modifier.fillMaxSize().testTag("members_screen"),
    contentPadding = screenPadding(contentPadding),
    verticalArrangement = Arrangement.spacedBy(14.dp),
  ) {
    item { ScreenTitle(R.string.members_title, R.string.members_subtitle) }
    item {
      OrganizationSelector(
        organizations = state.organizations,
        selectedClerkOrgId = state.selectedClerkOrgId,
        onSelected = onOrganizationSelected,
      )
    }
    item { StatusMessage(state.members) }
    if (state.selectedOrgId == null) {
      item { EmptyState(R.string.team_unavailable) }
    } else if (state.members.data.isNullOrEmpty() && !state.members.loading) {
      item { EmptyState(R.string.no_members) }
    } else {
      state.members.data.orEmpty().forEach { member -> item(member.id) { MemberCard(member) } }
    }
  }
}

@Composable
private fun MemberCard(member: Member) {
  val locale = currentAppLocale()
  TrackerCard(Modifier.fillMaxWidth()) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
      Text(
        member.name ?: member.email ?: stringResource(R.string.unknown),
        modifier = Modifier.weight(1f),
        fontWeight = FontWeight.SemiBold,
      )
      Text(
        if (member.live != null) stringResource(R.string.live) else stringResource(R.string.not_live),
        color =
          if (member.live != null) MaterialTheme.colorScheme.primary
          else MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.labelLarge,
      )
    }
    member.email?.let {
      Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Spacer(Modifier.height(8.dp))
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
      Text(localizedOrganizationRole(member.role), style = MaterialTheme.typography.bodyMedium)
      Text(
        pluralStringResource(
          R.plurals.device_count,
          member.deviceCount,
          member.deviceCount,
        ),
        style = MaterialTheme.typography.bodyMedium,
      )
    }
    member.lastSeenAt?.let {
      Text(
        stringResource(R.string.last_seen, formatDate(it, locale = locale)),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodyMedium,
      )
    }
  }
}

@Composable
fun DevicesScreen(devices: Loadable<List<Device>>, contentPadding: PaddingValues) {
  LazyColumn(
    modifier = Modifier.fillMaxSize().testTag("devices_screen"),
    contentPadding = screenPadding(contentPadding),
    verticalArrangement = Arrangement.spacedBy(14.dp),
  ) {
    item { ScreenTitle(R.string.devices_title, R.string.devices_subtitle) }
    item { StatusMessage(devices) }
    if (devices.data.isNullOrEmpty() && !devices.loading) {
      item { EmptyState(R.string.no_devices) }
    } else {
      devices.data.orEmpty().forEach { device -> item(device.id) { DeviceCard(device) } }
    }
  }
}

@Composable
private fun DeviceCard(device: Device) {
  val locale = currentAppLocale()
  TrackerCard(Modifier.fillMaxWidth()) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
      Text(device.name, modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
      Text(
        if (device.live != null) stringResource(R.string.live) else stringResource(R.string.not_live),
        color =
          if (device.live != null) MaterialTheme.colorScheme.primary
          else MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.labelLarge,
      )
    }
    Text(device.platform, color = MaterialTheme.colorScheme.onSurfaceVariant)
    device.hostname?.let {
      Text(stringResource(R.string.host, it), style = MaterialTheme.typography.bodyMedium)
    }
    device.appVersion?.let {
      Text(stringResource(R.string.version, it), style = MaterialTheme.typography.bodyMedium)
    }
    Text(
      pluralStringResource(R.plurals.login_count, device.logins, device.logins),
      style = MaterialTheme.typography.bodyMedium,
    )
    Text(
      stringResource(R.string.last_seen, formatDate(device.lastSeenAt, locale = locale)),
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      style = MaterialTheme.typography.bodyMedium,
    )
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
private fun localizedOrganizationRole(role: String): String =
  when (knownOrganizationRole(role)) {
    KnownOrganizationRole.Admin -> stringResource(R.string.organization_role_admin)
    KnownOrganizationRole.Member -> stringResource(R.string.organization_role_member)
    null -> role
  }

private fun screenPadding(contentPadding: PaddingValues) =
  PaddingValues(
    start = 16.dp,
    top = 16.dp,
    end = 16.dp,
    bottom = contentPadding.calculateBottomPadding() + 18.dp,
  )
