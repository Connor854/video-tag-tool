# Phase 2C Implementation Plan

**Goal:** Fix build blockers, secure media routes, fix or deprecate `analyze-batch.ts`.

---

## 1. Phase 2C Validation

### Audit confirmation

| Audit item | Status | Notes |
|------------|--------|-------|
| `stream.pipeline` at line 126 | **Confirmed** | `extractThumbnailFromVideo` uses `pipeline(stream as any, ffmpeg.stdin)` with a Web `ReadableStream`; Node `pipeline` expects Node streams. The `pull` callback already writes to `ffmpeg.stdin`, so the pipeline is redundant and wrong. |
| `for await` at line 320 | **Confirmed** | `for await (const chunk of response.body)` — Web `ReadableStream` does not implement `Symbol.asyncIterator` in Node. |
| `/thumbnail/:driveFileId` unauthenticated | **Confirmed** | No auth or workspace check. Used by `VideoCard` via `<img src={thumbnailSrc} />` (no auth headers). |
| `/video/:driveFileId` unauthenticated | **Confirmed** | No auth or workspace check. **Note:** `VideoDetailModal` uses Google Drive embed (`drive.google.com/.../preview`) directly, not this route. The route exists but is a security gap if ever used. |
| `analyze-batch.ts` calls `startScan` without `jobId` | **Confirmed** | Script uses `getDefaultWorkspaceId()` and `startScan(workspaceId, { maxVideos, workers, queueOnly })` — no `jobId`. `startScan` throws if `jobId` is missing. |

### Adjustments

- **Thumbnail/video auth:** `<img>` and `<video>` tags do not send `Authorization` headers. The tRPC middleware falls back to `DEFAULT_WORKSPACE_ID` when no auth. We will use the same fallback for media routes: when no auth headers, resolve workspace as `DEFAULT_WORKSPACE_ID`. This keeps the current Nakie single-tenant flow working (thumbnails load) while adding a DB check that the video exists and belongs to the resolved workspace.
- **Video route usage:** The `/video/:driveFileId` route is not currently used by the client (VideoDetailModal embeds Drive directly). Securing it is still required for future use and defense in depth.

---

## 2. Implementation Plan

### Task 1: Fix `extractThumbnailFromVideo` (line 126)

**File:** `src/server/index.ts`

**Problem:** The code creates a Web `ReadableStream` whose `pull` callback reads from `response.body` and writes to `ffmpeg.stdin`, then incorrectly calls `pipeline(stream, ffmpeg.stdin)`. The Web stream is not a Node stream, and the `pull` already does the work.

**Fix:** Remove the `ReadableStream` and `pipeline`. Use a simple reader loop:

```typescript
const reader = response.body.getReader();
try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!ffmpeg.stdin.destroyed) {
      ffmpeg.stdin.write(Buffer.from(value));
    }
  }
} finally {
  if (!ffmpeg.stdin.destroyed) {
    ffmpeg.stdin.end();
  }
}
```

**Logic changes:**
- Delete the `ReadableStream` creation (lines 110–121).
- Delete the `pipeline` import and call (lines 124–125).
- Replace with the reader loop above, placed after `ffmpeg.stderr.on('error', ...)` and before the Promise resolves. The existing `ffmpeg.stderr.on('close', ...)` will resolve when ffmpeg finishes.

**Edge cases:**
- Ensure `ffmpeg.stdin.end()` is called so ffmpeg receives EOF.
- Handle early reader/ffmpeg errors — the existing `stderr.on('error')` and `resolve(null)` are sufficient.

---

### Task 2: Fix `response.body` streaming (line 320)

**File:** `src/server/index.ts`

**Problem:** `for await (const chunk of response.body)` fails because Web `ReadableStream` does not support `Symbol.asyncIterator` in Node.

**Fix:** Use `getReader()` and a while loop:

```typescript
if (response.body) {
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } finally {
    res.end();
  }
}
```

**Logic changes:**
- Replace the `for await` block (lines 317–323) with the reader loop.
- Ensure `res.end()` is called in `finally` so the response is always closed.

**Edge cases:**
- If `res` is already closed (e.g. client disconnect), `res.write` may throw. Wrapping in try/catch and calling `res.end()` in finally is sufficient; Express will handle closed sockets.

---

### Task 3: Add workspace check to `/thumbnail/:driveFileId`

**File:** `src/server/index.ts`

**New dependency:** Shared workspace resolution. Extract from `src/server/trpc.ts` into a reusable helper.

**New helper:** Create `src/server/resolveWorkspace.ts`:

