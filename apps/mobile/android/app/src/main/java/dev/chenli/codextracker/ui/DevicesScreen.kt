package dev.chenli.codextracker.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.chenli.codextracker.R
import dev.chenli.codextracker.domain.ConnectionState
import dev.chenli.codextracker.domain.Device
import dev.chenli.codextracker.ui.theme.TrackerTheme
import dev.chenli.codextracker.ui.theme.TrackerType
import dev.chenli.codextracker.ui.theme.monospacedDigit
import java.util.Locale

@Composable
internal fun DevicesScreen(
  state: MainUiState,
  isDemo: Boolean,
  contentPadding: PaddingValues,
  actions: ShellActions,
) {
  val devices = state.devices.data
  Box(Modifier.fillMaxSize().testTag("devices_screen")) {
    when {
      devices != null -> DevicesList(state, devices, isDemo, contentPadding, actions)
      state.devices.error != null -> ErrorState(actions.onRetry)
      else -> LoadingState(stringResource(R.string.state_loading))
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DevicesList(
  state: MainUiState,
  devices: List<Device>,
  isDemo: Boolean,
  contentPadding: PaddingValues,
  actions: ShellActions,
) {
  val locale = currentAppLocale()
  val connection = bannerConnection(state.connection, state.devices)
  val showBanner = connection != ConnectionState.Live || state.devices.stale
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
            eyebrow = stringResource(R.string.common_eyebrow),
            title = stringResource(R.string.devices_title),
            subtitle = stringResource(R.string.devices_subtitle),
            demo = isDemo,
            titleTag = "devices_title",
          )
        }
        if (showBanner) item("status") { StatusBanner(connection, state.devices.stale) }
        if (devices.isEmpty()) {
          item("empty") {
            EmptyCard(
              stringResource(R.string.state_empty_devices),
              TrackerIcons.emptyDevices,
              112.dp,
            )
          }
        } else {
          items(devices, key = Device::id) { device -> DeviceCard(device, state.now, locale) }
        }
      }
    }
  }
}

internal fun platformIcon(platform: String): ImageVector {
  val normalized = platform.lowercase()
  return when {
    normalized.startsWith("darwin") || normalized.contains("mac") -> TrackerIcons.laptop
    normalized.startsWith("win") -> TrackerIcons.desktop
    else -> TrackerIcons.terminal
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DeviceCard(device: Device, now: Long, locale: Locale) {
  val colors = TrackerTheme.colors
  val live = device.live
  DashboardCard(modifier = Modifier.semantics(mergeDescendants = true) {}) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
      Box(
        modifier =
          Modifier
            .size(42.dp)
            .background(colors.accent.copy(alpha = 0.12f), RoundedCornerShape(11.dp)),
        contentAlignment = Alignment.Center,
      ) {
        Icon(
          platformIcon(device.platform),
          contentDescription = null,
          tint = colors.accent,
          modifier = Modifier.size(22.dp),
        )
      }
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
          device.name,
          style = TrackerType.headline,
          color = colors.text,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
        )
        FlowRow(
          horizontalArrangement = Arrangement.spacedBy(6.dp),
          verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
          Pill(device.platform)
          device.appVersion?.let { Pill(stringResource(R.string.app_version, it)) }
          if (device.logins > 1) {
            Pill(
              pluralStringResource(
                R.plurals.devices_logins,
                device.logins,
                AppFormat.integer(device.logins.toLong(), locale),
              )
            )
          }
        }
      }
    }
    CardDivider()
    if (live != null) {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LiveLine(
          if (live.sessionId == null) stringResource(R.string.devices_idle)
          else
            stringResource(
              R.string.devices_live,
              live.model ?: stringResource(R.string.common_unknown),
              AppFormat.decimal(live.tokensPerSecond, locale),
            )
        )
        Text(
          stringResource(
            R.string.devices_today,
            AppFormat.tokens(live.todayTotal, locale),
            AppFormat.currency(live.todayCost, locale),
          ),
          style = TrackerType.caption.monospacedDigit(),
          color = colors.secondaryText,
        )
      }
    } else {
      IdleLine(stringResource(R.string.devices_idle), TrackerIcons.idle)
    }
    RowOrColumn {
      device.hostname?.let { MetadataLabel(it, TrackerIcons.network) }
      device.timezone?.let { MetadataLabel(it, TrackerIcons.globe) }
      MetadataLabel(
        stringResource(R.string.devices_last_seen, AppFormat.relative(device.lastSeenAt, now, locale)),
        TrackerIcons.clock,
      )
      MetadataLabel(
        stringResource(R.string.devices_added, AppFormat.date(device.createdAt, locale)),
        TrackerIcons.added,
      )
    }
  }
}
