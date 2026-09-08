package dev.chenli.codextracker.ui

import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.core.content.FileProvider
import dev.chenli.codextracker.R
import dev.chenli.codextracker.domain.ConnectionState
import dev.chenli.codextracker.domain.RangePlanner
import dev.chenli.codextracker.domain.UsageScope
import dev.chenli.codextracker.domain.UsageSummary
import java.io.File
import java.io.OutputStream
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException

/** Only aggregate, formatted values cross the image-export boundary. */
internal data class UsageShareContent(
  val title: String,
  val dates: String,
  val total: String,
  val totalLabel: String,
  val metrics: List<Pair<String, String>>,
  val capturedAt: String,
  val badges: List<String>,
) {
  val accessibleText: String
    get() = (listOf(title, dates, "$total $totalLabel") +
      metrics.map { (label, value) -> "$label: $value" } + badges + capturedAt).joinToString(". ")
}

@Composable
internal fun UsageShareDialog(
  state: MainUiState,
  scope: UsageScope,
  summary: UsageSummary,
  isDemo: Boolean,
  onDismiss: () -> Unit,
) {
  val context = LocalContext.current
  val locale = currentAppLocale()
  val loadable = if (scope == UsageScope.Personal) state.personal else state.team
  val bounds = loadable.data?.bounds ?: RangePlanner.bounds(state.range, state.now, ZoneId.systemDefault(), state.customRange)
  val content = UsageShareContent(
    title = stringResource(if (scope == UsageScope.Personal) R.string.personal_title else R.string.team_title),
    dates = "${AppFormat.date(bounds.from, locale)} – ${AppFormat.date(bounds.to - 1, locale)}",
    total = AppFormat.tokens(summary.usage.total, locale),
    totalLabel = stringResource(R.string.kpi_total_tokens),
    metrics = listOf(
      stringResource(R.string.kpi_cost) to AppFormat.currency(summary.cost, locale),
      stringResource(R.string.kpi_requests) to AppFormat.integer(summary.usage.requests, locale),
      stringResource(R.string.kpi_cache_hit) to AppFormat.percent(summary.cacheHitRate, locale),
      stringResource(R.string.share_input_output) to "↓ ${AppFormat.tokens(summary.usage.input, locale)}  ↑ ${AppFormat.tokens(summary.usage.output, locale)}",
    ),
    capturedAt = DateTimeFormatter.ofPattern("yyyy MMM d HH:mm z", locale)
      .format(Instant.ofEpochMilli(state.now).atZone(ZoneId.systemDefault())),
    badges = buildList {
      if (isDemo) add(stringResource(R.string.share_demo))
      if (state.connection != ConnectionState.Live || loadable.stale) add(stringResource(R.string.share_stale))
    },
  )
  val bitmap = remember(content) { renderUsageCard(content) }
  val coroutineScope = rememberCoroutineScope()
  var busy by remember { mutableStateOf(false) }
  var message by remember { mutableStateOf<String?>(null) }
  // Freeze the tapped image while the document picker is open, even if subscriptions keep updating.
  var pendingSave by remember { mutableStateOf<Bitmap?>(null) }
  val saveDocument = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/png")) { uri ->
    val image = pendingSave
    pendingSave = null
    if (uri != null && image != null) coroutineScope.launch {
      try {
        withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri).use { writePng(image, it) } }
        message = context.getString(R.string.share_saved)
      } catch (cancelled: CancellationException) { throw cancelled }
      catch (_: Exception) { message = context.getString(R.string.share_error) }
      finally { busy = false }
    } else busy = false
  }
  Dialog(onDismissRequest = onDismiss) {
    androidx.compose.material3.Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(24.dp)) {
      Column(
        Modifier.widthIn(max = 400.dp).verticalScroll(rememberScrollState()).padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
      ) {
        Text(stringResource(R.string.share_title))
        Image(bitmap.asImageBitmap(), contentDescription = content.accessibleText,
          modifier = Modifier.fillMaxWidth().testTag("share_preview"))
        Text(stringResource(R.string.share_description))
        Button(enabled = !busy, modifier = Modifier.testTag("share_system"), onClick = {
          busy = true
          val image = bitmap
          coroutineScope.launch {
            try {
              val uri = withContext(Dispatchers.IO) { cacheUsageCard(context, image) }
              context.startActivity(Intent.createChooser(usageShareIntent(uri), context.getString(R.string.share_title)))
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { message = context.getString(R.string.share_error) }
            finally { busy = false }
          }
        }) { Text(stringResource(R.string.share_action)) }
        Button(enabled = !busy, modifier = Modifier.testTag("share_save"), onClick = {
          busy = true
          val image = bitmap
          if (Build.VERSION.SDK_INT < 29) {
            pendingSave = image
            saveDocument.launch("Codex-usage-${UUID.randomUUID()}.png")
          } else coroutineScope.launch {
            try {
              withContext(Dispatchers.IO) { saveUsageCard(context, image) }
              message = context.getString(R.string.share_saved)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { message = context.getString(R.string.share_error) }
            finally { busy = false }
          }
        }) { Text(stringResource(R.string.share_save)) }
        TextButton(onClick = onDismiss) { Text(stringResource(R.string.share_done)) }
      }
    }
  }
  message?.let { text ->
    AlertDialog(onDismissRequest = { message = null }, text = { Text(text) },
      confirmButton = { TextButton(onClick = { message = null }) { Text(stringResource(R.string.share_done)) } })
  }
}

