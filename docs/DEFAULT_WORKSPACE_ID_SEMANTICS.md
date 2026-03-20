# DEFAULT_WORKSPACE_ID — Current Semantics and Usage

This document describes the **actual** role of `DEFAULT_WORKSPACE_ID` in the codebase as of Phase 2D. It is an audit of where it is used and how it should be understood.

---

## What it currently does

`DEFAULT_WORKSPACE_ID` is an optional environment variable. When set, it provides a **fallback workspace** when the server cannot resolve a workspace from request context (JWT or admin secret).

**Resolution order (tRPC and resolveWorkspace):**
1. **Admin secret** — If `x-admin-secret` or Bearer matches `ADMIN_SECRET`, use `DEFAULT_WORKSPACE_ID` as the workspace.
2. **JWT** — If Bearer token is a valid Supabase user, resolve workspace from `workspace_members` (first membership by `created_at`). If token equals `ADMIN_SECRET`, treat as admin secret (use `DEFAULT_WORKSPACE_ID`).
3. **Fallback** — If no workspace resolved yet and `DEFAULT_WORKSPACE_ID` is set, use it. Auth method is `'fallback'`.

**When unset:** Requests with no auth headers fail with 401 (tRPC throws; media routes return 401). Admin-secret requests also fail if `envDefaultWorkspace` is null (admin secret would resolve to `null` workspace).

---

## Where it is used

### 1. Server request handling (reads `process.env['DEFAULT_WORKSPACE_ID']` directly)

| File | Usage | Classification |
|------|-------|----------------|
| `src/server/trpc.ts` | `envDefaultWorkspace` — used when admin secret matches, or as fallback when no auth | **Temporary compatibility** — Single-tenant convenience. In multi-tenant SaaS, JWT should be primary; admin secret + default workspace is for dev/scripts. |
| `src/server/resolveWorkspace.ts` | Same logic for `/thumbnail` and `/video` routes | **Temporary compatibility** — Same as above. `<img>` tags don't send auth; fallback lets thumbnails load in single-tenant. |

### 2. Scripts (use `getDefaultWorkspaceId()`)

| Script | Purpose | Classification |
|--------|---------|----------------|
| `scripts/analyze-batch.ts` | Headless scan | **Acceptable local/dev convenience** — Scripts need a workspace. Env is the only way to specify it today. |
| `scripts/test-triage.ts` | Triage test | **Acceptable local/dev convenience** |
| `scripts/sync-shopify.ts` | Shopify sync | **Acceptable local/dev convenience** |
| `scripts/restart-scan.ts` | Restart scan | **Acceptable local/dev convenience** |
| `scripts/reset-stale.ts` | Reset stale videos | **Acceptable local/dev convenience** |
| 15+ other scripts (audit, debug, verify, etc.) | Various diagnostics | **Acceptable local/dev convenience** — Internal tools; env is fine. |

### 3. Definition

| File | What it does | Classification |
|------|--------------|----------------|
| `src/lib/workspace.ts` | `getDefaultWorkspaceId()` — reads env, throws if unset | **Acceptable** — Used only by scripts. Scripts that need a workspace call this. |

---

## Where it should NOT be relied on long-term

| Context | Problem |
|---------|---------|
| **Production multi-tenant** | Fallback means unauthenticated requests (e.g. `<img src="/thumbnail/xxx">`) always resolve to the default workspace. A user in workspace B viewing the app would get thumbnails for workspace A if those videos aren't in the default workspace. |
| **Admin secret as primary auth** | Admin secret always targets `DEFAULT_WORKSPACE_ID`. Cannot use admin secret to target a different workspace. |
| **Fresh SaaS onboarding** | New deploy with `.env.example` points at Nakie UUID. A new brand would need to change it to their workspace — but then admin secret and fallback would target that workspace. For true multi-tenant, we need JWT + workspace_members as the primary path. |

---

## Recommended semantics (documented, not enforced)

- **Local dev:** Set `DEFAULT_WORKSPACE_ID` to your dev workspace. Enables admin secret, fallback for `<img>`, and scripts.
- **Production single-tenant:** Same — one workspace, env points at it.
- **Production multi-tenant:** Prefer unset. Require JWT for all requests. Use cookies or signed URLs for media so `<img>` can work without fallback. Admin secret becomes dev-only or is removed.

---

## What was NOT found

- **recoverStaleScans** — Does not use `DEFAULT_WORKSPACE_ID` or `getDefaultWorkspaceId`. It updates all `scan_jobs` and `videos` globally by status.
- **Routers (admin, video)** — Use `ctx.workspaceId` from middleware. No direct `getDefaultWorkspaceId()` calls.