```typescript
import type { Request } from 'express';
import { supabase } from '../lib/supabase.js';

export async function resolveWorkspaceFromRequest(
  req: Request,
): Promise<{ workspaceId: string } | null> {
  const xAdminSecret = req.headers['x-admin-secret'] as string | undefined;
  const authHeader = req.headers['authorization'] as string | undefined;
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : undefined;
  const adminSecret =
    xAdminSecret ?? (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader);

  const envAdminSecret = process.env['ADMIN_SECRET'];
  const envDefaultWorkspace = process.env['DEFAULT_WORKSPACE_ID'];

  if (adminSecret && envAdminSecret && adminSecret === envAdminSecret) {
    return envDefaultWorkspace ? { workspaceId: envDefaultWorkspace } : null;
  }

  if (bearerToken && bearerToken !== envAdminSecret) {
    const { data: { user }, error } = await supabase.auth.getUser(bearerToken);
    if (!error && user) {
      const { data: member } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (member) {
        return { workspaceId: member.workspace_id };
      }
    }
  }

  if (envDefaultWorkspace) {
    return { workspaceId: envDefaultWorkspace };
  }

  return null;
}
```

**Thumbnail route changes:**
- At the start of the handler (after `const { driveFileId } = req.params`), call `resolveWorkspaceFromRequest(req)`.
- If `null`, return `res.status(401).json({ error: 'No workspace. Sign in or provide admin secret.' })`.
- Before any Drive/ffmpeg work (and before the `seed_` placeholder branch), add:

```typescript
const { data: video, error } = await supabase
  .from('videos')
  .select('workspace_id')
  .eq('drive_id', driveFileId)
  .maybeSingle();

if (error || !video || video.workspace_id !== workspaceId) {
  return res.status(video ? 403 : 404).send(video ? 'Forbidden' : 'Not found');
}
```

- Place the workspace resolution and DB check **before** the `seed_` branch. Flow:
  1. Resolve workspace; if null → 401.
  2. Lookup video by `drive_id`; if no row → 404; if `workspace_id` mismatch → 403.
  3. If `driveFileId.startsWith('seed_')` → return placeholder SVG (existing logic).
  4. Else → proceed with Drive/ffmpeg.

**Schema/query:** `videos` has `drive_id` (unique) and `workspace_id`. No schema change.

---

### Task 4: Add workspace check to `/video/:driveFileId`

**File:** `src/server/index.ts`

**Logic:** Same pattern as thumbnail:
- Resolve workspace via `resolveWorkspaceFromRequest(req)`.
- Lookup `videos` by `drive_id = driveFileId`.
- If no row → 404.
- If `workspace_id !== workspaceId` → 403.
- For `seed_` files, the route already returns 404 — keep that, but add the DB check first. If it's a seed file not in the DB, we'd 404 at the lookup step anyway.

**Order:** Do the workspace resolution and DB check before any Drive API calls.

---

### Task 5: Fix `scripts/analyze-batch.ts`

**File:** `scripts/analyze-batch.ts`

**Options:**
- **A. Fix:** Create a `scan_jobs` row, pass `jobId` to `startScan`, and optionally check for an existing running job.
- **B. Deprecate:** Add a clear deprecation notice and point users to the Admin UI or a different script.

**Recommended: Fix (Option A)** — the script is useful for headless/CI runs.

**Changes:**
1. Replace `getDefaultWorkspaceId` with `process.env['DEFAULT_WORKSPACE_ID']` or keep `getDefaultWorkspaceId` (it reads from env).
2. Import `supabase` from `../src/lib/supabase.js`.
3. Before calling `startScan`:
   - Check for an existing running job: `getActiveScanJob(workspaceId)` — need to import from admin router or duplicate the query.
   - If running job exists, exit with a message.
   - Insert a new `scan_jobs` row with `workspace_id`, `status: 'running'`, `progress: 0`, `total: 0`, `workers`.
   - Get `job.id` and pass as `jobId` to `startScan`.
   - On `startScan` completion, the scanner calls `completeScanJob` or `failScanJob`. For script use, we need to handle errors: wrap `startScan` in try/catch and call `failScanJob` on throw.

**Simpler approach:** Import `getActiveScanJob` and `failScanJob` from `../src/server/routers/admin.js`. Duplicate the insert logic from the admin router's `startScan` mutation. This keeps the script self-contained and consistent with the API.

**Exact changes:**
```typescript
import { supabase } from '../src/lib/supabase.js';
import { getActiveScanJob, failScanJob } from '../src/server/routers/admin.js';
```

- Replace `getDefaultWorkspaceId()` with `getDefaultWorkspaceId()` (keep it) or use `process.env['DEFAULT_WORKSPACE_ID']` — if we use the env directly, we need to throw when missing. Keeping `getDefaultWorkspaceId` is fine.
- Before `startScan`:
  ```typescript
  const existingJob = await getActiveScanJob(workspaceId);
  if (existingJob) {
    console.error('Scan already in progress. Stop it from Admin UI first.');
    process.exit(1);
  }

  const { data: job, error } = await supabase
    .from('scan_jobs')
    .insert({
      workspace_id: workspaceId,
      status: 'running',
      progress: 0,
      total: 0,
      workers,
    })
    .select('id')
    .single();

  if (error || !job) {
    console.error('Failed to create scan job:', error);
    process.exit(1);
  }

  try {
    const result = await startScan(workspaceId, {
      maxVideos,
      workers,
      queueOnly: true,
      jobId: job.id,
    });
    // ... log result
  } catch (err) {
    await failScanJob(job.id, String(err));
    throw err;
  }
  ```