internal fun renderUsageCard(content: UsageShareContent): Bitmap {
  val bitmap = Bitmap.createBitmap(1080, 1440, Bitmap.Config.ARGB_8888)
  val canvas = Canvas(bitmap)
  val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  paint.shader = LinearGradient(0f, 0f, 1080f, 1440f,
    Color.rgb(212, 250, 237), Color.rgb(235, 240, 255), Shader.TileMode.CLAMP)
  canvas.drawRect(0f, 0f, 1080f, 1440f, paint)
  paint.shader = null
  paint.color = Color.rgb(23, 36, 56)
  fun text(value: String, x: Float, y: Float, size: Float, width: Float = 912f, bold: Boolean = false) {
    paint.typeface = if (bold) Typeface.create("sans-serif", Typeface.BOLD) else Typeface.create("sans-serif", Typeface.NORMAL)
    paint.textSize = size
    val measured = paint.measureText(value)
    if (measured > width) paint.textSize *= width / measured
    canvas.drawText(value, x, y, paint)
  }
  text("CODEX TRACKER", 84f, 122f, 36f, bold = true)
  text(content.title, 84f, 265f, 72f, bold = true)
  text(content.dates, 84f, 328f, 36f)
  text(content.total, 84f, 555f, 174f, bold = true)
  text(content.totalLabel, 84f, 620f, 42f)
  paint.alpha = 40
  canvas.drawRect(84f, 687f, 996f, 690f, paint)
  paint.alpha = 255
  content.metrics.forEachIndexed { index, (label, value) ->
    val x = if (index % 2 == 0) 84f else 570f
    val y = if (index < 2) 795f else 970f
    text(value, x, y, 60f, width = 426f, bold = true)
    text(label, x, y + 57f, 33f, width = 426f)
  }
  content.badges.forEachIndexed { index, value -> text(value, 84f, 1140f + index * 48, 34f, bold = true) }
  text(content.capturedAt, 84f, 1290f, 30f)
  text("codex.chenli.dev", 84f, 1355f, 36f, bold = true)
  return bitmap
}

internal fun usageShareIntent(uri: Uri): Intent = Intent(Intent.ACTION_SEND).apply {
  type = "image/png"
  putExtra(Intent.EXTRA_STREAM, uri)
  clipData = ClipData.newRawUri("Codex usage", uri)
  addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
}

internal fun cacheUsageCard(context: Context, bitmap: Bitmap): Uri {
  val directory = File(context.cacheDir, "usage-shares").apply { mkdirs() }
  // Keep in-flight shares readable, while bounding old temporary exports.
  directory.listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 86_400_000 }
    ?.forEach { it.delete() }
  val file = File(directory, "usage-${UUID.randomUUID()}.png")
  file.outputStream().use { writePng(bitmap, it) }
  return FileProvider.getUriForFile(context, "${context.packageName}.usage-sharing", file)
}

private fun writePng(bitmap: Bitmap, stream: OutputStream?) {
  checkNotNull(stream) { "Image destination unavailable" }
  check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) { "Image encoding failed" }
}

@androidx.annotation.RequiresApi(29)
internal fun saveUsageCard(context: Context, bitmap: Bitmap): Uri {
  val resolver = context.contentResolver
  val values = ContentValues().apply {
    put(MediaStore.Images.Media.DISPLAY_NAME, "Codex-usage-${UUID.randomUUID()}.png")
    put(MediaStore.Images.Media.MIME_TYPE, "image/png")
    put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Codex Tracker")
    put(MediaStore.Images.Media.IS_PENDING, 1)
  }
  val uri = checkNotNull(resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values))
  try {
    resolver.openOutputStream(uri).use { writePng(bitmap, it) }
    resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
    return uri
  } catch (error: Exception) {
    resolver.delete(uri, null, null)
    throw error
  }
}
