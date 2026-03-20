# Phase 2: SaaS-Capable Auth & Workspace Membership

## Executive Summary

Phase 2 adds **Supabase Auth** and **workspace membership** so the app can serve multiple tenants with real user identity. The smallest correct path:

1. **Auth:** Supabase Auth (email/password). Session stored in Supabase client; JWT sent on every tRPC request.
2. **Membership:** New `workspace_members` table links `auth.users.id` to `workspaces.id` with a role.
3. **Workspace resolution:** Server resolves workspace from (a) JWT → `workspace_members`, or (b) `x-admin-secret` → `DEFAULT_WORKSPACE_ID` (local/internal fallback).
4. **Context:** tRPC context gains `userId`, `workspaceId`, `authMethod`. All workspace-scoped procedures use `ctx.workspaceId` instead of `getDefaultWorkspaceId()`.
5. **Frontend:** Login page, session persistence, optional workspace switcher (if user has multiple), and `Authorization: Bearer <token>` on tRPC links.

**Scope:** Auth + membership + workspace resolution. No queue architecture (Phase 3). No refactors beyond what’s needed for Phase 2.

---

## Phase 2 Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth provider | Supabase Auth | Already using Supabase; no extra infra |
| Auth flow | Email/password | Simplest; magic link can be added later |
| Session storage | Supabase client `getSession()` | Supabase handles refresh; no custom store |
| Auth header | `Authorization: Bearer <access_token>` | Standard; tRPC already sends headers |
| Admin fallback | `x-admin-secret` → `DEFAULT_WORKSPACE_ID` | Keeps scripts, local dev, and internal tools working |
| Workspace resolution | Single middleware | One place to resolve; procedures use `ctx` |
| Multi-workspace | `x-workspace-id` header override when user has multiple | Optional; can defer to “first workspace” for MVP |
| RLS | Supabase RLS on `workspace_members` | Optional; can defer to app-level checks for MVP |

---

## 1. Auth Model

### 1.1 Supabase Auth Flow

```text
1. User signs up: supabase.auth.signUp({ email, password })
2. User signs in: supabase.auth.signInWithPassword({ email, password })
3. Session: supabase.auth.getSession() → { data: { session } }
4. Access token: session.access_token (JWT)
5. Client sends: Authorization: Bearer <access_token> on every tRPC request
6. Server verifies: supabase.auth.getUser(access_token) → { data: { user } }
```

### 1.2 Smallest Correct Auth Flow

- **Sign up:** Email + password. No email confirmation for MVP (enable in Supabase Dashboard if needed).
- **Sign in:** Email + password. No OAuth for MVP.
- **Sign out:** `supabase.auth.signOut()`.

### 1.3 Auth State in the Client

- **Location:** Supabase Auth client (`supabase.auth.getSession()`).
- **Persistence:** Supabase stores session in `localStorage` by default.
- **Loading:** On app load, call `supabase.auth.getSession()` to restore session.
- **Token:** Use `session?.access_token` when creating tRPC headers.

### 1.4 Server Verification

```typescript
// In createContext or middleware
const authHeader = req.headers['authorization'];
const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

if (token) {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (!error && user) {
    ctx.userId = user.id;
    ctx.userEmail = user.email;
    // Resolve workspace from workspace_members
  }
}
```

---

## 2. Database Schema

### 2.1 New Migration: `docs/migrations/007-workspace-members.sql`

```sql
-- Phase 2: Workspace membership for SaaS auth
-- Run in Supabase SQL Editor before deploying Phase 2 code.
--
-- Links users (auth.users) to workspaces.
-- Supabase Auth creates auth.users; we reference it by id.

CREATE TABLE IF NOT EXISTS workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,  -- references auth.users(id)
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user
  ON workspace_members(user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace
  ON workspace_members(workspace_id);

-- Optional: RLS for workspace_members (defer to later if desired)
-- ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Users can read own memberships" ON workspace_members
--   FOR SELECT USING (auth.uid() = user_id);
```

### 2.2 Key Design

- **Primary key:** `id uuid` (single PK per row).
- **Composite unique:** `(workspace_id, user_id)` prevents duplicate memberships.
- **Indexes:** `user_id` for “resolve workspace for user”; `workspace_id` for “list members”.
- **Constraints:** `role` enum; `workspace_id` FK; `user_id` NOT NULL (no FK to `auth.users` to avoid schema coupling; Supabase manages auth.users).

### 2.3 Seed Data (Manual)

After migration, add a test user to the Nakie workspace:

```sql
-- Run after creating a user via Supabase Auth (Dashboard or signUp)
-- Replace <user-uuid> with auth.users.id
INSERT INTO workspace_members (workspace_id, user_id, role)
VALUES ('00000000-0000-0000-0000-000000000001', '<user-uuid>', 'owner')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
```

