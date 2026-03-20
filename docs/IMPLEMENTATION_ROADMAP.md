# Nakie Video Search — Implementation Roadmap

## Executive Summary

The current app is a single-tenant prototype with in-memory scan state and in-process workers. This roadmap moves it to a durable, multi-tenant SaaS in three phases:

- **Phase 1 (Durability):** Persist scan progress in the DB, survive restarts, no new infra.
- **Phase 2 (SaaS-ready):** Add Supabase Auth, workspace membership, request-scoped workspace resolution.
- **Phase 3 (Scale):** Extract workers to a job queue (BullMQ + Redis), enable horizontal scaling.

**Shortest path:** Phase 1 first (1–2 days), then Phase 2 (3–5 days). Phase 3 can wait until you need multiple workers or higher reliability.

---

## Phase 1: Durability

### Goals

1. Scan progress survives server restarts.
2. On startup, stuck `analyzing` videos are reset to `reanalysis_needed`.
3. No new infrastructure (no Redis, no extra processes).
4. Scripts use `ADMIN_SECRET` from env instead of hardcoded values.

### Schema Changes

**New migration: `docs/migrations/006-scan-jobs.sql`**

```sql
-- One row per active or recent scan run.
-- The videos table remains the queue; this table tracks run metadata.
CREATE TABLE IF NOT EXISTS scan_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'aborted', 'failed')),
  progress integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  current_file text,
  error_message text,
  workers integer NOT NULL DEFAULT 3,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_jobs_workspace_status
  ON scan_jobs(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_scan_jobs_started
  ON scan_jobs(started_at DESC);
```

**Do you need `scan_job_items`?** No. The queue is still the `videos` table (`status IN ('triaged','reanalysis_needed')`). `scan_jobs` only stores run-level metadata (progress, total, current file). Item-level state lives in `videos.status`.

### Replacing In-Memory scanStatus

| Current | Replacement |
|---------|-------------|
| `let scanStatus: ScanStatus` in `admin.ts` | Read/write `scan_jobs` row for the active job |
| `updateScanStatus({ progress, currentFile })` | `UPDATE scan_jobs SET progress=..., current_file=... WHERE id=? AND status='running'` |
| `getScanStatus()` | `SELECT * FROM scan_jobs WHERE workspace_id=? AND status='running' ORDER BY started_at DESC LIMIT 1` |

**Flow:**

1. `startScan` inserts a `scan_jobs` row with `status='running'`, `progress=0`, `total=totalToProcess`.
2. Each worker, after claiming a video, calls `updateScanJobProgress(jobId, progress, currentFile)` instead of `updateScanStatus`.
3. When all workers exit, `UPDATE scan_jobs SET status='completed', completed_at=now(), progress=...`.
4. `scanStatus` and `pipelineStats` read from `scan_jobs` instead of in-memory state.

### Startup Recovery

**On server boot** (in `src/server/index.ts` after `app.listen`):

```typescript
async function recoverStaleScans() {
  // 1. Find any scan_jobs still 'running' (orphaned from a crash)
  const { data: staleJobs } = await supabase
    .from('scan_jobs')
    .update({ status: 'failed', error_message: 'Server restart', completed_at: new Date().toISOString() })
    .eq('status', 'running')
    .select('id, workspace_id');

  // 2. Reset videos stuck in 'analyzing' to 'reanalysis_needed'
  const { data: staleVideos } = await supabase
    .from('videos')
    .update({ status: 'reanalysis_needed' })
    .eq('status', 'analyzing')
    .select('id');

  if (staleVideos?.length) {
    console.log(`Recovery: reset ${staleVideos.length} stale analyzing videos to reanalysis_needed`);
  }
}
```

Call `recoverStaleScans()` once after DB is reachable.

### Files to Change

