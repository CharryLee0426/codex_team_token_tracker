package dev.chenli.codextracker

import android.content.Intent
import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.chenli.codextracker.ui.UsageShareContent
import dev.chenli.codextracker.ui.cacheUsageCard
import dev.chenli.codextracker.ui.renderUsageCard
import dev.chenli.codextracker.ui.saveUsageCard
import dev.chenli.codextracker.ui.usageShareIntent
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class UsageShareTest {
  @Test fun imageExportsReadablePngWithTemporaryReadGrantAndSavesToPictures() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    for (title in listOf("Personal usage", "个人用量")) {
      val content = UsageShareContent(title, "Sep 1 – Sep 7, 2026", "620K", "Total tokens",
        listOf("API-equivalent cost" to "$1.23", "Requests" to "100", "Cache hit" to "80%", "Input / Output" to "↓ 500K ↑ 120K"),
        "2026 Sep 7 12:00 PDT", listOf("DEMO DATA", "CACHED DATA"))
      val image = renderUsageCard(content)
      assertEquals(1080, image.width)
      assertEquals(1440, image.height)
      val uri = cacheUsageCard(context, image)
      assertEquals("content", uri.scheme)
      val intent = usageShareIntent(uri)
      assertEquals(Intent.ACTION_SEND, intent.action)
      assertEquals("image/png", intent.type)
      assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
      assertEquals(uri, intent.clipData?.getItemAt(0)?.uri)
      context.contentResolver.openInputStream(uri).use {
        val decoded = BitmapFactory.decodeStream(it)
        assertEquals(1080, decoded.width)
        assertEquals(1440, decoded.height)
      }
      if (android.os.Build.VERSION.SDK_INT >= 29) {
        val saved = saveUsageCard(context, image)
        try {
          context.contentResolver.openInputStream(saved).use { assertNotNull(BitmapFactory.decodeStream(it)) }
        } finally { context.contentResolver.delete(saved, null, null) }
      }
    }
  }
}