---

## 3. Server / tRPC Changes

### 3.1 Context Shape

**Current:** `{ adminSecret?: string }`

**Phase 2:** `{ adminSecret?: string; userId?: string | null; workspaceId: string; authMethod: 'admin_secret' | 'jwt' | 'fallback' }`

```typescript
// src/server/trpc.ts
export type Context = {
  adminSecret?: string;
  userId: string | null;
  workspaceId: string;
  authMethod: 'admin_secret' | 'jwt' | 'fallback';
};
```

### 3.2 Context Creation

```typescript
// In createContext — only extract headers; don't resolve workspace yet
export function createContext({ req }: CreateExpressContextOptions) {
  const adminSecret = (req.headers['x-admin-secret'] as string | undefined) ??
    (req.headers['authorization']?.startsWith('Bearer ') ? undefined : req.headers['authorization'] as string | undefined);
  const authHeader = req.headers['authorization'] as string | undefined;

  return {
    adminSecret: adminSecret ?? undefined,
    authHeader: authHeader ?? undefined,
  };
}
```

**Note:** Admin secret can be sent as `x-admin-secret` or as `Authorization: <secret>` (no "Bearer "). JWT is always `Authorization: Bearer <token>`.

### 3.3 Workspace Resolution Middleware

```typescript
const workspaceMiddleware = t.middleware(async ({ ctx, next }) => {
  let workspaceId: string | null = null;
  let userId: string | null = null;
  let authMethod: 'admin_secret' | 'jwt' | 'fallback' = 'fallback';

  const envAdminSecret = process.env['ADMIN_SECRET'];
  const envDefaultWorkspace = process.env['DEFAULT_WORKSPACE_ID'];

  // 1. Admin secret fallback (scripts, local dev)
  if (ctx.adminSecret && envAdminSecret && ctx.adminSecret === envAdminSecret) {
    workspaceId = envDefaultWorkspace ?? null;
    authMethod = 'admin_secret';
  }
  // 2. JWT — verify and resolve workspace from membership
  else if (ctx.authHeader?.startsWith('Bearer ')) {
    const token = ctx.authHeader.slice(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (!error && user) {
      userId = user.id;
      const { data: member } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (member) {
        workspaceId = member.workspace_id;
        authMethod = 'jwt';
      }
    }
  }

  // 3. Fallback for local dev (no auth, no admin secret)
  if (!workspaceId && envDefaultWorkspace) {
    workspaceId = envDefaultWorkspace;
    authMethod = 'fallback';
  }

  if (!workspaceId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No workspace. Sign in or provide admin secret.' });
  }

  return next({
    ctx: {
      ...ctx,
      userId,
      workspaceId,
      authMethod,
    },
  });
});
```

### 3.4 Procedure Types

| Procedure | Base | Use Case |
|-----------|------|----------|
| `publicProcedure` | No workspace | Health check, public config (if any) |
| `workspaceProcedure` | `workspaceMiddleware` | All workspace-scoped reads (video search, filters, stats) |
| `adminProcedure` | `workspaceMiddleware` + `adminMiddleware` | Admin-only: requires admin secret OR (future) role check |

**Admin middleware change:** Admin procedures should require either:
- `authMethod === 'admin_secret'`, OR
- `authMethod === 'jwt'` and `role IN ('owner','admin')` in workspace_members.

For MVP, keep current behavior: admin secret = full access. JWT users without admin secret can use workspace procedures but not admin procedures until admin middleware is updated.

**Simplest MVP:** Admin procedures use `adminMiddleware` that checks `adminSecret === envAdminSecret`. Workspace procedures use `workspaceProcedure` (resolve workspace from JWT or admin secret or fallback). Admin procedures also use `workspaceProcedure` so they get `ctx.workspaceId`.

---

## 4. Workspace Resolution Logic

### 4.1 Decision Tree

```
1. x-admin-secret present and matches ADMIN_SECRET?
   → workspaceId = DEFAULT_WORKSPACE_ID from env
   → authMethod = 'admin_secret'

2. Authorization: Bearer <token> present?
   → Verify JWT with supabase.auth.getUser(token)
   → If valid, query workspace_members WHERE user_id = user.id
   → If one row: workspaceId = that workspace_id, authMethod = 'jwt'
   → If multiple rows: use first, or x-workspace-id header to pick (optional)

3. No auth, no admin secret?
   → If DEFAULT_WORKSPACE_ID set: workspaceId = that, authMethod = 'fallback'
   → Else: throw UNAUTHORIZED
```

### 4.2 User Belongs to One Workspace

- Use the single `workspace_id` from `workspace_members`.

### 4.3 User Belongs to Multiple Workspaces