| File | Changes |
|------|---------|
| `docs/migrations/006-scan-jobs.sql` | New migration |
| `src/server/routers/admin.ts` | Remove in-memory `scanStatus`; add `getActiveScanJob()`, `updateScanJobProgress()`, `completeScanJob()`; `scanStatus` and `pipelineStats` read from DB |
| `src/services/scanner.ts` | Import `updateScanJobProgress`, `completeScanJob`; pass `jobId` into `startScan`; replace all `updateScanStatus` calls with DB updates |
| `src/server/index.ts` | Add `recoverStaleScans()` on startup |
| `scripts/restart-scan.ts` | Use `process.env.ADMIN_SECRET` instead of `'mysecret123'` |
| `scripts/validation-monitor.ts` | Same |
| `scripts/validation-10min.ts` | Same |
| `scripts/pre-validation.ts` | Same |
| `scripts/reset-and-baseline.ts` | Same |

### API Changes

- `admin.scanStatus` — returns data from `scan_jobs` (or empty when no active job).
- `admin.pipelineStats` — `scanProgress`, `scanTotal`, `scanCurrentFile`, `isScanning` from `scan_jobs`.
- `admin.startScan` — creates `scan_jobs` row, passes `jobId` to `startScan()`.

No breaking changes to the response shape; only the data source changes.

### Frontend Changes

None. `PipelineMonitor` and `AdminPage` already consume `scanStatus` and `pipelineStats`; they keep working.

### Risks

- Supabase `update` with `eq('status','running')` can race if two scans start (mitigation: `startScan` checks `scanStatus.isScanning` before creating job).
- Slightly more DB round-trips per video (one `UPDATE scan_jobs` per completion).

### Dependencies

- None. Uses existing Supabase.

---

## Phase 2: SaaS-Capable

### Goals

1. Users sign up / log in via Supabase Auth.
2. Users belong to workspaces via `workspace_members`.
3. Workspace is resolved from the request (JWT/session), not env.
4. Admin and video routes are scoped by the resolved workspace.

### Auth Model

**Use Supabase Auth.** You already have Supabase; Auth is built-in.

- Sign up: `supabase.auth.signUp({ email, password })`
- Sign in: `supabase.auth.signInWithPassword({ email, password })`
- Session: `supabase.auth.getSession()` returns `{ data: { session } }`
- JWT: Session includes `access_token`; verify on server via `supabase.auth.getUser(jwt)` or `jose` for custom verification.

**MVP flow:** User logs in → session stored in Supabase client → tRPC sends `Authorization: Bearer <access_token>` → server verifies JWT and extracts `user_id` → resolve workspace from `workspace_members`.

### Schema Changes

**New migration: `docs/migrations/007-auth-and-members.sql`**

```sql
-- Supabase Auth creates auth.users; we reference it.
-- For local dev, ensure auth.users exists (Supabase provides it).

-- Link users to workspaces. MVP: one workspace per user.
CREATE TABLE IF NOT EXISTS workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,  -- references auth.users(id) in Supabase
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user
  ON workspace_members(user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace
  ON workspace_members(workspace_id);

-- Backfill: create a system user or use existing auth user for Nakie workspace.
-- For MVP, you may seed one user and add them to the Nakie workspace manually.
```

**Optional:** Add `owner_id` to `workspaces` for billing/ownership. Can defer.

### Request-Based Workspace Resolution in tRPC

**Context shape:**

```typescript
// src/server/trpc.ts
export function createContext({ req }: CreateExpressContextOptions) {
  const authHeader = req.headers['authorization'] ?? req.headers['x-admin-secret'];
  return {
    authHeader: authHeader as string | undefined,
    // Resolved later in middleware
    userId: null as string | null,
    workspaceId: null as string | null,
  };
}
```

**Middleware:**

