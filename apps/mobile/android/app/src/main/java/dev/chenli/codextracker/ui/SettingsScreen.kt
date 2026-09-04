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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.chenli.codextracker.BuildConfig
import dev.chenli.codextracker.R

@Composable
fun SettingsScreen(
  state: MainUiState,
  isDemo: Boolean,
  preferences: ViewerPreferences,
  contentPadding: PaddingValues,
  onThemeSelected: (ThemeMode) -> Unit,
  onLanguageSelected: (LanguageMode) -> Unit,
  onSignOut: (android.content.Context) -> Unit,
) {
  val context = LocalContext.current
  LazyColumn(
    modifier = Modifier.fillMaxSize().testTag("settings_screen"),
    contentPadding =
      PaddingValues(
        start = 16.dp,
        top = 16.dp,
        end = 16.dp,
        bottom = contentPadding.calculateBottomPadding() + 18.dp,
      ),
    verticalArrangement = Arrangement.spacedBy(14.dp),
  ) {
    item { ScreenTitle(R.string.settings, R.string.viewer_only) }
    item {
      ChoiceCard(
        title = stringResource(R.string.appearance),
        choices =
          listOf(
            ThemeMode.System to R.string.theme_system,
            ThemeMode.Light to R.string.theme_light,
            ThemeMode.Dark to R.string.theme_dark,
          ),
        selected = preferences.theme,
        tag = { "theme_${it.name.lowercase()}" },
        onSelected = onThemeSelected,
      )
    }
    item {
      ChoiceCard(
        title = stringResource(R.string.language),
        choices =
          listOf(
            LanguageMode.System to R.string.language_system,
            LanguageMode.English to R.string.language_english,
            LanguageMode.Chinese to R.string.language_chinese,
          ),
        selected = preferences.language,
        tag = { "language_${it.name.lowercase()}" },
        onSelected = onLanguageSelected,
      )
    }
    item {
      TrackerCard(Modifier.fillMaxWidth()) {
        SectionTitle(stringResource(R.string.account))
        Spacer(Modifier.height(8.dp))
        val account = state.account.data
        if (isDemo) {
          Text(stringResource(R.string.demo_account), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
          Text(
            account?.name ?: account?.email ?: stringResource(R.string.unknown),
            fontWeight = FontWeight.Medium,
          )
          account?.email?.let {
            Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          OutlinedButton(onClick = { onSignOut(context) }, modifier = Modifier.padding(top = 10.dp)) {
            Text(stringResource(R.string.sign_out))
          }
        }
      }
    }
    item { InformationCard(R.string.privacy, R.string.privacy_summary) }
    item {
      TrackerCard(Modifier.fillMaxWidth()) {
        SectionTitle(stringResource(R.string.about))
        Spacer(Modifier.height(8.dp))
        Text(
          stringResource(R.string.about_summary),
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
          stringResource(R.string.version, BuildConfig.VERSION_NAME),
          modifier = Modifier.padding(top = 8.dp),
          fontFamily = MetricFont,
          style = MaterialTheme.typography.bodyMedium,
        )
      }
    }
  }
}

@Composable
private fun <T> ChoiceCard(
  title: String,
  choices: List<Pair<T, Int>>,
  selected: T,
  tag: (T) -> String,
  onSelected: (T) -> Unit,
) {
  TrackerCard(Modifier.fillMaxWidth()) {
    SectionTitle(title)
    LazyRow(
      modifier = Modifier.padding(top = 8.dp),
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      items(choices, key = { it.first.toString() }) { (value, label) ->
        FilterChip(
          selected = selected == value,
          onClick = { onSelected(value) },
          label = { Text(stringResource(label)) },
          modifier = Modifier.testTag(tag(value)),
        )
      }
    }
  }
}

@Composable
private fun InformationCard(title: Int, body: Int) {
  TrackerCard(Modifier.fillMaxWidth()) {
    SectionTitle(stringResource(title))
    Spacer(Modifier.height(8.dp))
    Text(stringResource(body), color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}
