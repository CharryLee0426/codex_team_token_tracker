# Spec: Native Mobile Usage Viewer

## Objective

Add first-party, review-only iOS and Android applications for Codex Token Tracker. The apps let an
authenticated user inspect the same personal/team usage, member, session, and device information as
the dashboard, with native controls and the dashboard's visual language. They never discover logs,
track usage, upload data, approve/revoke tracker devices, or teach users how to run the menubar tool.

The work has four independently verifiable modules:

| Module | Responsibility | Depends on |
| --- | --- | --- |
| `mobile-contract` | Shared product/data rules documented and ported with fixture parity | Existing Convex API |
| `ios-viewer` | SwiftUI client, native auth/data subscriptions, XCTest/XCUITest | `mobile-contract` |
| `android-viewer` | Kotlin/Compose client, native auth/data subscriptions, JUnit/instrumentation tests | `mobile-contract` |
| `mobile-delivery` | Setup docs, toolchain scripts, and locally testable artifacts | `ios-viewer`, `android-viewer` |

Build order: `mobile-contract` -> `ios-viewer` and `android-viewer` in parallel -> `mobile-delivery`.

## Tech Stack

- iOS 17+: Swift 6, SwiftUI, Swift Charts, XCTest, and XCUITest. Authentication/data use the
  official Clerk iOS, Clerk-Convex Swift, and Convex Swift packages.
- Android API 26+ (compile/target API 37): Kotlin, Jetpack Compose/Material 3,
  coroutines/serialization, JUnit, and Compose
  instrumentation tests. Authentication/data use the official Clerk Android, Clerk-Convex Kotlin,
  and Convex Android libraries.
- Existing backend only: authenticated `users:*`, `orgs:*`, and `usage:*` Convex functions. This
  feature adds no upload fields, read endpoint, database table, or production deployment.
- Checked-in demo fixtures provide deterministic, credential-free previews and E2E tests. Demo
  mode is visibly labeled and cannot write to Convex.

## Commands

```bash
# iOS tests and simulator build (run `xcodegen generate` only after editing project.yml)
cd apps/mobile/ios
xcodebuild -project CodexTracker.xcodeproj -scheme CodexTracker \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=latest' test
xcodebuild -project CodexTracker.xcodeproj -scheme CodexTracker \
  -sdk iphonesimulator -configuration Debug build

# Android tests, APK, and emulator E2E
cd apps/mobile/android
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew testDebugUnitTest assembleDebug
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew connectedDebugAndroidTest
```

## Project Structure

```text
apps/mobile/
  README.md                 Native setup, configuration, build, and test guide
  README.zh-CN.md           Simplified Chinese companion guide
  ios/                      XcodeGen project, SwiftUI source, unit tests, XCUITest
  android/                  Gradle project, Kotlin/Compose source, unit/instrumentation tests
artifacts/mobile/           Ignored local APK, simulator app bundle, and test-result exports
```

## Code Style

Keep remote state outside presentation views and make demo/live repositories conform to the same
small interface. Domain transforms remain pure and deterministic:

```swift
let snapshot = UsageAggregator.snapshot(rows: rows, range: range, calendar: .current)
```

```kotlin
val snapshot = UsageAggregator.snapshot(rows, range, ZoneId.systemDefault())
```

Both ports preserve UTC milliseconds until their local-day grouping boundary, accept only OpenAI
model identifiers, and derive cost from the already uploaded `usd` values.

## Product and UI Requirements

- Five native bottom tabs: Personal, Team, Members, Devices, and Settings.
- Personal/Team show a 30-day default range, range selection, token/cost/cache/request/live KPIs,
  daily usage, model mix, source mix, and recent sessions. Team also shows member contribution.
- Members and Devices are read-only lists with useful loading, empty, error, offline/stale, and
  accessibility states. Device revoke and organization/invite mutations are not exposed.
- Settings contains appearance (system/light/dark), language, account/sign-out, privacy summary,
  and app information only. It contains no menubar instructions or onboarding completion mutation.
- Match dashboard tokens: dark-first space palette, 14-point cards, quiet borders, cyan/blue accent,
  system sans plus monospaced metrics, restrained motion, and a 62-point safe-area tab bar.
