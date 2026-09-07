package dev.chenli.codextracker.ui

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ListAlt
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.automirrored.outlined.ShowChart
import androidx.compose.material.icons.filled.Assessment
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Diversity3
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.Assessment
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Bedtime
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Contrast
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.DesktopWindows
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.GppMaybe
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Lan
import androidx.compose.material.icons.outlined.LaptopMac
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material.icons.outlined.PauseCircleOutline
import androidx.compose.material.icons.outlined.PhonelinkOff
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.Translate
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.chenli.codextracker.R
import dev.chenli.codextracker.domain.ConnectionState
import dev.chenli.codextracker.ui.theme.TrackerTheme
import dev.chenli.codextracker.ui.theme.TrackerType
import dev.chenli.codextracker.ui.theme.monospaced
import dev.chenli.codextracker.ui.theme.weight
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

val CardCornerRadius = 14.dp
val CardBorderWidth = 0.75.dp

/** Material Symbols standing in for the SF Symbols the iOS viewer uses, one per meaning. */
object TrackerIcons {
  val personal: ImageVector = Icons.AutoMirrored.Outlined.ShowChart
  val team: ImageVector = Icons.Filled.Groups
  val members: ImageVector = Icons.Filled.People
  val devices: ImageVector = Icons.Filled.Devices
  val settings: ImageVector = Icons.Filled.Settings
  val calendar: ImageVector = Icons.Outlined.CalendarToday
  val check: ImageVector = Icons.Filled.Check
  val checkCircle: ImageVector = Icons.Filled.CheckCircle
  val chevron: ImageVector = Icons.Filled.ChevronRight
  val wifiOff: ImageVector = Icons.Outlined.WifiOff
  val sync: ImageVector = Icons.Outlined.Sync
  val emptyUsage: ImageVector = Icons.Outlined.BarChart
  val dataList: ImageVector = Icons.AutoMirrored.Outlined.ListAlt
  val laptop: ImageVector = Icons.Outlined.LaptopMac
  val desktop: ImageVector = Icons.Outlined.DesktopWindows
  val terminal: ImageVector = Icons.Outlined.Terminal
  val idle: ImageVector = Icons.Outlined.PauseCircleOutline
  val network: ImageVector = Icons.Outlined.Lan
  val globe: ImageVector = Icons.Outlined.Public
  val clock: ImageVector = Icons.Outlined.Schedule
  val added: ImageVector = Icons.Outlined.EventAvailable
  val joined: ImageVector = Icons.Outlined.CalendarMonth
  val emptyDevices: ImageVector = Icons.Outlined.PhonelinkOff
  val offline: ImageVector = Icons.Outlined.Bedtime
  val emptyMembers: ImageVector = Icons.Outlined.Groups
  val organizationRequired: ImageVector = Icons.Filled.Diversity3
  val memberDevices: ImageVector = Icons.Outlined.Devices
  val warning: ImageVector = Icons.Outlined.Warning
  val organization: ImageVector = Icons.Outlined.Business
  val appearanceSystem: ImageVector = Icons.Outlined.Contrast
  val appearanceLight: ImageVector = Icons.Outlined.LightMode
  val appearanceDark: ImageVector = Icons.Outlined.DarkMode
  val language: ImageVector = Icons.Outlined.Translate
  val signOut: ImageVector = Icons.AutoMirrored.Outlined.Logout
  val shieldWarning: ImageVector = Icons.Outlined.GppMaybe
  val about: ImageVector = Icons.Outlined.Assessment
  val signIn: ImageVector = Icons.Filled.Assessment
}

@Composable
fun currentAppLocale(): Locale = LocalConfiguration.current.locales[0]

@Composable
fun DashboardCard(
  modifier: Modifier = Modifier,
  title: String? = null,
  content: @Composable ColumnScope.() -> Unit,
) {
  val colors = TrackerTheme.colors
  val shape = RoundedCornerShape(CardCornerRadius)
  Column(
    modifier =
      modifier
        .fillMaxWidth()
        .clip(shape)
        .background(colors.card)
        .border(CardBorderWidth, colors.border, shape)
        .padding(16.dp),
    verticalArrangement = Arrangement.spacedBy(14.dp),
  ) {
    if (title != null) Text(title, style = TrackerType.headline, color = colors.text)
    content()
  }
}

