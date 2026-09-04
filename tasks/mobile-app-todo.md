# Native Mobile Usage Viewer

## Task 1: Contract and local configuration

**Acceptance criteria:** The product/data boundaries, ignored secret inputs, five-tab IA, and build
commands are documented without replacing the completed prior task plan.

**Verification:** Review `SPEC-mobile-app.md`, this checklist, and `.gitignore`.

**Dependencies:** None

## Task 2: iOS domain scaffold (RED)

**Acceptance criteria:** Xcode project, app/test targets, representative fixture, and failing tests
exist for compact expansion, filtering, range chunks, and summaries.

**Verification:** Focused `xcodebuild test` fails only for unimplemented expected behavior.

**Dependencies:** Task 1

## Task 3: Android domain scaffold (RED)

**Acceptance criteria:** Gradle wrapper/app targets, representative fixture, and failing JUnit tests
exist for compact expansion, filtering, range chunks, and summaries.

**Verification:** `./gradlew testDebugUnitTest` fails only for unimplemented expected behavior.

**Dependencies:** Task 1

## Task 4: iOS native viewer (GREEN)

**Acceptance criteria:** Demo and live repositories feed five accessible SwiftUI tabs; personal/team
usage, members, sessions, devices, settings, range, locale, and theme states render natively.

**Verification:** iOS unit tests and placeholder-config simulator build pass.

**Dependencies:** Task 2

## Task 5: Android native viewer (GREEN)

**Acceptance criteria:** Demo and live repositories feed five accessible Compose tabs; personal/team
usage, members, sessions, devices, settings, range, locale, and theme states render natively.

**Verification:** Android unit tests and `assembleDebug` pass.

**Dependencies:** Task 3

## Task 6: Native E2E and artifacts

**Acceptance criteria:** Test-only demo launches traverse all tabs and assert review-only boundaries;
simulator/emulator runs pass; `.app`, `.xcresult`, `.apk`, test APK, and reports are exported.

**Verification:** XCUITest and `connectedDebugAndroidTest` pass; artifact checksums are recorded.

**Dependencies:** Tasks 4-5

## Task 7: Documentation and regression review

**Acceptance criteria:** English/Chinese setup guides describe Clerk owner steps and local builds;
existing test/typecheck gates pass; diff contains no keys, generated caches, or unrelated changes.

**Verification:** `pnpm test`, `pnpm typecheck`, git diff/status review, and five-axis code review.

**Dependencies:** Task 6
