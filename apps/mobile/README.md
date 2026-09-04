# Codex Tracker native mobile viewers

The iOS and Android apps are native, read-only entrances to the existing Codex Tracker dashboard.
They show personal and team usage, members, sessions, and registered devices. They do **not** scan
the phone, collect or upload usage, approve or revoke devices, or explain how to install the desktop
menubar tracker.

Both apps open in a clearly labeled, credential-free demo mode when local service configuration is
missing. Live mode uses Clerk authentication and the existing authenticated Convex queries; it does
not add a mobile API or change the upload wire contract.

## Project map

| Path | Purpose |
| --- | --- |
| `fixtures/dashboard-demo.json` | Shared deterministic data for previews and native tests |
| `ios` | SwiftUI, Swift Charts, XCTest, and XCUITest app |
| `android` | Kotlin, Jetpack Compose, JUnit, and Compose UI-test app |
| `../../artifacts/mobile` | Ignored local build and test exports |

Each app has five native tabs: Personal, Team, Members, Devices, and Settings. Personal and Team
provide range selection, usage KPIs, daily/model/source summaries, and recent sessions. Members and
Devices are read-only. Settings is limited to appearance, language, account, privacy, and app
information.

## iOS

Requirements:

- Xcode 26 or newer with an iOS Simulator runtime
- iOS 17 or newer as the deployment target
- XcodeGen 2.46 or newer only when changing `project.yml`; the generated Xcode project is committed

The checked-in placeholder configuration launches demo mode. For local live mode, copy the ignored
configuration and replace both values:

```bash
cd apps/mobile/ios
cp Config/Local.xcconfig.example Config/Local.xcconfig
```

An xcconfig treats `//` as a comment delimiter, so keep the URL in the escaped form used by the
example:

```text
CLERK_PUBLISHABLE_KEY = pk_test_replace_me
CONVEX_URL = https:/$()/your-deployment.convex.cloud
```

Build and test on this machine's installed simulator:

```bash
cd apps/mobile/ios
xcodebuild -project CodexTracker.xcodeproj -scheme CodexTracker \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=latest' \
  -derivedDataPath DerivedData test
xcodebuild -project CodexTracker.xcodeproj -scheme CodexTracker \
  -sdk iphonesimulator -configuration Debug \
  -derivedDataPath DerivedData build
```

Run `xcodegen generate` only after changing `project.yml`, then review and commit the generated
project diff.

The XCUITest target launches with a test-only demo argument and navigates the native interface. The
simulator `.app` supports manual smoke testing; the complete E2E products archive below includes the
test runner and frameworks needed for `test-without-building`. Installing on a physical device or
creating an IPA additionally requires your Apple Developer team, bundle registration, signing
certificate, and provisioning profile; those account changes are intentionally outside this work.

## Android

The repository commits the Gradle wrapper, so Android Studio and a global Gradle installation are
not required. On Apple Silicon macOS, the lean command-line setup is:

```bash
brew install openjdk@17 android-commandlinetools

export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:/opt/homebrew/opt/openjdk@17/bin:$PATH"

sdkmanager --sdk_root="$ANDROID_HOME" \
  'cmdline-tools;latest' \
  'platform-tools' \
  'platforms;android-37.0' \
  'build-tools;37.0.0' \
  'emulator' \
  'system-images;android-37.0;google_apis;arm64-v8a'
sdkmanager --sdk_root="$ANDROID_HOME" --licenses

avdmanager create avd --force \
  --name CodexTracker_API_37 \
  --package 'system-images;android-37.0;google_apis;arm64-v8a' \
  --device pixel_9
```

`ANDROID_HOME` is the primary SDK setting. `ANDROID_SDK_ROOT` is also set to the identical path for
compatibility with command-line tools that still inspect it. Keep the SDK-root `platform-tools`
ahead of any separately installed `adb` in `PATH`.

