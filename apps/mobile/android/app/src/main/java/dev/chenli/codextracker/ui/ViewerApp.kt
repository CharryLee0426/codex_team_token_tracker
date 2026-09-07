package dev.chenli.codextracker.ui

import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.clerk.ui.auth.AuthMode
import com.clerk.ui.auth.AuthView
import dev.chenli.codextracker.R
import dev.chenli.codextracker.data.ViewerAuthState
import dev.chenli.codextracker.data.ViewerRepository
import dev.chenli.codextracker.domain.UsageRange
import dev.chenli.codextracker.domain.UsageScope
import dev.chenli.codextracker.ui.theme.TrackerTheme
import dev.chenli.codextracker.ui.theme.TrackerType
import dev.chenli.codextracker.ui.theme.weight
import java.time.LocalDate

internal enum class AppTab(val key: String, @StringRes val label: Int, val icon: ImageVector) {
  Personal("personal", R.string.tab_personal, TrackerIcons.personal),
  Team("team", R.string.tab_team, TrackerIcons.team),
  Members("members", R.string.tab_members, TrackerIcons.members),
  Devices("devices", R.string.tab_devices, TrackerIcons.devices),
  Settings("settings", R.string.tab_settings, TrackerIcons.settings),
}

/** Everything a screen can ask the view model or the activity to do. */
internal class ShellActions(
  val onRangeSelected: (UsageRange) -> Unit,
  val onCustomRangeApplied: (LocalDate, LocalDate) -> Unit,
  val onOrganizationSelected: (String) -> Unit,
  val onThemeSelected: (ThemeMode) -> Unit,
  val onLanguageSelected: (LanguageMode) -> Unit,
  val onSignOut: () -> Unit,
  val onRetry: () -> Unit,
  val onRefresh: () -> Unit,
  val onSimulateConnection: () -> Unit,
)

@Composable
fun ViewerApp(
  repository: ViewerRepository,
  preferences: ViewerPreferences,
  rangeStore: RangeStore,
  onThemeSelected: (ThemeMode) -> Unit,
  onLanguageSelected: (LanguageMode) -> Unit,
) {
  val colors = TrackerTheme.colors
  val authState by repository.authState.collectAsStateWithLifecycle()
  Box(modifier = Modifier.fillMaxSize().background(colors.background)) {
    when (val currentAuth = authState) {
      ViewerAuthState.Loading ->
        LoadingState(
          text = stringResource(R.string.state_initializing),
          modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing),
          testTag = "loading_screen",
        )
      ViewerAuthState.SignedOut -> SignInFlow()
      is ViewerAuthState.SignedIn -> {
        val viewModel: MainViewModel =
          viewModel(factory = MainViewModel.factory(repository, rangeStore = rangeStore))
        DisposableEffect(viewModel, currentAuth.principalId) {
          viewModel.beginSession(currentAuth.principalId)
          onDispose { viewModel.endSession(currentAuth.principalId) }
        }
        val state by viewModel.uiState.collectAsStateWithLifecycle()
        val context = LocalContext.current
        val actions =
          remember(viewModel, context, onThemeSelected, onLanguageSelected) {
            ShellActions(
              onRangeSelected = viewModel::selectRange,
              onCustomRangeApplied = viewModel::applyCustomRange,
              onOrganizationSelected = viewModel::selectOrganization,
              onThemeSelected = onThemeSelected,
              onLanguageSelected = onLanguageSelected,
              onSignOut = { viewModel.signOut(context) },
              onRetry = viewModel::retry,
              onRefresh = viewModel::refresh,
              onSimulateConnection = viewModel::simulateConnectionChange,
            )
          }
        MainShell(
          state = state,
          isDemo = repository.isDemo,
          preferences = preferences,
          actions = actions,
        )
      }
    }
  }
}

@Composable
private fun SignInFlow() {
  var showAuth by rememberSaveable { mutableStateOf(false) }
  if (showAuth) {
    BackHandler { showAuth = false }
    AuthView(
      modifier = Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing),
      mode = AuthMode.SignIn,
      isDismissible = true,
      onDismiss = { showAuth = false },
    )
  } else {
    SignInScreen(onSignIn = { showAuth = true })
  }
}

@Composable
private fun SignInScreen(onSignIn: () -> Unit) {
  val colors = TrackerTheme.colors
  Column(
    modifier =
      Modifier
        .fillMaxSize()
        .windowInsetsPadding(WindowInsets.safeDrawing)
        .padding(32.dp)
        .testTag("sign_in_screen"),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterVertically),
  ) {
    Icon(
      TrackerIcons.signIn,
      contentDescription = null,
      tint = colors.accent,
      modifier = Modifier.size(44.dp),
    )
    Text(
      stringResource(R.string.state_signed_out),
      style = TrackerType.title2,
      color = colors.text,
      textAlign = TextAlign.Center,
    )
    Text(
      stringResource(R.string.state_sign_in_body),
      style = TrackerType.subheadline,
      color = colors.secondaryText,
      textAlign = TextAlign.Center,
    )
    ProminentButton(stringResource(R.string.state_sign_in), onClick = onSignIn, testTag = "sign_in")
  }
}

