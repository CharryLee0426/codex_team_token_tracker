package dev.chenli.codextracker.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.chenli.codextracker.BuildConfig
import dev.chenli.codextracker.R
import dev.chenli.codextracker.domain.ConnectionState
import dev.chenli.codextracker.ui.theme.TrackerTheme
import dev.chenli.codextracker.ui.theme.TrackerType
import dev.chenli.codextracker.ui.theme.monospaced
import dev.chenli.codextracker.ui.theme.weight

private val SettingsMaxWidth = 720.dp

@Composable
internal fun SettingsScreen(
  state: MainUiState,
  isDemo: Boolean,
  preferences: ViewerPreferences,
  contentPadding: PaddingValues,
  actions: ShellActions,
) {
  Box(Modifier.fillMaxSize().testTag("settings_screen"), contentAlignment = Alignment.TopCenter) {
    LazyColumn(
      modifier = Modifier.fillMaxHeight().widthIn(max = SettingsMaxWidth).fillMaxWidth(),
      contentPadding = screenPadding(contentPadding),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      item("header") {
        ScreenHeader(
          eyebrow = stringResource(R.string.common_eyebrow),
          title = stringResource(R.string.settings_title),
          subtitle = stringResource(R.string.settings_subtitle),
          demo = isDemo,
          titleTag = "settings_title",
        )
      }
      item("account") { AccountCard(state, isDemo, actions) }
      item("preferences") { PreferenceCard(preferences, actions) }
      item("connection") { ConnectionCard(state.connection, isDemo, actions.onSimulateConnection) }
      item("pricing") {
        InformationCard(R.string.settings_pricing, R.string.settings_pricing_body)
      }
      item("privacy") {
        InformationCard(R.string.settings_privacy, R.string.settings_privacy_body)
      }
      item("about") { AboutCard() }
    }
  }
}

@Composable
private fun AccountCard(state: MainUiState, isDemo: Boolean, actions: ShellActions) {
  val colors = TrackerTheme.colors
  DashboardCard(title = stringResource(R.string.settings_organization)) {
    state.account.data?.let { account ->
      val displayName =
        account.name ?: account.email ?: stringResource(R.string.common_unknown_user)
      Row(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        RemoteAvatar(account.imageUrl, displayName)
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
          Text(
            displayName,
            style = TrackerType.headline,
            color = colors.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
          val email = account.email
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
      }
    }
    Text(
      stringResource(R.string.settings_organization_hint),
      style = TrackerType.caption,
      color = colors.secondaryText,
    )
    val organizations = state.organizations.data
    when {
      organizations == null && state.organizations.loading ->
        CircularProgressIndicator(modifier = Modifier.size(22.dp), color = colors.secondaryText)
      organizations.isNullOrEmpty() ->
        Text(
          stringResource(R.string.state_no_organizations),
          style = TrackerType.subheadline,
          color = colors.secondaryText,
        )
      else ->
        organizations.forEach { organization ->
          SelectionRow(
            label = organization.name,
            icon = TrackerIcons.organization,
            selected = state.selectedClerkOrgId == organization.clerkOrgId,
            testTag = "settings_organization_${organization.clerkOrgId}",
            onClick = { actions.onOrganizationSelected(organization.clerkOrgId) },
          )
        }
    }
    if (state.teamUnavailable) {
      Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Icon(
          TrackerIcons.shieldWarning,
          contentDescription = null,
          tint = colors.warning,
          modifier = Modifier.size(18.dp),
        )
        Text(
          stringResource(R.string.state_team_unavailable),
          style = TrackerType.footnote,
          color = colors.warning,
        )
      }
    }
    if (!isDemo) {
      TintedButton(
        text = stringResource(R.string.settings_sign_out),
        onClick = actions.onSignOut,
        modifier = Modifier.fillMaxWidth(),
        tint = colors.destructive,
        icon = TrackerIcons.signOut,
        testTag = "sign_out",
      )
    }
  }
}