---

## 3. Task Ordering

| Order | Task | Rationale |
|-------|------|-----------|
| 1 | Fix pipeline (Task 1) | Unblocks build; no dependencies. |
| 2 | Fix for-await (Task 2) | Unblocks build; no dependencies. |
| 3 | Create `resolveWorkspaceFromRequest` | Required for Tasks 3 and 4. |
| 4 | Add workspace check to thumbnail (Task 3) | Depends on Task 3. |
| 5 | Add workspace check to video (Task 4) | Same pattern as thumbnail. |
| 6 | Fix analyze-batch (Task 5) | Independent; can be done in parallel with 3–5. |

**Recommended sequence:** 1 → 2 → 3 → 4 → 5 → 6. Run `npm run build` after 1 and 2 to confirm the build passes before adding auth logic.

---

## 4. Risks / Compatibility Notes

### Build fixes (Tasks 1–2)
- **Low risk.** The current code is broken; the fixes correct the implementation.
- **extractThumbnailFromVideo:** The ffmpeg fallback path (when Drive has no thumbnail) may be rarely used. Verifying manually after the fix is advisable.
- **Video route:** The `/video/:driveFileId` route may not be exercised by the current client. Manual test: `curl -o out.mp4 "http://localhost:3001/video/<valid-drive-id>"`.

### Media route security (Tasks 3–4)
- **Thumbnail:** `VideoCard` uses `<img src="/thumbnail/xxx" />`. Browsers do not send `Authorization` headers for `img` requests. The fallback to `DEFAULT_WORKSPACE_ID` when no auth ensures the current Nakie setup continues to work. All videos are in the default workspace, so thumbnails will load.
- **Multi-tenant limitation:** With multiple workspaces, a user in workspace B viewing the app would still get thumbnails resolved with `DEFAULT_WORKSPACE_ID` (fallback) because `img` does not send auth. Thumbnails for workspace B videos would 403 if those videos are not in the default workspace. **Future work:** Use cookies or signed URLs for media when multi-tenant is active.
- **Seed placeholders:** Seed videos (e.g. `drive_id = 'seed_xxx'`) must exist in `videos` with the correct `workspace_id`. The seed in `src/db/seed.ts` targets SQLite; Supabase seed may differ. Ensure any Supabase seed data sets `workspace_id` correctly.
- **404 vs 403:** We return 404 when the video is not in the DB (avoids leaking existence). We return 403 when the video exists but belongs to another workspace.

### analyze-batch (Task 5)
- **Risk:** The script creates a scan job and runs `startScan`. If the script is killed mid-run, the job stays `running`. The server's `recoverStaleScans` on startup will mark it `failed`. Acceptable.
- **getDefaultWorkspaceId:** The script continues to use `getDefaultWorkspaceId()`, which reads `DEFAULT_WORKSPACE_ID` from env. No change to that behavior.

---

## 5. First Build Prompt

Use this prompt to start Phase 2C implementation:

---

**Phase 2C Implementation – First Build**

Implement Phase 2C per `docs/PHASE2C_IMPLEMENTATION_PLAN.md`. Do the following in order:

1. **Fix `extractThumbnailFromVideo`** in `src/server/index.ts`: Remove the `ReadableStream` and `pipeline` usage. Replace with a `response.body.getReader()` loop that reads chunks and writes to `ffmpeg.stdin`, then calls `ffmpeg.stdin.end()` when done.

2. **Fix the video streaming** in `src/server/index.ts` (around line 320): Replace `for await (const chunk of response.body)` with a `getReader()` + while loop that reads from `response.body` and writes to `res`, then calls `res.end()` in a `finally` block.

3. **Create `src/server/resolveWorkspace.ts`**: Extract workspace resolution logic (admin secret, JWT via `supabase.auth.getUser`, fallback to `DEFAULT_WORKSPACE_ID`) into `resolveWorkspaceFromRequest(req: Request)` returning `Promise<{ workspaceId: string } | null>`.

4. **Add workspace check to `/thumbnail/:driveFileId`**: Resolve workspace; if null, return 401. Lookup `videos` by `drive_id`; if no row, 404; if `workspace_id` mismatch, 403. Then proceed with existing thumbnail logic (including `seed_` placeholder).

5. **Add workspace check to `/video/:driveFileId`**: Same pattern — resolve workspace, lookup video, 401/403/404 as appropriate, then stream.

6. **Fix `scripts/analyze-batch.ts`**: Create a `scan_jobs` row before calling `startScan`, pass `jobId`, and handle errors with `failScanJob`. Check for an existing running job and exit if one exists.

After each step, run `npm run build` to ensure the project compiles. Do not change the tRPC middleware; only add the new `resolveWorkspaceFromRequest` helper.

---
