# @codex-tracker/backend

Convex schema and functions shared by the dashboard (`apps/dashboard`) and the menubar tool (`packages/menubar`).

- `schema.ts` – tables (`users`, `orgs`, `memberships`, `devices`, `deviceAuthRequests`, `hourlyUsage`, `sessions`). All timestamps are UTC ms.
- `deviceAuth.ts` – device-code login flow used by the menubar/agent (Clerk login happens in the dashboard).
- `ingest.ts` – device-token API: `pushHourly`, `pushSessions`, `heartbeat`, `whoami`, `remoteHourly`.
- `usage.ts` – dashboard queries (`hourly`, `recentSessions`, `liveNow`, `myDevices`, `revokeDevice`).
- `orgs.ts` / `users.ts` – Clerk identity → Convex records; team = Clerk Organization.
- `http.ts` – Clerk webhook (`/clerk-webhook`) keeping org rosters in sync.

Deploy from `apps/dashboard` (`npx convex dev` / `npx convex deploy`), which points at this folder through `convex.json`.