- **MVP:** Use the first row returned (e.g. `ORDER BY created_at ASC LIMIT 1`).
- **Later:** Add `x-workspace-id` header or `workspaceId` query param for client to choose; validate in middleware that user is a member.

### 4.4 No Workspace Membership

- `workspace_members` returns no rows → `workspaceId` stays null.
- If no admin secret and no fallback → throw `UNAUTHORIZED`.

### 4.5 Admin Secret Fallback

- When `x-admin-secret` matches `ADMIN_SECRET`, use `DEFAULT_WORKSPACE_ID` (same as Phase 1).
- No user lookup; `userId` stays null.

---

## 5. Route Changes

### 5.1 Routers/Procedures to Stop Using `getDefaultWorkspaceId()`

| File | Procedure(s) | Current | Phase 2 |
|------|--------------|---------|---------|
| `admin.ts` | getSettings, saveSettings, scanStatus, startScan, stopScan, syncShopify, validateMatches, pipelineStats | `getDefaultWorkspaceId()` | `ctx.workspaceId` |
| `video.ts` | search, filters, stats, getById, getVideoById | `getDefaultWorkspaceId()` | `ctx.workspaceId` |

### 5.2 Procedure Base Changes

| Router | Current | Phase 2 |
|--------|---------|---------|
| `admin.ts` | `adminProcedure` | `adminProcedure` = `workspaceProcedure.use(adminMiddleware)` |
| `video.ts` | `publicProcedure` | `workspaceProcedure` |

### 5.3 Files to Change

| File | Changes |
|------|---------|
| `docs/migrations/007-workspace-members.sql` | New migration |
| `src/server/trpc.ts` | Add workspace middleware; extend context; wire adminProcedure |
| `src/server/routers/admin.ts` | Replace all `getDefaultWorkspaceId()` with `ctx.workspaceId`; use `workspaceProcedure` |
| `src/server/routers/video.ts` | Replace all `getDefaultWorkspaceId()` with `ctx.workspaceId`; use `workspaceProcedure` |
| `src/lib/workspace.ts` | Keep `getDefaultWorkspaceId()` for server startup (recoverStaleScans) and scripts; or deprecate once env fallback is only in middleware |

### 5.4 Helpers That Receive workspaceId

- `getWorkspaceCredentials(workspaceId)` — unchanged; callers pass `ctx.workspaceId`.
- `saveWorkspaceConnection(workspaceId, ...)` — unchanged.
- `getActiveScanJob(workspaceId)` — unchanged.
- Scanner, shopify, colorwayValidator — receive `workspaceId` from router; no change to their signatures.

---

## 6. Frontend Changes

### 6.1 Minimum UI for Phase 2

1. **Login page** — Email + password form; calls `supabase.auth.signInWithPassword()`.
2. **Sign up page** — Email + password; calls `supabase.auth.signUp()`.
3. **Session loading** — On app init, `supabase.auth.getSession()`; if no session, redirect to login.
4. **Auth header** — tRPC `httpBatchLink` headers: `Authorization: Bearer ${session?.access_token}`.
5. **Workspace switcher** — Optional; only if user has multiple workspaces. MVP can skip.

### 6.2 Auth Flow

```
App loads
  → supabase.auth.getSession()
  → If session: render App, pass token to tRPC
  → If no session: render LoginPage
  → On login success: session stored; redirect to App
  → On logout: supabase.auth.signOut(); redirect to Login
```

### 6.3 Sending Auth to API

```typescript
// src/client/main.tsx (or a custom link)
httpBatchLink({
  url: '/api/trpc',
  transformer: superjson,
  async headers() {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {};
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    // Optional: keep admin secret for local dev
    const adminSecret = localStorage.getItem('adminSecret');
    if (adminSecret) {
      headers['x-admin-secret'] = adminSecret;
    }
    return headers;
  },
});
```

**Note:** `headers()` can be async; tRPC will await it. For `getSession()` to be async, the link must support it.

### 6.4 Files to Change

| File | Changes |
|------|---------|
| `src/client/main.tsx` | Add Supabase client; use session token in tRPC headers; optional auth guard |
| `src/client/App.tsx` | Wrap in auth check: if no session, show LoginPage |
| `src/client/components/LoginPage.tsx` | New: email/password form, sign in, sign up |
| `src/lib/supabase.ts` | Create browser Supabase client (or separate `supabaseClient.ts` for client) |

### 6.5 Client Supabase Instance

**Important:** Server uses `supabase` from `lib/supabase.ts` (anon key). Client needs its own Supabase client for Auth (same URL + anon key). Auth methods use the client; server uses `getUser(token)` for verification.

