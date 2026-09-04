import java.util.Properties

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.kotlin.serialization)
}

val localProperties = Properties().apply {
  val propertiesFile = rootProject.file("local.properties")
  if (propertiesFile.isFile) propertiesFile.inputStream().use(::load)
}

fun localValue(name: String, fallback: String): String =
  localProperties.getProperty(name)?.trim()?.takeIf(String::isNotEmpty) ?: fallback

fun String.asBuildConfigString(): String =
  "\"${replace("\\", "\\\\").replace("\"", "\\\"")}\""

android {
  namespace = "dev.chenli.codextracker"
  compileSdk { version = release(37) }

  defaultConfig {
    applicationId = "dev.chenli.codextracker"
    minSdk = 26
    targetSdk = 37
    versionCode = 1
    versionName = "0.1.0"

    testInstrumentationRunner = "dev.chenli.codextracker.DemoTestRunner"
    buildConfigField(
      "String",
      "CODEX_TRACKER_CLERK_PUBLISHABLE_KEY",
      localValue("CODEX_TRACKER_CLERK_PUBLISHABLE_KEY", "PLACEHOLDER_KEY").asBuildConfigString(),
    )
    buildConfigField(
      "String",
      "CODEX_TRACKER_CONVEX_URL",
      localValue("CODEX_TRACKER_CONVEX_URL", "PLACEHOLDER_URL").asBuildConfigString(),
    )
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlin { jvmToolchain(17) }

  buildFeatures {
    buildConfig = true
    compose = true
  }

  sourceSets.named("main") { assets.directories.add(rootProject.file("../fixtures").absolutePath) }
  sourceSets.named("test") { resources.directories.add(rootProject.file("../fixtures").absolutePath) }

  testOptions {
    animationsDisabled = true
    unitTests.isIncludeAndroidResources = true
  }

  packaging.resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
}

dependencies {
  implementation(libs.clerk.ui)
  implementation(libs.clerk.convex)
  implementation("dev.convex:android-convexmobile:0.8.0@aar") { isTransitive = true }
  implementation(libs.kotlinx.coroutines)
  implementation(libs.kotlinx.serialization)
  implementation(platform(libs.compose.bom))
  implementation(libs.compose.ui)
  implementation(libs.compose.ui.graphics)
  implementation(libs.compose.ui.tooling.preview)
  implementation(libs.compose.foundation)
  implementation(libs.compose.material3)
  implementation(libs.activity.compose)
  implementation(libs.lifecycle.runtime.compose)
  implementation(libs.lifecycle.viewmodel.compose)
  implementation(libs.navigation.compose)
  implementation(libs.core.ktx)
  implementation(libs.appcompat)

  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)

  androidTestImplementation(platform(libs.compose.bom))
  androidTestImplementation(libs.androidx.junit)
  androidTestImplementation(libs.espresso.core)
  androidTestImplementation(libs.compose.ui.test.junit4)

  debugImplementation(libs.compose.ui.tooling)
  debugImplementation(libs.compose.ui.test.manifest)
}