```typescript
// Option A: Resolve in a procedure middleware
const workspaceMiddleware = t.middleware(async ({ ctx, next }) => {
  let workspaceId: string | null = null;
  let userId: string | null = null;

  // 1. Try admin secret (backward compat for scripts / internal tools)
  const adminSecret = process.env['ADMIN_SECRET'];
  if (ctx.authHeader && adminSecret && ctx.authHeader === adminSecret) {
    workspaceId = getDefaultWorkspaceId(); // env fallback for admin
    userId = null; // no user for admin secret
  }
  // 2. Try JWT
  else if (ctx.authHeader?.startsWith('Bearer ')) {
    const token = ctx.authHeader.slice(7);
    const { data: { user } } = await supabase.auth.getUser(token);
    if (user) {
      userId = user.id;
      const { data: member } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .limit(1)
        .single();
      workspaceId = member?.workspace_id ?? null;
    }
  }

  return next({
    ctx: {
      ...ctx,
      userId,
      workspaceId: workspaceId ?? getDefaultWorkspaceId(), // fallback for local dev
    },
  });
});

export const workspaceProcedure = t.procedure.use(workspaceMiddleware);
```

**Usage:** Replace `getDefaultWorkspaceId()` in procedures with `ctx.workspaceId`. Admin procedures also use `workspaceProcedure` so they get `ctx.workspaceId` from the request.

### Files to Change

| File | Changes |
|------|---------|
| `docs/migrations/007-auth-and-members.sql` | New migration |
| `src/server/trpc.ts` | Add `workspaceMiddleware`, `workspaceProcedure` |
| `src/lib/workspace.ts` | Add `getWorkspaceForUser(userId)`, keep `getDefaultWorkspaceId()` for admin-secret fallback |
| `src/server/routers/admin.ts` | Use `ctx.workspaceId` instead of `getDefaultWorkspaceId()` |
| `src/server/routers/video.ts` | Same |
| `src/client/main.tsx` | Add auth provider; store session, send `Authorization: Bearer` |
| `src/client/App.tsx` | Add login/signup routes; protect admin route |
| `src/client/components/AdminPage.tsx` | Require auth; optionally workspace switcher (Phase 2.5) |

### API Changes

- All `admin.*` and `video.*` procedures require either valid JWT or valid `x-admin-secret`.
- `ctx.workspaceId` is set from `workspace_members` when JWT is used, or from env when admin secret is used.
- New procedures: `auth.signUp`, `auth.signIn`, `auth.signOut`, `auth.session` (or use Supabase client directly on frontend).

### Frontend Changes

- Login/signup page (or modal).
- Store Supabase session; on tRPC client, add `Authorization: Bearer ${session?.access_token}` to headers.
- Redirect unauthenticated users from `/admin` to login.
- Optional: workspace switcher dropdown in AdminPage (if user has multiple workspaces).

### Risks

- Migrating existing users: you need to create `auth.users` entries and `workspace_members` for current access. Manual seed or one-time script.
- Admin secret bypass: keep it for scripts; ensure it only works with `DEFAULT_WORKSPACE_ID` or a designated admin workspace.

### Dependencies

- Supabase Auth (already available with Supabase project).
- No new packages if you use `@supabase/supabase-js` for `getUser(jwt)`.

---

## Phase 3: Production-Scalable

### Goals

1. Workers run in a separate process (or multiple processes).
2. Job queue is durable (Redis).
3. API server only enqueues jobs; it does not run analysis.
4. Progress is still read from DB (`scan_jobs`).

### Recommended Queue Architecture

**BullMQ + Redis**

- **Redis:** Job queue backend. Use Upstash or self-hosted Redis.
- **BullMQ:** Node.js queue library. One queue: `video-analysis`.
- **Job payload:** `{ workspaceId, jobId }` — worker loads queue from `videos` table, processes, updates `scan_jobs`.

**Flow:**

1. API: `startScan` creates `scan_jobs` row, enqueues `{ workspaceId, jobId }` to BullMQ.
2. Worker process: Picks up job, runs the same `startScan` logic but in a separate Node process. Uses `scan_jobs` for progress.
3. Progress: Worker calls `updateScanJobProgress` (Supabase) after each video. UI polls `pipelineStats` which reads `scan_jobs`.

