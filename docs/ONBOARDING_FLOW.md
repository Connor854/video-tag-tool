# Fresh Workspace Onboarding — Current Manual Path

This document describes the **actual current implementation** for onboarding a new workspace. It is grounded in the codebase as it exists today, not the intended future state.

---

## 1. How a workspace is created today

**Manual SQL only.** There is no UI or API to create a workspace.

Migration 003 seeds one workspace (Nakie) with a fixed UUID. To create a **second** workspace:

```sql
INSERT INTO workspaces (id, name, slug)
VALUES (gen_random_uuid(), 'Your Brand', 'your-brand-slug');
```

Copy the generated `id` — you will need it for the next steps and for `DEFAULT_WORKSPACE_ID` if using admin-secret flow.

---

## 2. How a user is attached to that workspace

**Manual SQL only.** There is no sign-up UI. Users are created in Supabase Auth (Dashboard or API), then linked to a workspace.

1. **Create user in Supabase Auth**
   - Dashboard → Authentication → Users → Add user (email + password), or
   - Use Supabase Auth API to sign up (no in-app sign-up UI yet).

2. **Copy the user's UUID** from the Auth user record.

3. **Insert into workspace_members:**
   ```sql
   INSERT INTO workspace_members (workspace_id, user_id, role)
   VALUES ('<YOUR_WORKSPACE_UUID>', '<AUTH_USER_UUID>', 'owner')
   ON CONFLICT (workspace_id, user_id) DO NOTHING;
   ```

**Important:** Workspace resolution uses the **first** workspace membership (by `created_at`) when a user has multiple workspaces. There is no workspace switcher.

---

## 3. Required env vars and credentials

### Server (.env)

| Variable | Required for | Notes |
|----------|--------------|-------|
| `SUPABASE_URL` | All | Supabase project URL |
| `SUPABASE_ANON_KEY` | All | Supabase anon key |
| `ADMIN_SECRET` | Admin operations | Used for admin-secret auth and `saveSettings` |
| `DEFAULT_WORKSPACE_ID` | Fallback when no auth | When unset and no JWT/admin-secret, requests fail with 401. When set, unauthenticated requests and admin-secret requests use this workspace. Also used by scripts via `getDefaultWorkspaceId()`. See `docs/DEFAULT_WORKSPACE_ID_SEMANTICS.md` for full semantics. |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Thumbnail/video proxy | Path to JSON file or inline JSON. Used by `/thumbnail` and `/video` routes. **Not** used by scanner — scanner uses workspace_connections. |
| `GEMINI_API_KEY` | (fallback) | Scanner prefers `workspace_connections`; env is fallback if workspace has no Gemini connection. |

### Client (.env)

| Variable | Required for | Notes |
|----------|--------------|-------|
| `VITE_SUPABASE_URL` | Browser auth | Same as SUPABASE_URL |
| `VITE_SUPABASE_ANON_KEY` | Browser auth | Same as SUPABASE_ANON_KEY |

### Workspace-specific (saved via Admin UI → workspace_connections)

These are stored per workspace in `workspace_connections` when the user saves settings:

- **Google Drive:** `service_account_key` (credentials), `folder_id` (metadata)
- **Gemini:** `api_key` (credentials)
- **Shopify:** `store_url` (metadata), `client_id` + `client_secret` (credentials), or `access_token` (legacy)

---

## 4. How Shopify sync currently works

1. User goes to **Admin** (requires admin secret or JWT with workspace membership).
2. User enters **Shopify Store URL** (e.g. `your-store.myshopify.com`).
3. User enters **Shopify Client ID** and **Client Secret** (from Shopify Dev Dashboard), or a legacy **Access Token**.
4. User clicks **Save Settings** → credentials are stored in `workspace_connections` for that workspace.
5. User clicks **Sync Shopify** → `syncShopify` tRPC mutation runs.
6. `syncShopifyProducts()` in `shopify.ts` fetches products from Shopify API and **upserts** into `products` table by `shopify_variant_id`.
7. Each variant becomes a row: `name`, `base_product`, `category`, `colorway`, `price`, `tags`, `shopify_product_id`, `shopify_variant_id`, `image_url`, `active`, `workspace_id`.

**No review step.** Products go directly into the table. The analyzer uses all active products in that workspace as the product context for video analysis.

---

## 5. Where products end up