This workstation is already prepared with ARM64 JDK 17, platform/build tools 37, emulator 37, and a
boot-verified Pixel 9 API-37 AVD named `CodexTracker_API_37`; no shell profile was modified.

For local live mode, create the ignored properties file and replace the placeholders:

```bash
cd apps/mobile/android
cp local.properties.example local.properties
```

```properties
sdk.dir=/Users/your-name/Library/Android/sdk
CODEX_TRACKER_CLERK_PUBLISHABLE_KEY=pk_test_replace_me
CODEX_TRACKER_CONVEX_URL=https://your-deployment.convex.cloud
```

Build the debug APK and run unit tests:

```bash
cd apps/mobile/android
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME="$HOME/Library/Android/sdk" \
ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
./gradlew testDebugUnitTest assembleDebug
```

Start the emulator in another terminal, wait for Android to finish booting, then run the native UI
test:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

"$ANDROID_HOME/emulator/emulator" -avd CodexTracker_API_37 -no-snapshot -no-boot-anim \
  > /tmp/codex-tracker-emulator.log 2>&1 &
"$ANDROID_HOME/platform-tools/adb" wait-for-device
"$ANDROID_HOME/platform-tools/adb" shell \
  'until [ "$(getprop sys.boot_completed)" = "1" ]; do sleep 1; done'

