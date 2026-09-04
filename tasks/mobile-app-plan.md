# Implementation Plan: Native Mobile Usage Viewer

## Overview

Build two thin native clients over the existing authenticated Convex query surface. Each platform
owns a small domain transform, live/demo repository boundary, accessible dashboard-style views, and
its native test stack. No schema, wire, ingestion, or new read-endpoint change is required; the
existing team-read authorization is hardened to require the active Clerk organization claim.

## Architecture Decisions

- Keep the schema, wire contract, and read interface unchanged, harden the existing organization
  authorization boundary, and subscribe through official Clerk-Convex mobile bridges.
- Use deterministic demo mode for credential-free previews and E2E; label it instead of silently
  presenting fixture data as live.
- Port only the small dashboard rules needed by mobile (compact expansion, OpenAI filter, range
  chunks, summaries/daily/model/member grouping) and protect them with fixture-parity tests.
- Keep user-facing mobile features read-only. Allow only the required idempotent
  `users:ensureUser` and `orgs:ensureCurrentOrg` bootstrap writes.
- Generate and commit the Xcode project so app builds do not require XcodeGen after checkout; commit
  the Gradle wrapper so Android Studio/global Gradle is optional.

## Task List

### Phase 1: Contract and scaffolds

- [x] Task 1: Record the native contract, build configuration, and ignored local/artifact paths.
- [x] Task 2: Scaffold the iOS project and failing domain/UI smoke tests.
- [x] Task 3: Scaffold the Android project/wrapper and failing domain/UI smoke tests.

### Checkpoint: Foundations

- [x] Both projects resolve dependencies and the expected RED tests fail for missing behavior.

### Phase 2: Native vertical slices

- [x] Task 4: Implement iOS demo/domain aggregation and the five-tab SwiftUI viewer.
- [x] Task 5: Implement iOS Clerk/Convex live repository, bootstrap, and state handling.
- [x] Task 6: Implement Android demo/domain aggregation and the five-tab Compose viewer.
- [x] Task 7: Implement Android Clerk/Convex live repository, bootstrap, and state handling.

### Checkpoint: Feature Complete

- [x] Unit suites pass and both apps build with placeholder configuration.
- [x] No mobile screen contains tracker setup, onboarding-completion, revoke, invite, or upload UI.

### Phase 3: Runtime verification and handoff

- [x] Task 8: Run iOS XCUITest and export the simulator app plus `.xcresult`.
- [x] Task 9: Install/verify Android CLI tooling, run emulator instrumentation tests, and export APKs.
- [x] Task 10: Complete paired docs, repository regression checks, diff review, and final artifacts.

### Checkpoint: Complete

- [x] All spec success criteria pass or any external signing/Clerk setup blocker is explicit.

## Completion Evidence

- iOS: 41 XCTest cases and 2 XCUITest flows passed on an iPhone 17 Pro simulator running iOS 26.5;
  the simulator app, complete E2E products, `.xctestrun`, and `.xcresult` are exported.
- Android: 33 unit tests and 3 Compose E2E flows passed on the API-37 ARM64 emulator; Android lint
  reported zero errors, and both exported debug APKs pass signature verification.
- Existing pnpm tests and all workspace typechecks pass. Mobile scans found no tracker setup,
  ingestion, device-revoke, invitation, storage, location, or transcript access surface.
- Live owner-configured Clerk/Convex authentication, a physical API-26 device, TalkBack/large-font
  manual testing, production backend deployment, and store signing remain explicit external steps.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Native Clerk setup is not enabled externally | Live sign-in cannot complete | Demo E2E plus exact owner setup checklist; no silent external mutation |
| Swift/Kotlin drift from TypeScript aggregation | Different numbers across clients | Identical fixtures and platform unit tests for contract rules |
| Large Convex date ranges exceed query cap | Runtime errors | Split every interval into <=60-day chunks |
| Mobile accidentally becomes a tracker controller | Privacy/product regression | No ingestion/device-auth APIs and UI assertions for absent mutation actions |
| Local Android environment is missing | APK/E2E blocked | Install lean CLI/JDK/ARM64 SDK rather than the full IDE |
| No Apple signing identity | No IPA/physical build | Deliver simulator `.app`/XCUITest; document optional signing step |

## Open Questions

- None blocking a simulator/emulator MVP. Production account configuration and store signing remain
  owner-controlled external setup.