@Composable
fun CardDivider() {
  HorizontalDivider(color = TrackerTheme.colors.border, thickness = CardBorderWidth)
}

@Composable
fun ScreenHeader(
  eyebrow: String,
  title: String,
  subtitle: String,
  demo: Boolean,
  modifier: Modifier = Modifier,
  titleTag: String? = null,
) {
  val colors = TrackerTheme.colors
  Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Row(
      horizontalArrangement = Arrangement.spacedBy(8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Text(
        text = eyebrow.uppercase(),
        style = TrackerType.caption2.monospaced().copy(letterSpacing = 1.8.sp),
        color = colors.muted,
      )
      if (demo) DemoBadge()
    }
    Text(
      text = title,
      style = TrackerType.largeTitle,
      color = colors.text,
      modifier =
        Modifier.semantics { heading() }.then(titleTag?.let { Modifier.testTag(it) } ?: Modifier),
    )
    Text(text = subtitle, style = TrackerType.subheadline, color = colors.secondaryText)
  }
}

@Composable
fun DemoBadge() {
  val colors = TrackerTheme.colors
  Text(
    text = stringResource(R.string.demo_badge),
    style = TrackerType.caption2.monospaced().weight(FontWeight.Bold),
    color = colors.accent,
    modifier =
      Modifier
        .testTag("demo_badge")
        .background(colors.accent.copy(alpha = 0.12f), CircleShape)
        .padding(horizontal = 8.dp, vertical = 4.dp),
  )
}

/** The iOS `StatusBanner`: shown only while the connection is degraded or data is being refreshed. */
@Composable
fun StatusBanner(state: ConnectionState, stale: Boolean, modifier: Modifier = Modifier) {
  if (state == ConnectionState.Live && !stale) return
  val colors = TrackerTheme.colors
  val offline = state == ConnectionState.Offline
  val text =
    when (state) {
      ConnectionState.Offline -> R.string.connection_offline
      ConnectionState.Reconnecting -> R.string.connection_reconnecting
      ConnectionState.Live -> R.string.state_stale
    }
  val tag =
    when (state) {
      ConnectionState.Offline -> "connection_offline"
      ConnectionState.Reconnecting -> "connection_reconnecting"
      ConnectionState.Live -> "state_stale"
    }
  val tint = if (offline) colors.warning else colors.accent
  Row(
    modifier =
      modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(10.dp))
        .background(colors.cardSecondary)
        .padding(12.dp)
        .semantics { liveRegion = LiveRegionMode.Polite }
        .testTag(tag),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(
      imageVector = if (offline) TrackerIcons.wifiOff else TrackerIcons.sync,
      contentDescription = null,
      tint = tint,
      modifier = Modifier.size(18.dp),
    )
    Text(stringResource(text), style = TrackerType.footnote.weight(FontWeight.Medium), color = tint)
  }
}

fun initials(name: String): String =
  name.split(" ").filter(String::isNotBlank).take(2).mapNotNull { it.firstOrNull() }.joinToString("")
    .uppercase()

@Composable
fun InitialsAvatar(name: String, modifier: Modifier = Modifier) {
  val colors = TrackerTheme.colors
  Box(
    modifier = modifier.size(42.dp).background(colors.accent.copy(alpha = 0.13f), CircleShape),
    contentAlignment = Alignment.Center,
  ) {
    Text(initials(name), style = TrackerType.subheadline.weight(FontWeight.Bold), color = colors.accent)
  }
}

/** Loads a Clerk avatar over HTTPS, falling back to initials exactly like the iOS `AsyncImage`. */
@Composable
fun RemoteAvatar(imageUrl: String?, name: String, modifier: Modifier = Modifier) {
  val bitmap by
    produceState<ImageBitmap?>(initialValue = imageUrl?.let(AvatarCache::get), imageUrl) {
      if (value == null && !imageUrl.isNullOrBlank()) value = AvatarCache.load(imageUrl)
    }
  val image = bitmap
  if (image != null) {
    Image(
      bitmap = image,
      contentDescription = null,
      modifier = modifier.size(42.dp).clip(CircleShape),
      contentScale = ContentScale.Crop,
    )
  } else {
    InitialsAvatar(name, modifier)
  }
}