cd apps/mobile/android
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME="$HOME/Library/Android/sdk" \
ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
./gradlew connectedDebugAndroidTest
```

## Enabling live sign-in

Demo mode needs no account or network. Live mode requires owner-controlled Clerk and Convex setup:

1. Enable Clerk's Native API for the relevant instance. Clerk notes that doing so changes bot
   protection behavior, so review that security tradeoff first.
2. Register `dev.chenli.codextracker` as the Android package/application ID. For iOS, register a
   Native Application with your Apple App ID Prefix plus that bundle ID, and add the Associated
   Domains capability with `webcredentials:<your Clerk Frontend API host>`.
3. Activate Clerk's current **Convex integration**. In *Sessions → Claims*, keep the integration's
   generated `aud: convex` mapping and add the organization/user mappings from
   `docs/clerk-jwt-template.json`. The official native bridges request Clerk's native session token;
   they cannot select the repository's legacy named `convex` JWT template. If the instance only has
   that legacy template, copy its mappings into the session claims before testing mobile live mode.
4. Set the Convex issuer configured by `packages/backend/convex/auth.config.ts` to the Clerk Frontend
   API URL revealed by the integration, then intentionally deploy the auth/backend changes.
5. Put only the publishable key and Convex deployment URL in the ignored local files above.

Never place a Clerk secret key in either app. The native clients use the publishable key, retain the
Clerk session in the platform SDK, and send its token only to its intended Clerk/Convex endpoints.
They discover memberships through Clerk, activate a selected organization, wait for the refreshed
organization claim, perform the idempotent user/current-org bootstrap, and subscribe only to the
existing user, organization, and usage functions. Tokens are never added to usage payloads, logged,
or persisted in app-owned storage.

See the repository's [admin deployment guide](../../docs/ADMIN_DEPLOY.md) for the existing Convex
issuer and JWT-template contract. Enabling Native API, registering native applications, and changing
Apple capabilities remain owner actions and are not automated by these builds. Deploy the included
backend authorization hardening before treating live native team access as secure; no deployment is
performed by the local build workflow.

## Data and privacy contract

- Usage timestamps remain UTC milliseconds until local-day presentation grouping.
- Query intervals are split into at most 60-day chunks to stay below the backend's 62-day limit.
- The same model-name rule as the web dashboard excludes non-OpenAI rows while retaining `unknown`
  entries attributable to Codex.
- Cost is displayed from the server's existing `usd` values; mobile never recalculates or uploads it.
- The apps request no transcript, storage, or file-system access and expose no ingestion, onboarding,
  invitation, device-authorization, or revoke actions.

See [ADR-001](../../docs/decisions/001-native-mobile-viewers.md) for the architecture decision and
[the feature spec](../../SPEC-mobile-app.md) for acceptance criteria.

## Local verification snapshot

- iOS: 41 XCTest cases and 2 XCUITest flows passed on an iPhone 17 Pro simulator with iOS 26.5.
- Android: 33 unit tests and 3 Compose E2E flows passed on the API-37 ARM64 emulator; lint reported
  zero errors, and both debug APKs pass signature verification.
- Demo-mode builds and the exported artifacts below are fully exercised. Live Clerk/Convex sign-in,
  physical API-26 behavior, TalkBack/large-font manual testing, store signing, and backend deployment
  require owner-controlled environments and were not performed.

## Local deliverables

Verified exports are copied to the ignored `artifacts/mobile` directory so credentials, caches, and
large binaries never enter Git:

| File | Purpose |
| --- | --- |
| `android/codex-tracker-debug.apk` | Installable debug/demo application |
| `android/codex-tracker-debug-androidTest.apk` | Compose instrumentation tests |
| `android/codex-tracker-android-e2e-report.zip` | Passing Android E2E HTML report |
| `ios/CodexTracker-iOS-Simulator-26.5.zip` | Installable simulator `.app` |
| `ios/CodexTracker-iOS-E2E-Products-26.5.zip` | Portable app, unit-test, UI-test runner, frameworks, and `.xctestrun` |
| `ios/CodexTracker-iOS-26.5.xcresult.zip` | Passing XCTest/XCUITest result evidence |
| `android/codex-tracker-demo.png`, `ios/*.png` | Inspected emulator/simulator screenshots |
| `SHA256SUMS` | Checksums for every exported file |

From the repository root, verify every export before installing it:

```bash
shasum -a 256 -c artifacts/mobile/SHA256SUMS
```

With the documented Android emulator running, install and launch the demo APK:

```bash
SDK_ADB="$HOME/Library/Android/sdk/platform-tools/adb"
"$SDK_ADB" install -r artifacts/mobile/android/codex-tracker-debug.apk
"$SDK_ADB" shell am start -S \
  -n dev.chenli.codextracker/.MainActivity \
  --ez dev.chenli.codextracker.DEMO_MODE true
```

To rerun the packaged Android E2E tests:

```bash
SDK_ADB="$HOME/Library/Android/sdk/platform-tools/adb"
"$SDK_ADB" install -r artifacts/mobile/android/codex-tracker-debug-androidTest.apk
"$SDK_ADB" shell am instrument -w \
  dev.chenli.codextracker.test/dev.chenli.codextracker.DemoTestRunner
```

List available iOS simulators, boot one, then install the demo app:

```bash
xcrun simctl list devices available
ios_app_dir=$(mktemp -d /tmp/codex-tracker-app.XXXXXX)
ditto -x -k artifacts/mobile/ios/CodexTracker-iOS-Simulator-26.5.zip "$ios_app_dir"
xcrun simctl boot 'iPhone 17 Pro' 2>/dev/null || true
open -a Simulator
xcrun simctl install booted "$ios_app_dir/CodexTracker.app"
xcrun simctl launch booted dev.chenli.codextracker --demo --reset-preferences
```

Replace the device name with one reported by `simctl` if necessary. To rerun all XCTest and XCUITest
cases without recompiling, extract the complete E2E products together so the relative `__TESTROOT__`
paths remain valid:

```bash
ios_e2e_dir=$(mktemp -d /tmp/codex-tracker-e2e.XXXXXX)
ditto -x -k artifacts/mobile/ios/CodexTracker-iOS-E2E-Products-26.5.zip "$ios_e2e_dir"
xcodebuild test-without-building \
  -xctestrun "$ios_e2e_dir/Products/CodexTracker_iphonesimulator26.5-arm64.xctestrun" \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=latest'
```

The `.xcresult.zip` is immutable evidence from the verified run; build from source with the earlier
`xcodebuild ... test` command whenever the code changes.

These are development artifacts, not signed App Store or Play Store releases.