### What Stays in the API Server

- All tRPC routes (video, admin).
- `startScan` mutation: creates `scan_jobs` row, enqueues job to BullMQ, returns immediately.
- `stopScan`: sets `scanAborted` or a flag in `scan_jobs` that the worker checks.
- `pipelineStats`, `scanStatus`: read from `scan_jobs` (no change from Phase 1).
- Thumbnail/video proxy routes.
- Sync + triage: either stay in API (run before enqueue) or move to worker. **Recommendation:** Keep sync+triage in API; worker only does analysis. That way the queue is populated before the job runs.

### What Moves to Workers

- The entire analysis loop: `fetchQueueBatch`, `claimVideo`, `analyzeOneVideo`, worker/supervisor logic.
- New entry point: `src/workers/scan-worker.ts` (or `src/workers/index.ts`).
- Worker process: `tsx src/workers/scan-worker.ts` (or `node dist/workers/scan-worker.js`).
- Worker connects to Redis, processes `video-analysis` jobs, updates `scan_jobs` via Supabase.

### How Progress Is Reported to the UI

Same as Phase 1. The worker updates `scan_jobs.progress`, `scan_jobs.current_file` in Supabase. The UI polls `admin.pipelineStats` (or `admin.scanStatus`), which reads from `scan_jobs`. No WebSockets or push required.

### Files to Change

| File | Changes |
|------|---------|
| `package.json` | Add `bullmq`, `ioredis` |
| `src/server/routers/admin.ts` | `startScan` enqueues job instead of calling `startScan()` from scanner |
| `src/services/scanner.ts` | Extract `runAnalysisLoop(workspaceId, jobId, options)` — callable from worker |
| `src/workers/scan-worker.ts` | New: connect to Redis, process jobs, call `runAnalysisLoop` |
| `package.json` scripts | Add `dev:worker`, `start:worker` |
| `.env` | Add `REDIS_URL` |

### Schema Changes

None. `scan_jobs` from Phase 1 is sufficient.

### API Changes

- `startScan` returns immediately after enqueueing. `scanStatus`/`pipelineStats` reflect progress as the worker runs.
- `stopScan` sets `scan_jobs.status='aborted'` (or a flag); worker checks and exits gracefully.

### Frontend Changes

None. Polling already works.

### Risks

- Redis dependency: need Redis (Upstash, Railway, or self-hosted).
- Worker crash: BullMQ retries jobs. Ensure `analyzeOneVideo` is idempotent (claim is atomic).
- Multiple workers: BullMQ allows multiple consumers; each job is processed by one worker. For multiple videos per workspace, you can either enqueue one job per workspace (current design) or one job per video (more granular, more jobs).

### Dependencies

- Redis (Upstash recommended for serverless).
- `bullmq`, `ioredis`.

---

## Recommended Order of Implementation

| Order | Phase | Effort | Delivers |
|-------|-------|--------|----------|
| 1 | Phase 1 | 1–2 days | Durable scans, startup recovery |
| 2 | Phase 2 | 3–5 days | Multi-tenant, user auth |
| 3 | Phase 3 | 2–3 days | Scalable workers |

---

## What to Build First This Week

**Focus: Phase 1 only.**

1. **Day 1:** Create `006-scan-jobs.sql`, run it. Add `getActiveScanJob`, `updateScanJobProgress`, `completeScanJob` in admin router. Replace in-memory `scanStatus` with DB reads.
2. **Day 2:** Update `scanner.ts` to pass `jobId`, use `updateScanJobProgress`. Add `recoverStaleScans()` on server startup. Fix scripts to use `process.env.ADMIN_SECRET`. Test: start scan, kill server, restart, confirm recovery and that a new scan can run.

**Outcome:** Scans survive restarts. No new dependencies. Foundation for Phase 2 and 3.
