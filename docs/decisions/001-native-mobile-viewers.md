# ADR-001: Native Mobile Viewers Use Existing Convex Queries

## Status

Accepted

## Date

2026-09-04

## Context

Codex Token Tracker already has a responsive Next.js dashboard, Clerk identity, and authenticated
Convex queries. The requested iOS and Android applications are review surfaces, not collectors: they
must not inspect mobile files, upload usage, control tracker devices, or present desktop setup flows.

A mobile implementation needs native SwiftUI and Kotlin/Compose interfaces, realtime personal/team
data, secure session handling, deterministic tests without production credentials, and as little new
backend/privacy surface as possible.

## Decision

Build separate SwiftUI and Jetpack Compose viewers that authenticate with the official Clerk native
SDKs and pass that authentication to the official Convex mobile clients through Clerk's supported
Convex bridges. The clients call the existing `users:*`, `orgs:*`, and `usage:*` functions directly.

`users:ensureUser` and, when an active organization has not yet synchronized, `orgs:ensureCurrentOrg`
are the only application bootstrap writes. All user-facing mobile features remain read-only. Native
clients discover memberships from Clerk rather than the Convex mirror, make the selected organization
active, wait for the refreshed token, and resolve it with `orgs:byClerkId`. Team authorization requires
both a mirrored membership and a matching Clerk-signed active `org_id`, so a missed membership webhook
cannot leave an unbounded stale authorization grant.

Range chunking, compact-row expansion, Codex-only filtering, and local-time grouping are small pure
native transforms protected by one shared fixture and platform tests.

Debug builds also support an explicitly labeled, deterministic demo mode. Native UI tests force this
mode, so E2E verification never depends on external Clerk state, production data, or network access.

## Alternatives Considered

### Wrap the responsive dashboard in a WebView

- Pros: Least code and automatic visual/data parity.
- Cons: Does not satisfy the native SwiftUI/Kotlin requirement, duplicates browser navigation chrome,
  and makes native accessibility/offline state harder to control.
- Rejected: The requested product is a native viewer, not a packaged website.

### Add a mobile REST read API and custom mobile tokens

- Pros: One server-shaped response and little client aggregation.
- Cons: Creates a second authentication/token lifecycle, a new externally reachable privacy surface,
  deployment coupling, and more server code despite existing native Convex support.
- Rejected: Unnecessary for the first read-only clients.

### Add a pre-aggregated Convex mobile read model

- Pros: Less duplicate transformation code and smaller mobile payloads.
- Cons: Requires a backend deployment and timezone-aware server contract; local-day grouping belongs
  at the viewer boundary under the current UTC invariant.
- Deferred: Reconsider if profiling shows mobile payload or duplicated transform maintenance is costly.

## Consequences

- The existing production schema and wire protocol remain unchanged. Existing team read functions
  receive a stricter active-organization authorization check; that function change must be deployed
  before live native team access is considered secure.
- Live sign-in requires the owner to enable Clerk Native API, register the bundle/package identifier,
  and provide the public build key locally. This security-sensitive external setup is not automated.
- Swift and Kotlin mirror a small response schema because generated TypeScript types do not cross the
  native boundary. Fixture and decoder tests guard drift.
- Unsigned CI/local work produces an iOS Simulator app rather than a device IPA; store distribution
  remains a separate signing/release decision.
