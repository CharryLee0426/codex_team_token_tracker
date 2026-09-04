import java.util.Properties

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.kotlin.serialization)
}

fun readProperties(path: String) = Properties().apply {
  val propertiesFile = rootProject.file(path)
  if (propertiesFile.isFile) propertiesFile.inputStream().use(::load)
}
val localProperties = readProperties("local.properties")
fun configValue(name: String, release: Boolean): String =
  providers.gradleProperty(name).orNull
    ?: (if (release) "" else localProperties.getProperty(name, "").trim())

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
  }

  buildTypes {
    all {
      val release = name == "release"
      for (field in listOf("CODEX_TRACKER_CLERK_PUBLISHABLE_KEY", "CODEX_TRACKER_CONVEX_URL")) {
        buildConfigField("String", field, configValue(field, release).asBuildConfigString())
      }
    }
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

for (variant in listOf("Debug", "Release")) {
  val validateEnvironment = tasks.register("validate${variant}ServiceEnvironment") {
    doLast {
      val release = variant == "Release"
      if (release) {
        check(providers.gradleProperty("CODEX_TRACKER_ENVIRONMENT").orNull == "release") {
          "Use pnpm mobile:build --release to validate the production Clerk/Convex pair."
        }
      }
      val key = configValue("CODEX_TRACKER_CLERK_PUBLISHABLE_KEY", release)
      val url = configValue("CODEX_TRACKER_CONVEX_URL", release)
      check(!key.startsWith(if (release) "pk_test_" else "pk_live_")) {
        "Clerk credentials do not match the $variant build environment."
      }
      if (release || providers.gradleProperty("CODEX_TRACKER_ENVIRONMENT").orNull == "local") {
        check(key.startsWith(if (release) "pk_live_" else "pk_test_") && !key.contains("replace", true)) {
          "A valid Clerk publishable key is required for this environment."
        }
        check(url.matches(Regex("https://[a-z0-9-]+\\.convex\\.cloud")) && !url.contains("replace", true)) {
          "A valid Convex deployment URL is required for this environment."
        }
      }
    }
  }
  tasks.matching { it.name == "pre${variant}Build" }.configureEach { dependsOn(validateEnvironment) }
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