@Composable
private fun MainShell(
  state: MainUiState,
  isDemo: Boolean,
  preferences: ViewerPreferences,
  actions: ShellActions,
) {
  var selectedTab by rememberSaveable { mutableStateOf(AppTab.Personal) }
  val colors = TrackerTheme.colors
  val containerWidth = LocalWindowInfo.current.containerSize.width
  val wide = with(LocalDensity.current) { containerWidth.toDp() } >= 600.dp
  if (wide) {
    Row(Modifier.fillMaxSize()) {
      Sidebar(
        selected = selectedTab,
        onSelect = { selectedTab = it },
        modifier =
          Modifier.windowInsetsPadding(
            WindowInsets.safeDrawing.only(
              WindowInsetsSides.Top + WindowInsetsSides.Start + WindowInsetsSides.Bottom
            )
          ),
      )
      VerticalDivider(color = colors.border, thickness = CardBorderWidth)
      Box(
        Modifier
          .weight(1f)
          .fillMaxHeight()
          .windowInsetsPadding(
            WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.End)
          )
      ) {
        TabContent(
          tab = selectedTab,
          state = state,
          isDemo = isDemo,
          preferences = preferences,
          contentPadding =
            PaddingValues(
              bottom = WindowInsets.safeDrawing.asPaddingValues().calculateBottomPadding()
            ),
          actions = actions,
        )
      }
    }
  } else {
    Scaffold(
      containerColor = colors.background,
      contentWindowInsets = WindowInsets(0),
      bottomBar = { CompactTabBar(selected = selectedTab, onSelect = { selectedTab = it }) },
    ) { padding ->
      Box(
        Modifier
          .fillMaxSize()
          .windowInsetsPadding(
            WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)
          )
      ) {
        TabContent(
          tab = selectedTab,
          state = state,
          isDemo = isDemo,
          preferences = preferences,
          contentPadding = padding,
          actions = actions,
        )
      }
    }
  }
}

@Composable
private fun TabContent(
  tab: AppTab,
  state: MainUiState,
  isDemo: Boolean,
  preferences: ViewerPreferences,
  contentPadding: PaddingValues,
  actions: ShellActions,
) {
  when (tab) {
    AppTab.Personal ->
      OverviewScreen(UsageScope.Personal, state, isDemo, contentPadding, actions)
    AppTab.Team -> OverviewScreen(UsageScope.Team, state, isDemo, contentPadding, actions)
    AppTab.Members -> MembersScreen(state, isDemo, contentPadding, actions)
    AppTab.Devices -> DevicesScreen(state, isDemo, contentPadding, actions)
    AppTab.Settings -> SettingsScreen(state, isDemo, preferences, contentPadding, actions)
  }
}

/** The iOS compact tab bar: 62pt tall, icon over caption label, accent for the selection. */
@Composable
private fun CompactTabBar(selected: AppTab, onSelect: (AppTab) -> Unit) {
  val colors = TrackerTheme.colors
  Column(Modifier.fillMaxWidth().background(colors.card.copy(alpha = 0.92f))) {
    HorizontalDivider(color = colors.border, thickness = CardBorderWidth)
    Row(
      modifier =
        Modifier
          .fillMaxWidth()
          .windowInsetsPadding(
            WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal)
          )
          .heightIn(min = 62.dp)
          .selectableGroup()
    ) {
      AppTab.entries.forEach { tab ->
        val isSelected = tab == selected
        val tint = if (isSelected) colors.accent else colors.muted
        Column(
          modifier =
            Modifier
              .weight(1f)
              .heightIn(min = 62.dp)
              .selectable(
                selected = isSelected,
                role = Role.Tab,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = { onSelect(tab) },
              )
              .testTag("tab_${tab.key}"),
          horizontalAlignment = Alignment.CenterHorizontally,
          verticalArrangement = Arrangement.Center,
        ) {
          Icon(tab.icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
          Spacer(Modifier.height(4.dp))
          Text(
            text = stringResource(tab.label),
            style =
              TrackerType.caption2.weight(
                if (isSelected) FontWeight.SemiBold else FontWeight.Normal
              ),
            color = tint,
            maxLines = 1,
          )
        }
      }
    }
  }
}

/** The iPad-style sidebar list used on wide layouts. */
@Composable
private fun Sidebar(selected: AppTab, onSelect: (AppTab) -> Unit, modifier: Modifier = Modifier) {
  val colors = TrackerTheme.colors
  Column(
    modifier = modifier.width(300.dp).fillMaxHeight().background(colors.card).padding(16.dp),
    verticalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    Text(
      stringResource(R.string.app_name),
      style = TrackerType.largeTitle,
      color = colors.text,
      modifier = Modifier.padding(bottom = 12.dp),
    )
    AppTab.entries.forEach { tab ->
      val isSelected = tab == selected
      val tint = if (isSelected) colors.accent else colors.text
      Row(
        modifier =
          Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (isSelected) colors.accent.copy(alpha = 0.10f) else colors.card)
            .selectable(
              selected = isSelected,
              role = Role.Tab,
              interactionSource = remember { MutableInteractionSource() },
              indication = null,
              onClick = { onSelect(tab) },
            )
            .testTag("tab_${tab.key}")
            .padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Icon(tab.icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
        Text(stringResource(tab.label), style = TrackerType.body, color = tint)
      }
    }
  }
}