@Composable
private fun PreferenceCard(preferences: ViewerPreferences, actions: ShellActions) {
  val colors = TrackerTheme.colors
  DashboardCard {
    Text(stringResource(R.string.settings_appearance), style = TrackerType.headline, color = colors.text)
    ThemeMode.entries.forEach { option ->
      SelectionRow(
        label =
          stringResource(
            when (option) {
              ThemeMode.System -> R.string.theme_system
              ThemeMode.Light -> R.string.theme_light
              ThemeMode.Dark -> R.string.theme_dark
            }
          ),
        icon =
          when (option) {
            ThemeMode.System -> TrackerIcons.appearanceSystem
            ThemeMode.Light -> TrackerIcons.appearanceLight
            ThemeMode.Dark -> TrackerIcons.appearanceDark
          },
        selected = preferences.theme == option,
        testTag = "theme_${option.name.lowercase()}",
        onClick = { actions.onThemeSelected(option) },
      )
    }
    CardDivider()
    Text(stringResource(R.string.settings_language), style = TrackerType.headline, color = colors.text)
    LanguageMode.entries.forEach { option ->
      SelectionRow(
        label =
          stringResource(
            when (option) {
              LanguageMode.English -> R.string.language_en
              LanguageMode.Chinese -> R.string.language_zh
            }
          ),
        icon = TrackerIcons.language,
        selected = preferences.language == option,
        testTag = "language_${option.key}",
        onClick = { actions.onLanguageSelected(option) },
      )
    }
  }
}

@Composable
private fun ConnectionCard(connection: ConnectionState, isDemo: Boolean, onSimulate: () -> Unit) {
  val colors = TrackerTheme.colors
  val (text, tag) =
    when (connection) {
      ConnectionState.Live -> R.string.connection_live to "connection_live"
      ConnectionState.Reconnecting -> R.string.connection_reconnecting to "connection_reconnecting"
      ConnectionState.Offline -> R.string.connection_offline to "connection_offline"
    }
  val icon =
    when (connection) {
      ConnectionState.Live -> TrackerIcons.checkCircle
      ConnectionState.Reconnecting -> TrackerIcons.sync
      ConnectionState.Offline -> TrackerIcons.wifiOff
    }
  val tint = if (connection == ConnectionState.Live) colors.accent else colors.secondaryText
  DashboardCard(title = stringResource(R.string.settings_connection)) {
    Row(
      modifier = Modifier.testTag(tag),
      horizontalArrangement = Arrangement.spacedBy(8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
      Text(stringResource(text), style = TrackerType.body, color = tint)
    }
    if (BuildConfig.DEBUG && isDemo) {
      TintedButton(
        text =
          stringResource(
            if (connection == ConnectionState.Live) R.string.connection_simulate_offline
            else R.string.connection_reconnect
          ),
        onClick = onSimulate,
        testTag = "demo_connection_toggle",
      )
    }
  }
}

@Composable
private fun InformationCard(title: Int, body: Int) {
  DashboardCard(title = stringResource(title)) {
    Text(
      stringResource(body),
      style = TrackerType.subheadline,
      color = TrackerTheme.colors.secondaryText,
    )
  }
}

@Composable
private fun AboutCard() {
  val colors = TrackerTheme.colors
  DashboardCard(title = stringResource(R.string.settings_about)) {
    Row(
      horizontalArrangement = Arrangement.spacedBy(8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(
        TrackerIcons.about,
        contentDescription = null,
        tint = colors.accent,
        modifier = Modifier.size(20.dp),
      )
      Text(
        stringResource(R.string.app_name),
        style = TrackerType.headline.weight(FontWeight.SemiBold),
        color = colors.text,
      )
    }
    Text(
      stringResource(R.string.app_version, BuildConfig.VERSION_NAME),
      style = TrackerType.caption.monospaced(),
      color = colors.secondaryText,
    )
  }
}