- Follow system text scaling, semantic labels, 44-point minimum touch targets, color-independent
  status communication, system light/dark mode, and reduced-motion preferences.
- English and Simplified Chinese copy ship together.

## Data and Authentication Requirements

- Real mode is enabled only when a Clerk publishable key and Convex deployment URL are supplied by
  ignored local configuration. Missing/placeholder configuration opens the labeled demo viewer.
- After native Clerk authentication, use the official Clerk-Convex bridge and call
  `users:ensureUser` before protected subscriptions. Read account data with `users:me`.
- Discover team choices from Clerk membership state, activate the selected Clerk organization, wait
  for a refreshed Convex token with the matching `org_id`, run the idempotent
  `orgs:ensureCurrentOrg` bootstrap, and resolve the mirrored row with `orgs:byClerkId` before team
  reads. Never use the Convex membership mirror as the authority for what the user may activate.
- Use the existing authenticated read queries `usage:hourly`, `usage:liveNow`,
  `usage:recentSessions`, `usage:myDevices`, and `orgs:members`. Every team read must verify that the
  requested organization matches the active Clerk-signed organization claim as well as the mirrored
  membership.
- Split ranges into at most 60-day query chunks because the backend rejects spans over 62 days.
- Filter hourly rows and sessions with the dashboard's OpenAI model-name rule. Keep unknown model
  names because attributable Codex rollouts can omit a name.
- Never request transcript/file-system access or upload prompts, code, paths, hardware identifiers,
  credentials, or any new wire field. Authentication tokens go only to their intended Clerk/Convex
  endpoints through the official SDKs; never add them to usage payloads, logs, or app-owned storage.

## Testing Strategy

- Unit tests prove compact-row expansion, OpenAI filtering, UTC-to-local daily grouping, summary and
  cache-hit math, 60-day chunking, deterministic demo data, clock-driven hour/day rollover, and
  exact live-data expiry on each platform. Native decoder/transport tests cover ordinary and tagged
  Convex floating-point values and ensure `v.number()` arguments are not encoded as Convex integers.
  Repository lifecycle tests cover first-launch initialization, principal changes, and interrupted
  organization switches so stale account/team state cannot leak into a new session.
- Native UI tests launch with a test-only demo flag, verify the overview KPIs, traverse all five
  tabs, switch range/theme where supported, and assert that no tracker setup/revoke UI exists.
- Build and run the iOS XCUITest on an installed simulator and Android instrumentation tests on an
  ARM64 emulator. Export a simulator `.app`, `.xcresult`, debug `.apk`, Android test APK, and result
  reports under ignored `artifacts/mobile/`.
- Run existing monorepo tests/typechecks after native work to prove no regression.

## Boundaries

- Always: preserve UTC semantics, Codex-only filtering, read-only mobile behavior, accessibility,
  deterministic demo tests, ignored secrets, and paired English/Chinese documentation.
- Ask first: production deployment, Clerk dashboard/native-app configuration, signing/provisioning,
  App Store/Play publishing, backend schema/wire changes, or a new dependency outside this spec.
- Never: commit keys or local SDK paths, call ingestion/device-auth APIs, complete the web onboarding
  from mobile, publish artifacts, or expose user-facing mutations for users, organizations, invites,
  and devices. The two idempotent authentication bootstrap writes above are explicitly allowed.

## Success Criteria

- Both applications build from a fresh documented checkout and render the same five-tab native IA.
- Configured builds can sign in and subscribe to the existing Convex usage data; unconfigured/E2E
  builds show deterministic demo data without crashing.
- The default range and aggregations agree with shared dashboard fixture expectations.
- XCUITest and Android instrumentation smoke flows pass on local simulators/emulators.
- A debug Android APK and simulator iOS app/test result are generated for local testing.
- Existing repository tests and typechecks remain green, with no production deployment or secrets.

## Open Questions / External Setup

- A distributable iOS IPA or physical-device build needs the owner's Apple team, bundle registration,
  and signing profile. This task produces a simulator `.app` unless signing is already available.
- Live native sign-in needs the owner to enable Clerk Native API and register bundle/package ID
  `dev.chenli.codextracker`. Those external security settings are documented but not changed here.