object AvatarCache {
  private val cache = LruCache<String, ImageBitmap>(32)

  fun get(url: String): ImageBitmap? = cache.get(url)

  suspend fun load(url: String): ImageBitmap? =
    withContext(Dispatchers.IO) {
      runCatching {
          val parsed = URL(url)
          require(parsed.protocol == "https") { "Avatars are loaded over HTTPS only" }
          val connection = parsed.openConnection() as HttpURLConnection
          connection.connectTimeout = 8_000
          connection.readTimeout = 8_000
          connection.instanceFollowRedirects = true
          try {
            connection.inputStream.use(BitmapFactory::decodeStream)?.asImageBitmap()
          } finally {
            connection.disconnect()
          }
        }
        .getOrNull()
        ?.also { cache.put(url, it) }
    }
}

@Composable
fun SelectionRow(
  label: String,
  icon: ImageVector,
  selected: Boolean,
  testTag: String,
  onClick: () -> Unit,
) {
  val colors = TrackerTheme.colors
  Row(
    modifier =
      Modifier
        .fillMaxWidth()
        .heightIn(min = 44.dp)
        .selectable(
          selected = selected,
          role = Role.RadioButton,
          interactionSource = remember { MutableInteractionSource() },
          indication = null,
          onClick = onClick,
        )
        .testTag(testTag),
    horizontalArrangement = Arrangement.spacedBy(12.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(icon, contentDescription = null, tint = colors.accent, modifier = Modifier.width(22.dp))
    Text(label, style = TrackerType.body, color = colors.text, modifier = Modifier.weight(1f))
    if (selected) {
      Icon(
        TrackerIcons.checkCircle,
        contentDescription = stringResource(R.string.a11y_selected),
        tint = colors.accent,
      )
    }
  }
}

/** SwiftUI's `.borderedProminent` button tinted with the accent colour. */
@Composable
fun ProminentButton(
  text: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  testTag: String? = null,
) {
  val colors = TrackerTheme.colors
  Button(
    onClick = onClick,
    modifier = modifier.heightIn(min = 44.dp).then(testTag?.let { Modifier.testTag(it) } ?: Modifier),
    shape = RoundedCornerShape(10.dp),
    colors =
      ButtonDefaults.buttonColors(
        containerColor = colors.accent,
        contentColor = if (colors.isDark) Color(0xFF041019) else Color.White,
      ),
    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
  ) {
    Text(text, style = TrackerType.body.weight(FontWeight.SemiBold))
  }
}

/** SwiftUI's `.bordered` button: tinted translucent background with tinted content. */
@Composable
fun TintedButton(
  text: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  tint: Color = TrackerTheme.colors.accent,
  icon: ImageVector? = null,
  testTag: String? = null,
) {
  Button(
    onClick = onClick,
    modifier = modifier.heightIn(min = 44.dp).then(testTag?.let { Modifier.testTag(it) } ?: Modifier),
    shape = RoundedCornerShape(10.dp),
    colors =
      ButtonDefaults.buttonColors(containerColor = tint.copy(alpha = 0.12f), contentColor = tint),
    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
  ) {
    if (icon != null) {
      Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
      Spacer(Modifier.width(6.dp))
    }
    Text(text, style = TrackerType.body.weight(FontWeight.Medium))
  }
}

/** The iOS `ContentUnavailableView` layout: large secondary icon, bold title, description, actions. */
@Composable
fun ContentUnavailable(
  title: String,
  icon: ImageVector,
  modifier: Modifier = Modifier,
  description: String? = null,
  actions: @Composable ColumnScope.() -> Unit = {},
) {
  val colors = TrackerTheme.colors
  Column(
    modifier = modifier.fillMaxSize().padding(28.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center,
  ) {
    Icon(icon, contentDescription = null, tint = colors.secondaryText, modifier = Modifier.size(48.dp))
    Spacer(Modifier.height(12.dp))
    Text(title, style = TrackerType.title2, color = colors.text, textAlign = TextAlign.Center)
    if (description != null) {
      Spacer(Modifier.height(6.dp))
      Text(
        description,
        style = TrackerType.body,
        color = colors.secondaryText,
        textAlign = TextAlign.Center,
      )
    }
    Spacer(Modifier.height(16.dp))
    actions()
  }
}

@Composable
fun LoadingState(text: String, modifier: Modifier = Modifier, testTag: String? = null) {
  val colors = TrackerTheme.colors
  Column(
    modifier =
      modifier
        .fillMaxSize()
        .then(testTag?.let { Modifier.testTag(it) } ?: Modifier)
        .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center,
  ) {
    CircularProgressIndicator(
      modifier = Modifier.size(22.dp),
      color = colors.secondaryText,
      strokeWidth = 2.5.dp,
    )
    Spacer(Modifier.height(14.dp))
    Text(text, style = TrackerType.body, color = colors.secondaryText)
  }
}

@Composable
fun EmptyCard(text: String, icon: ImageVector, minHeight: Dp = 100.dp) {
  val colors = TrackerTheme.colors
  DashboardCard {
    Row(
      modifier = Modifier.fillMaxWidth().heightIn(min = minHeight),
      horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(icon, contentDescription = null, tint = colors.secondaryText, modifier = Modifier.size(20.dp))
      Text(text, style = TrackerType.subheadline, color = colors.secondaryText)
    }
  }
}

@Composable
fun MetadataLabel(text: String, icon: ImageVector) {
  val colors = TrackerTheme.colors
  Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
    Icon(icon, contentDescription = null, tint = colors.secondaryText, modifier = Modifier.size(15.dp))
    Text(text, style = TrackerType.caption, color = colors.secondaryText)
  }
}

@Composable
fun Pill(text: String) {
  val colors = TrackerTheme.colors
  Text(
    text = text,
    style = TrackerType.caption2.weight(FontWeight.Medium),
    color = colors.secondaryText,
    maxLines = 1,
    overflow = TextOverflow.Ellipsis,
    modifier =
      Modifier
        .background(colors.cardSecondary, CircleShape)
        .padding(horizontal = 8.dp, vertical = 4.dp),
  )
}

@Composable
fun LiveLine(text: String) {
  val colors = TrackerTheme.colors
  Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
    Box(Modifier.size(7.dp).background(colors.live, CircleShape))
    Text(
      text,
      style = TrackerType.subheadline.copy(fontFeatureSettings = "tnum"),
      color = colors.text,
    )
  }
}