- **Table:** `products`
- **Scoped by:** `workspace_id`
- **Used by:** Analyzer (`getProductContextForWorkspace`), scanner matching (`getRefProducts`), filters, search
- **Source:** Shopify sync (or manual SQL / `scripts/seed-products.ts` for legacy)

---

## 6. What is required before scanning can work

The scanner (`startScan` → `startScan` in scanner.ts) requires:

1. **Google Drive:** `googleServiceAccountKey` and `googleDriveFolderId` in `workspace_connections` (or env fallback).
2. **Gemini:** `geminiApiKey` in `workspace_connections` (or env fallback).
3. **Products (optional but recommended):** At least one row in `products` for that workspace. If empty, analysis runs with empty product context — Gemini will not suggest product names, and `matchProducts` will not create video_products rows.

**Recommended order:** Sync Shopify first (to populate products), then run scan.

---

## 7. How a first scan is triggered today

1. User goes to **Admin**.
2. User clicks **Start Scan** (or "Scan" button).
3. `startScan` tRPC mutation runs:
   - Checks for existing running job for that workspace.
   - Inserts a row into `scan_jobs`.
   - Calls `startScan(workspaceId, { jobId, ... })` in scanner (fire-and-forget).
4. Scanner:
   - If not `queueOnly`: syncs Drive files → triages → analyzes.
   - If `queueOnly`: skips sync/triage, processes existing `triaged` / `reanalysis_needed` videos.
5. Progress is shown in Admin via `scanStatus` query.

**Alternative:** `npx tsx scripts/analyze-batch.ts` — uses `DEFAULT_WORKSPACE_ID` from env, creates a scan job, runs analysis. Targets one workspace only.

---

## 8. Current gaps vs. intended Shopify → review → scan flow

| Gap | Current state | Intended state |
|-----|---------------|----------------|
| **No product catalog UI** | No way to view, edit, or approve products after Shopify sync. Products go straight into the table. | User should review imported catalog, edit names/categories, add manual products, mark archived, add aliases. |
| **No approval gate** | All products in `products` with `active = true` are used for analysis. No "pending review" or "approved" status. | Products should be approved before they become the analysis reference. |
| **No workspace creation UI** | Workspaces and workspace_members are created via manual SQL. | Self-serve sign-up and workspace creation (or invite flow). |
| **Media routes use env Drive** | `/thumbnail` and `/video` use `GOOGLE_SERVICE_ACCOUNT_KEY` from env — one Drive for the whole app. | Should be workspace-scoped when workspaces have different Drive credentials. |
| **Admin secret → default workspace** | Admin secret always resolves to `DEFAULT_WORKSPACE_ID`. Cannot target a different workspace with admin secret. | Admin secret may need workspace targeting, or admin secret is dev-only. |
| **No sign-up UI** | Users are created in Supabase Dashboard. | In-app sign-up. |

---

## DEFAULT_WORKSPACE_ID — when and where it applies

`DEFAULT_WORKSPACE_ID` is a fallback used when the server cannot resolve a workspace from request context:

- **Admin secret:** Always resolves to `DEFAULT_WORKSPACE_ID` (cannot target a different workspace).
- **No auth headers:** (e.g. `<img src="/thumbnail/xxx">`) Falls back to `DEFAULT_WORKSPACE_ID` when set.
- **Scripts:** `getDefaultWorkspaceId()` reads it; scripts throw if unset.

For a full audit of usages and long-term recommendations, see `docs/DEFAULT_WORKSPACE_ID_SEMANTICS.md`.

---

## Quick reference: minimal path for a fresh workspace

1. Run migrations 001–007 (including 003 for workspaces, 007 for workspace_members).
2. `INSERT INTO workspaces` for your new workspace.
3. Create user in Supabase Auth.
4. `INSERT INTO workspace_members` linking user to workspace.
5. Set `.env`: `SUPABASE_*`, `ADMIN_SECRET`, `VITE_SUPABASE_*`, optionally `DEFAULT_WORKSPACE_ID` for fallback.
6. Sign in with that user (JWT flow) or use admin secret with `DEFAULT_WORKSPACE_ID` pointing to your workspace.
7. Go to Admin → Save Settings: Gemini API key, Google Drive (service account JSON + folder ID), Shopify (store URL + client ID/secret).
8. Click **Sync Shopify** to populate products.
9. Click **Start Scan** to run first scan.
