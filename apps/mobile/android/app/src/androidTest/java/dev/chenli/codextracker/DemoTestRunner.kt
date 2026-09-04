package dev.chenli.codextracker

import android.app.Activity
import android.content.Intent
import androidx.test.runner.AndroidJUnitRunner

class DemoTestRunner : AndroidJUnitRunner() {
  override fun newActivity(
    classLoader: ClassLoader?,
    className: String?,
    intent: Intent?,
  ): Activity {
    intent?.putExtra(MainActivity.DemoModeExtra, true)
    return super.newActivity(classLoader, className, intent)
  }
}
