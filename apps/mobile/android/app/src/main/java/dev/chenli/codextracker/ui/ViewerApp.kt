package dev.chenli.codextracker.ui

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.clerk.ui.auth.AuthView
import dev.chenli.codextracker.R
import dev.chenli.codextracker.data.ViewerAuthState
import dev.chenli.codextracker.data.ViewerRepository

private enum class AppTab(@StringRes val label: Int, val symbol: String) {
  Personal(R.string.personal, "●"),
  Team(R.string.team, "◆"),
  Members(R.string.members, "◌"),
  Devices(R.string.devices, "▣"),
  Settings(R.string.settings, "⌁"),
}

@Composable
fun ViewerApp(
  repository: ViewerRepository,
  preferences: ViewerPreferences,
  onThemeSelected: (ThemeMode) -> Unit,
  onLanguageSelected: (LanguageMode) -> Unit,
) {
  val authState by repository.authState.collectAsStateWithLifecycle()
  Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
    when (val currentAuth = authState) {
      ViewerAuthState.Loading -> LoadingView()
      ViewerAuthState.SignedOut ->
        AuthView(
          modifier =
            Modifier
              .fillMaxSize()
              .windowInsetsPadding(WindowInsets.safeDrawing),
        )
      is ViewerAuthState.SignedIn -> {
        val viewModel: MainViewModel = viewModel(factory = MainViewModel.factory(repository))
        DisposableEffect(viewModel, currentAuth.principalId) {
          viewModel.beginSession(currentAuth.principalId)
          onDispose { viewModel.endSession(currentAuth.principalId) }
        }
        val state by viewModel.uiState.collectAsStateWithLifecycle()
        ViewerScaffold(
          state = state,
          isDemo = repository.isDemo,
          preferences = preferences,
          onRangeSelected = viewModel::selectRange,
          onOrganizationSelected = viewModel::selectOrganization,
          onThemeSelected = onThemeSelected,
          onLanguageSelected = onLanguageSelected,
          onSignOut = viewModel::signOut,
        )
      }
    }
  }
}

@Composable
private fun ViewerScaffold(
  state: MainUiState,
  isDemo: Boolean,
  preferences: ViewerPreferences,
  onRangeSelected: (dev.chenli.codextracker.domain.UsageRange) -> Unit,
  onOrganizationSelected: (String) -> Unit,
  onThemeSelected: (ThemeMode) -> Unit,
  onLanguageSelected: (LanguageMode) -> Unit,
  onSignOut: (android.content.Context) -> Unit,
) {
  var selectedTab by rememberSaveable { mutableStateOf(AppTab.Personal) }
  Scaffold(
    contentWindowInsets = WindowInsets(0),
    bottomBar = {
      NavigationBar(
        modifier =
          Modifier.windowInsetsPadding(
            WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal),
          ).heightIn(min = 62.dp),
        windowInsets = WindowInsets(0),
      ) {
        AppTab.entries.forEach { tab ->
          val tag = "tab_${tab.name.lowercase()}"
          NavigationBarItem(
            selected = selectedTab == tab,
            onClick = { selectedTab = tab },
            icon = { Text(tab.symbol) },
            label = { Text(stringResource(tab.label)) },
            modifier = Modifier.testTag(tag),
          )
        }
      }
    },
  ) { contentPadding ->
    Column(
      modifier =
        Modifier
          .fillMaxSize()
          .windowInsetsPadding(
            WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal),
          ),
    ) {
      if (isDemo) DemoBanner()
      when (selectedTab) {
        AppTab.Personal ->
          UsageScreen(
            scope = dev.chenli.codextracker.domain.UsageScope.Personal,
            state = state,
            contentPadding = contentPadding,
            onRangeSelected = onRangeSelected,
            onOrganizationSelected = onOrganizationSelected,
          )
        AppTab.Team ->
          UsageScreen(
            scope = dev.chenli.codextracker.domain.UsageScope.Team,
            state = state,
            contentPadding = contentPadding,
            onRangeSelected = onRangeSelected,
            onOrganizationSelected = onOrganizationSelected,
          )
        AppTab.Members -> MembersScreen(state, contentPadding, onOrganizationSelected)
        AppTab.Devices -> DevicesScreen(state.devices, contentPadding)
        AppTab.Settings ->
          SettingsScreen(
            state = state,
            isDemo = isDemo,
            preferences = preferences,
            contentPadding = contentPadding,
            onThemeSelected = onThemeSelected,
            onLanguageSelected = onLanguageSelected,
            onSignOut = onSignOut,
          )
      }
    }
  }
}

@Composable
private fun LoadingView() {
  Column(
    modifier =
      Modifier
        .fillMaxSize()
        .windowInsetsPadding(WindowInsets.safeDrawing)
        .testTag("loading_screen"),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center,
  ) {
    CircularProgressIndicator()
    Text(stringResource(R.string.loading))
  }
}
