# Phase 2: Manual Steps (Outside Repo)

These steps must be done manually. Claude cannot access your Supabase project.

---

## 1. Run Migration 007

In **Supabase Dashboard** → **SQL Editor**, run:

```sql
-- Phase 2: Workspace membership for SaaS auth
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

## 2. Add Client Env Vars

In your `.env` file, add (use same values as `SUPABASE_URL` and `SUPABASE_ANON_KEY`):

```
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

---

## 3. Create a Test User

**Option A: Supabase Dashboard**
- Go to **Authentication** → **Users** → **Add user**
- Enter email and password
- Copy the user's UUID (e.g. `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)

**Option B: Sign up via app**
- Start the app, go to Login page
- Use "Or use admin secret" to enter admin secret and continue
- (Sign up UI not implemented yet — use Dashboard for now)

---

## 4. Seed workspace_members

In **Supabase SQL Editor**, run (replace `<USER_UUID>` with the user's ID from step 3):

```sql
INSERT INTO workspace_members (workspace_id, user_id, role)
VALUES ('00000000-0000-0000-0000-000000000001', '<USER_UUID>', 'owner')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
```

---

## 5. Verify Auth End-to-End

1. **Admin secret flow (unchanged):**
   ```bash
   npm run dev
   ```
   - Open app, click "Or use admin secret", enter your `ADMIN_SECRET`
   - Click Continue — should see search UI
   - Go to Admin, verify settings load

2. **JWT flow:**
   - Clear localStorage (or use incognito)
   - Reload — should see Login page
   - Sign in with the user from step 3
   - Should see search UI; tRPC requests send `Authorization: Bearer <token>`
   - Server resolves workspace from `workspace_members`

3. **Fallback (no auth):**
   - With `DEFAULT_WORKSPACE_ID` in `.env`, requests with no headers use that workspace
   - Local dev without login or admin secret still works