```typescript
// src/lib/supabaseClient.ts (for browser)
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to `.env` (Vite exposes `VITE_*` to client).

---

## 7. Exact Schema Changes

### 7.1 New Migration

**File:** `docs/migrations/007-workspace-members.sql`

```sql
-- Phase 2: Workspace membership for SaaS auth
-- Run in Supabase SQL Editor before deploying Phase 2 code.

CREATE TABLE IF NOT EXISTS workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user
  ON workspace_members(user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace
  ON workspace_members(workspace_id);
```

---

## 8. Exact Files Likely to Change

| File | Change Summary |
|------|----------------|
| `docs/migrations/007-workspace-members.sql` | New |
| `src/server/trpc.ts` | Add workspace middleware; extend context; wire procedures |
| `src/server/routers/admin.ts` | `getDefaultWorkspaceId()` → `ctx.workspaceId`; use `workspaceProcedure` |
| `src/server/routers/video.ts` | `getDefaultWorkspaceId()` → `ctx.workspaceId`; use `workspaceProcedure` |
| `src/lib/supabaseClient.ts` | New: browser Supabase client for Auth |
| `src/client/main.tsx` | Use session token in tRPC headers; optional auth guard |
| `src/client/App.tsx` | Auth check; show LoginPage when no session |
| `src/client/components/LoginPage.tsx` | New: login/signup form |
| `vite.config.ts` | Ensure env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| `.env.example` | Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

---

## 9. Recommended Implementation Order

1. **Day 1: Schema + server context**
   - Run `007-workspace-members.sql`
   - Add workspace middleware to `trpc.ts`
   - Update `admin.ts` and `video.ts` to use `ctx.workspaceId`
   - Test with existing `x-admin-secret` flow (should still work)

2. **Day 2: Supabase Auth + client**
   - Add `supabaseClient.ts` for browser
   - Create `LoginPage.tsx`
   - Update `main.tsx` to send `Authorization: Bearer <token>` when session exists
   - Add auth guard in `App.tsx` (redirect to login if no session)

3. **Day 3: Integration + seed**
   - Create a test user via Supabase Auth (Dashboard or signUp)
   - Seed `workspace_members` for that user + Nakie workspace
   - Test end-to-end: login → search → admin (with admin secret for admin)

4. **Day 4: Polish**
   - Admin procedures: decide whether JWT users with owner/admin role can use admin routes without admin secret
   - Handle logout, session expiry, refresh
   - Optional: workspace switcher if user has multiple

---

## 10. Risks / Edge Cases

| Risk | Mitigation |
|------|-------------|
| Session expiry mid-request | Supabase client refreshes; ensure server uses `getUser(token)` for verification |
| User has no workspace membership | Return UNAUTHORIZED; prompt to contact admin |
| Admin secret in production | Use only for scripts/internal tools; real users use JWT |
| CORS with credentials | Ensure `Authorization` header allowed in CORS config |
| Vite env vars | Use `VITE_SUPABASE_*`; server keeps `SUPABASE_*` |
| Multiple workspaces | MVP: use first; later: add `x-workspace-id` header |

---

## 11. What to Build First This Week

1. **Migration 007** — Run in Supabase.
2. **Workspace middleware** — Implement in `trpc.ts`; keep admin secret and fallback.
3. **Replace `getDefaultWorkspaceId()`** — In `admin.ts` and `video.ts` with `ctx.workspaceId`.
4. **Verify** — `x-admin-secret` flow still works; scripts unchanged.
5. **Login page** — Minimal UI; `signInWithPassword`; store session.
6. **tRPC headers** — Send `Authorization: Bearer <token>` when session exists.
7. **Auth guard** — Redirect to login when no session and no admin secret.
8. **Seed** — Add your test user to `workspace_members` for Nakie workspace.
9. **E2E test** — Login → search → admin (with admin secret).

---

## Appendix: Quick Reference

### Context Shape (Phase 2)

```typescript
type Context = {
  adminSecret?: string;
  authHeader?: string;
  userId: string | null;
  workspaceId: string;
  authMethod: 'admin_secret' | 'jwt' | 'fallback';
};
```

### Procedure Chain

```
workspaceProcedure = publicProcedure.use(workspaceMiddleware)
adminProcedure = workspaceProcedure.use(adminMiddleware)
```

### Admin Middleware (unchanged logic)

```typescript
const adminMiddleware = t.middleware(({ ctx, next }) => {
  const secret = process.env['ADMIN_SECRET'];
  if (!secret) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'ADMIN_SECRET not configured' });
  if (ctx.adminSecret !== secret) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid admin secret' });
  }
  return next({ ctx });
});
```

**Note:** Admin middleware currently checks `adminSecret`. For JWT-only admin access (no secret), you’d add a branch: if `authMethod === 'jwt'` and user has owner/admin role, allow. For MVP, keep admin secret requirement for admin procedures.
