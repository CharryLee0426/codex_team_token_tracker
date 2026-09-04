package dev.chenli.codextracker.ui

import androidx.annotation.StringRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.chenli.codextracker.R
import dev.chenli.codextracker.domain.Organization
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import java.util.Currency

@Composable
fun DemoBanner() {
  Surface(
    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
    contentColor = MaterialTheme.colorScheme.primary,
    modifier = Modifier.fillMaxWidth().testTag("demo_banner"),
  ) {
    Row(
      modifier = Modifier.padding(horizontal = 16.dp, vertical = 7.dp),
      horizontalArrangement = Arrangement.SpaceBetween,
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Text(stringResource(R.string.demo_preview), style = MaterialTheme.typography.labelLarge)
      Text(stringResource(R.string.viewer_only), style = MaterialTheme.typography.labelSmall)
    }
  }
}

@Composable
fun ScreenTitle(@StringRes title: Int, @StringRes subtitle: Int) {
  Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
    Text(
      text = stringResource(R.string.app_wordmark),
      color = MaterialTheme.colorScheme.primary,
      style = MaterialTheme.typography.labelSmall,
    )
    Text(text = stringResource(title), style = MaterialTheme.typography.headlineSmall)
    Text(
      text = stringResource(subtitle),
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      style = MaterialTheme.typography.bodyMedium,
    )
  }
}

@Composable
fun TrackerCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
  Card(
    modifier = modifier,
    shape = RoundedCornerShape(14.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)),
  ) {
    Column(modifier = Modifier.fillMaxWidth().padding(14.dp)) { content() }
  }
}

@Composable
fun SectionTitle(text: String) {
  Text(text = text, style = MaterialTheme.typography.titleMedium)
}

@Composable
fun OrganizationSelector(
  organizations: Loadable<List<Organization>>,
  selectedClerkOrgId: String?,
  onSelected: (String) -> Unit,
) {
  when {
    organizations.loading && organizations.data == null -> CircularProgressIndicator()
    organizations.data.isNullOrEmpty() ->
      Text(
        stringResource(R.string.no_organizations),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    else ->
      LazyRow(
        contentPadding = PaddingValues(vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        items(organizations.data.orEmpty(), key = Organization::clerkOrgId) { organization ->
          FilterChip(
            selected = selectedClerkOrgId == organization.clerkOrgId,
            onClick = { onSelected(organization.clerkOrgId) },
            label = { Text(organization.name) },
          )
        }
      }
  }
}

@Composable
fun StatusMessage(loadable: Loadable<*>) {
  when {
    loadable.loading && loadable.data == null ->
      Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
      ) {
        CircularProgressIndicator()
      }
    loadable.error != null && loadable.data == null ->
      TrackerCard(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) {
        Text(
          text = stringResource(R.string.unavailable),
          color = MaterialTheme.colorScheme.error,
          fontWeight = FontWeight.SemiBold,
        )
        Text(
          text = loadable.error,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          style = MaterialTheme.typography.bodyMedium,
        )
      }
    loadable.stale ->
      Surface(
        color = MaterialTheme.colorScheme.error.copy(alpha = 0.10f),
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
      ) {
        Text(
          text = stringResource(R.string.stale_data),
          modifier = Modifier.padding(12.dp),
          style = MaterialTheme.typography.bodyMedium,
        )
      }
  }
}

@Composable
fun EmptyState(@StringRes title: Int, @StringRes body: Int? = null) {
  TrackerCard(Modifier.fillMaxWidth()) {
    Text(stringResource(title), fontWeight = FontWeight.SemiBold)
    body?.let {
      Text(
        stringResource(it),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodyMedium,
      )
    }
  }
}

fun formatTokens(value: Long, locale: Locale): String =
  when {
    value >= 1_000_000 -> "${formatScaled(value / 1_000_000.0, locale)}M"
    value >= 1_000 -> "${formatScaled(value / 1_000.0, locale)}K"
    else -> NumberFormat.getIntegerInstance(locale).format(value)
  }

private fun formatScaled(value: Double, locale: Locale): String =
  NumberFormat.getNumberInstance(locale)
    .apply {
      isGroupingUsed = false
      minimumFractionDigits = 0
      maximumFractionDigits = if (value >= 100 || value % 1.0 == 0.0) 0 else if (value >= 10) 1 else 2
    }
    .format(value)

fun formatUsd(value: Double, locale: Locale): String =
  NumberFormat.getCurrencyInstance(locale)
    .apply { currency = Currency.getInstance("USD") }
    .format(value)

fun formatPercent(value: Double, locale: Locale): String =
  NumberFormat.getPercentInstance(locale).apply { maximumFractionDigits = 0 }.format(value)

fun formatDate(
  value: Long,
  zoneId: ZoneId = ZoneId.systemDefault(),
  locale: Locale,
): String =
  DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
    .withLocale(locale)
    .format(Instant.ofEpochMilli(value).atZone(zoneId))

fun formatDate(value: LocalDate, locale: Locale): String =
  DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).format(value)

@Composable
fun currentAppLocale(): Locale {
  val locales = LocalConfiguration.current.locales
  return locales[0]
}

val MetricFont = FontFamily.Monospace