@Composable
fun IdleLine(text: String, icon: ImageVector) {
  val colors = TrackerTheme.colors
  Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
    Icon(icon, contentDescription = null, tint = colors.muted, modifier = Modifier.size(18.dp))
    Text(text, style = TrackerType.subheadline, color = colors.muted)
  }
}

/**
 * SwiftUI's `ViewThatFits(in: .horizontal)` for metadata rows: lay the children out in one row
 * when their natural widths fit, otherwise stack them vertically.
 */
@Composable
fun RowOrColumn(
  modifier: Modifier = Modifier,
  horizontalSpacing: Dp = 14.dp,
  verticalSpacing: Dp = 8.dp,
  content: @Composable () -> Unit,
) {
  Layout(content = content, modifier = modifier) { measurables, constraints ->
    val horizontalGap = horizontalSpacing.roundToPx()
    val verticalGap = verticalSpacing.roundToPx()
    val loose = constraints.copy(minWidth = 0, minHeight = 0)
    val naturalWidth =
      measurables.sumOf { it.maxIntrinsicWidth(constraints.maxHeight) } +
        horizontalGap * (measurables.size - 1).coerceAtLeast(0)
    val placeables = measurables.map { it.measure(loose) }
    val width = if (constraints.hasBoundedWidth) constraints.maxWidth else naturalWidth
    if (naturalWidth <= constraints.maxWidth) {
      val height = placeables.maxOfOrNull { it.height } ?: 0
      layout(width, height) {
        var x = 0
        placeables.forEach { placeable ->
          placeable.placeRelative(x, (height - placeable.height) / 2)
          x += placeable.width + horizontalGap
        }
      }
    } else {
      val height =
        placeables.sumOf { it.height } + verticalGap * (placeables.size - 1).coerceAtLeast(0)
      layout(width, height) {
        var y = 0
        placeables.forEach { placeable ->
          placeable.placeRelative(0, y)
          y += placeable.height + verticalGap
        }
      }
    }
  }
}
