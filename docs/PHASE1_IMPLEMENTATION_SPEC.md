# Phase 1 Implementation Spec — Durable Scan Progress

## 1. SQL Migration: 006-scan-jobs

**File:** `docs/migrations/006-scan-jobs.sql`

```sql
-- Phase 1: Durable Scan Progress
-- Run this in the Supabase SQL Editor before deploying Phase 1 code.
--
-- Creates scan_jobs table to persist scan run metadata.
-- The videos table remains the queue; scan_jobs tracks run-level progress.

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

---

## 2. TypeScript Types

**File:** `src/shared/types.ts`

Add after `ScanStatus` (around line 114):

```typescript
/** DB row for scan_jobs table. */
export interface ScanJob {
  id: string;
  workspace_id: string;
  status: 'running' | 'completed' | 'aborted' | 'failed';
  progress: number;
  total: number;
  current_file: string | null;
  error_message: string | null;
  workers: number;
  started_at: string;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Input for creating a new scan job. */
export interface ScanJobInsert {
  workspace_id: string;
  status: 'running';
  progress: number;
  total: number;
  workers: number;
}
```

Keep `ScanStatus` unchanged — it remains the API response shape. `scanStatus` and `pipelineStats` will map `ScanJob` → `ScanStatus` when returning to the client.

---

## 3. Files and Functions to Change

### 3.1 `src/server/routers/admin.ts`

| Location | Current | Replacement |
|----------|---------|-------------|
| Lines 7–19 | `let scanStatus`, `updateScanStatus()`, `getScanStatus()` | Remove. Add `getActiveScanJob()`, `updateScanJobProgress()`, `completeScanJob()`, `failScanJob()`. |
| Line 137 | `scanStatus: publicProcedure.query(() => scanStatus)` | Query `scan_jobs` for active job, map to `ScanStatus`. |
| Lines 149–151 | `if (scanStatus.isScanning)` | `const job = await getActiveScanJob(workspaceId); if (job)` |
| Lines 158–168 | `startScan(workspaceId, {...})` | Insert `scan_jobs` row (`workspace_id`, `status='running'`, `progress=0`, `total=0`, `workers`), get `id` from `.select('id').single()`, pass `jobId` to `startScan(workspaceId, { ...input, jobId })`. On catch: `failScanJob(jobId, err)`. |
| Lines 173–176 | `if (!scanStatus.isScanning)` | `const job = await getActiveScanJob(workspaceId); if (!job)` |
| Line 325 | `const currentScanStatus = getScanStatus()` | `const job = await getActiveScanJob(workspaceId);` then map to `ScanStatus`. |

**New functions to add:**

```typescript
async function getActiveScanJob(workspaceId: string): Promise<ScanJob | null> {
  const { data, error } = await supabase
    .from('scan_jobs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as ScanJob;
}

/** Map ScanJob to ScanStatus for API responses. */
function jobToScanStatus(job: ScanJob | null): ScanStatus {
  if (!job) {
    return { isScanning: false, progress: 0, total: 0 };
  }
  return {
    isScanning: job.status === 'running',
    progress: job.progress,
    total: job.total,
    currentFile: job.current_file ?? undefined,
    error: job.error_message ?? undefined,
  };
}

export async function updateScanJobProgress(
  jobId: string,
  opts: { progress: number; total?: number; currentFile?: string },
): Promise<void> {
  const update: Record<string, unknown> = {
    progress: opts.progress,
    updated_at: new Date().toISOString(),
  };
  if (opts.total != null) update.total = opts.total;
  if (opts.currentFile != null) update.current_file = opts.currentFile;
  await supabase
    .from('scan_jobs')
    .update(update)
    .eq('id', jobId)
    .eq('status', 'running');
}

export async function completeScanJob(jobId: string, progress: number): Promise<void> {
  await supabase
    .from('scan_jobs')
    .update({
      status: 'completed',
      progress,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

export async function failScanJob(jobId: string, errorMessage: string): Promise<void> {
  await supabase
    .from('scan_jobs')
    .update({
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

export async function abortScanJob(jobId: string, progress: number): Promise<void> {
  await supabase
    .from('scan_jobs')
    .update({
      status: 'aborted',
      progress,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', 'running');
}
```

### 3.2 `src/services/scanner.ts`

| Location | Current | Replacement |
|----------|---------|-------------|
| Line 7 | `import { updateScanStatus } from '../server/routers/admin.js'` | `import { updateScanJobProgress, completeScanJob, abortScanJob } from '../server/routers/admin.js'` |
| `ScanOptions` interface | — | Add `jobId?: string` |
| Line 913 | `updateScanStatus({ isScanning: true, ... })` | Remove. Job created in admin router before `startScan` is called. |
| Line 938 | `updateScanStatus({ total: totalToProcess })` | `updateScanJobProgress(jobId, { progress: 0, total: totalToProcess })` |
| Line 1063 | `updateScanStatus({ progress: analyzed + errors + 1, currentFile: video.name })` | `updateScanJobProgress(jobId, { progress: analyzed + errors + 1, currentFile: video.name })` |
| Line 1184 | `updateScanStatus({ isScanning: false, progress: analyzed + errors })` | `if (scanAborted) abortScanJob(jobId, analyzed + errors); else completeScanJob(jobId, analyzed + errors)` |
| admin catch (line 166) | `updateScanStatus({ isScanning: false, error })` | `failScanJob(jobId, error)` — admin router handles this |

**Scanner `startScan` signature change:**

```typescript
export async function startScan(
  workspaceId: string,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const { maxVideos = 0, workers = DEFAULT_ANALYSIS_WORKERS, queueOnly = false, jobId } = options;
  if (!jobId) throw new Error('jobId is required');
  // ... rest unchanged, but replace updateScanStatus with updateScanJobProgress/completeScanJob
}
```

### 3.3 `src/server/index.ts`

Add startup recovery. Import supabase and call recovery after `initDriveAuth`:

```typescript
import { supabase } from '../lib/supabase.js';

async function recoverStaleScans(): Promise<void> {
  const { data: staleJobs } = await supabase
    .from('scan_jobs')
    .update({
      status: 'failed',
      error_message: 'Server restart',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'running')
    .select('id');

  const { data: staleVideos } = await supabase
    .from('videos')
    .update({ status: 'reanalysis_needed' })
    .eq('status', 'analyzing')
    .select('id');

  if (staleVideos?.length) {
    console.log(`Recovery: reset ${staleVideos.length} stale analyzing videos to reanalysis_needed`);
  }
}

app.listen(PORT, async () => {
  await initDriveAuth();
  await recoverStaleScans();
  console.log(`Server running on http://localhost:${PORT}`);
});
```

---

## 4. Startup Recovery Logic (Exact)

**File:** `src/server/index.ts`

**Placement:** Call `recoverStaleScans()` inside the `app.listen` callback, after `initDriveAuth()`, before `console.log`.

**Logic:**

1. Update all `scan_jobs` with `status = 'running'` to `status = 'failed'`, `error_message = 'Server restart'`, `completed_at = now()`.
2. Update all `videos` with `status = 'analyzing'` to `status = 'reanalysis_needed'`.
3. Log count of reset videos if any.

**No workspace scoping** for Phase 1 (single workspace). Both operations apply to all rows.

---

## 5. Script Changes: Remove Hardcoded ADMIN_SECRET

### 5.1 `scripts/restart-scan.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 21 | `headers: { 'x-admin-secret': 'mysecret123' }` | `headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' }` |
| 35 | `headers: { 'x-admin-secret': 'mysecret123', ... }` | `headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '', ... }` |
| 43 | `headers: { 'x-admin-secret': 'mysecret123' }` | `headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' }` |

Add at top (after `import 'dotenv/config'`): scripts already use dotenv, so `process.env.ADMIN_SECRET` will be loaded from `.env`.

### 5.2 `scripts/validation-monitor.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 3 | `const ADMIN_SECRET = 'mysecret123';` | `const ADMIN_SECRET = process.env.ADMIN_SECRET ?? '';` |

### 5.3 `scripts/validation-10min.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 3 | `const ADMIN_SECRET = 'mysecret123';` | `const ADMIN_SECRET = process.env.ADMIN_SECRET ?? '';` |

### 5.4 `scripts/pre-validation.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 25 | `headers: { 'x-admin-secret': 'mysecret123' }` | `headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' }` |

### 5.5 `scripts/reset-and-baseline.ts`

| Line | Current | Replacement |
|------|---------|-------------|
| 10 | `headers: { 'x-admin-secret': 'mysecret123' }` | `headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' }` |

### 5.6 `scripts/debug-completions.ts`

| Lines | Current | Replacement |
|-------|---------|-------------|
| 43–44 | `headers: { 'x-admin-secret': 'mysecret123' }` | `headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' }` |
| 51–52 | Same | Same |

---

## 6. Step-by-Step Implementation Order

| Step | Action | Files |
|------|--------|-------|
| 1 | Create migration `006-scan-jobs.sql` and run it in Supabase SQL Editor | `docs/migrations/006-scan-jobs.sql` |
| 2 | Add `ScanJob`, `ScanJobInsert` to `src/shared/types.ts` | `src/shared/types.ts` |
| 3 | Add `getActiveScanJob`, `jobToScanStatus`, `updateScanJobProgress`, `completeScanJob`, `failScanJob` to admin router | `src/server/routers/admin.ts` |
| 4 | Remove in-memory `scanStatus`, `updateScanStatus`, `getScanStatus` from admin router | `src/server/routers/admin.ts` |
| 5 | Change `scanStatus` procedure to read from `scan_jobs` via `getActiveScanJob` + `jobToScanStatus` | `src/server/routers/admin.ts` |
| 6 | Change `startScan` mutation: check `getActiveScanJob` instead of `scanStatus.isScanning`; insert `scan_jobs` row; pass `jobId` to `startScan()`; on catch call `failScanJob` | `src/server/routers/admin.ts` |
| 7 | Change `stopScan` mutation: check `getActiveScanJob` instead of `scanStatus.isScanning` | `src/server/routers/admin.ts` |
| 8 | Change `pipelineStats`: use `getActiveScanJob` + `jobToScanStatus` instead of `getScanStatus` | `src/server/routers/admin.ts` |
| 9 | Add `jobId` to `ScanOptions` in scanner; require `jobId` in `startScan` | `src/services/scanner.ts` |
| 10 | Replace `updateScanStatus` import with `updateScanJobProgress`, `completeScanJob` | `src/services/scanner.ts` |
| 11 | Replace all `updateScanStatus` calls in scanner with `updateScanJobProgress` or `completeScanJob` | `src/services/scanner.ts` |
| 12 | Add `recoverStaleScans` and call it on server startup | `src/server/index.ts` |
| 13 | Update all 6 scripts to use `process.env.ADMIN_SECRET` | `scripts/*.ts` |
| 14 | Run tests from checklist | — |

---

## 7. Test Checklist

### 7.1 Start scan

- [ ] Run `npm run dev`. Ensure server starts.
- [ ] Open Admin page, enter admin secret, click "Start Scan".
- [ ] Verify `scanStatus` returns `isScanning: true`, `progress` ≥ 0, `total` > 0.
- [ ] Verify `scan_jobs` has one row with `status = 'running'` for the workspace.
- [ ] Verify `pipelineStats` returns `isScanning: true`, `scanProgress`, `scanTotal`, `scanCurrentFile`.

### 7.2 Monitor progress

- [ ] While scan runs, poll `admin.scanStatus` every 10s.
- [ ] Verify `progress` increases over time.
- [ ] Verify `currentFile` updates to the video being processed.
- [ ] Verify PipelineMonitor UI shows progress bar and current file.

### 7.3 Kill server mid-scan

- [ ] Start a scan. Wait until `progress` ≥ 2.
- [ ] Kill the server process (Ctrl+C or `kill <pid>`).
- [ ] Verify `videos` has rows with `status = 'analyzing'` (stuck).
- [ ] Verify `scan_jobs` has one row with `status = 'running'` (orphaned).

### 7.4 Restart server

- [ ] Restart server with `npm run dev`.
- [ ] Check server logs for: `Recovery: reset N stale analyzing videos to reanalysis_needed` (N > 0).

### 7.5 Verify stale analyzing rows recovered

- [ ] After restart, run: `npx tsx scripts/quick-counts.ts`
- [ ] Verify `analyzing` count is 0.
- [ ] Verify `reanalysis_needed` increased by the number of previously stuck videos.
- [ ] Query `videos` for `status = 'analyzing'`: expect 0 rows.

### 7.6 Verify scan_jobs status correct

- [ ] Query `scan_jobs` for the orphaned job: `status` should be `'failed'`, `error_message` = `'Server restart'`, `completed_at` set.
- [ ] No rows with `status = 'running'`.

### 7.7 Verify new scan can start

- [ ] After recovery, start a new scan from Admin UI.
- [ ] Verify scan starts successfully.
- [ ] Verify progress updates and eventually completes or can be stopped.

### 7.8 Scripts use ADMIN_SECRET from env

- [ ] Set `ADMIN_SECRET=testsecret` in `.env`.
- [ ] Run `npx tsx scripts/restart-scan.ts` (with server running).
- [ ] Verify it fails with 401 if server expects different secret.
- [ ] Set `ADMIN_SECRET=mysecret123` (or match server) and verify script works.
