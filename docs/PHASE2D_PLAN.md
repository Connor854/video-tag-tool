# Phase 2D Plan: Remove Nakie-Specific Assumptions for Fresh SaaS Onboarding

**Goal:** Build toward a clean fresh-onboarding SaaS flow. Nakie's data will later be imported through the same standard onboarding/scanning/tagging pipeline as any other workspace. No separate legacy-import track.

---

## 1. Phase 2D Validation

### Exact Nakie-specific assumptions still present

| Category | Assumption | Files / Modules | Blocks fresh SaaS? |
|----------|------------|-----------------|-------------------|
| **Analysis logic** | Gemini prompts say "Nakie, an Australian eco-outdoor brand" | `src/services/geminiAnalyzer.ts` (lines 116, 234, 368) | **Yes** — prompts bias analysis toward Nakie |
| **Analysis logic** | Product context loaded from `data/nakie-products.json` (static file) | `src/services/geminiAnalyzer.ts` (lines 49–90, 66) | **Yes** — new workspace gets Nakie catalog in prompt |
| **Analysis logic** | `DEFAULT_RESULT.description` = "Video from the Nakie collection." | `src/services/geminiAnalyzer.ts` (line 234) | **Yes** — fallback text is brand-specific |
| **Workspace resolution** | `DEFAULT_WORKSPACE_ID` fallback when no auth | `src/server/trpc.ts`, `src/server/resolveWorkspace.ts` | **Yes** — assumes one default workspace |
| **Workspace resolution** | `.env.example` hardcodes Nakie workspace UUID | `.env.example` (line 13) | **Yes** — fresh deploy points at Nakie |
| **Scripts** | `getDefaultWorkspaceId()` in 20+ scripts | `scripts/*.ts` (analyze-batch, test-triage, sync-shopify, etc.) | **Partial** — scripts assume single workspace |
| **Migration** | Migration 003 seeds only Nakie workspace | `docs/migrations/003-workspace-scoping.sql` | **Yes** — no path to create a new workspace |
| **Migration** | Schema defaults to Nakie UUID | `docs/migrations/003-workspace-scoping.sql` (lines 63–68, 79–83, etc.) | **Partial** — backfill-only; new rows need explicit workspace |
| **Products** | `seed-products.ts` loads nakie-products.json | `scripts/seed-products.ts` | **Partial** — fresh workspace would use Shopify sync |
| **UI branding** | Header says "nakie" | `src/client/components/Header.tsx` (line 35) | No — cosmetic |
| **UI branding** | Footer says "Nakie Video Search · AI-Powered" | `src/client/components/Footer.tsx` (line 35) | No — cosmetic |
| **UI branding** | index.html title "Nakie Video Search · AI-Powered" | `index.html` (line 6) | No — cosmetic |
| **UI styling** | Tailwind colors nakie-teal, nakie-green | `tailwind.config.ts`, LoginPage, AdminPage, etc. | No — cosmetic (can keep as accent names) |
| **Video router** | `PRODUCT_FAMILIES` hardcoded to Nakie categories | `src/server/routers/video.ts` (lines 10–22) | **Partial** — affects filter labels; new brands may have different categories |
| **Shopify** | Comments reference Nakie patterns | `src/services/shopify.ts` (lines 254, 326) | No — comments only |
| **DB path** | `nakie.db` for SQLite | `src/db/index.ts`, legacy scripts | **Partial** — SQLite may be dev-only; Supabase is prod |
| **RPC defaults** | `get_filter_options`, `get_total_size_bytes` default to Nakie UUID | `docs/migrations/003-workspace-scoping.sql` (lines 126, 157) | No — callers pass workspace_id |

### Which truly block fresh SaaS onboarding vs cosmetic

**Blockers:**
- **geminiAnalyzer** — Prompts and product context are Nakie-specific. A new workspace running a scan would get Nakie product names and brand context in the AI prompt.
- **DEFAULT_WORKSPACE_ID fallback** — When no auth headers (e.g. `<img>`), workspace resolves to Nakie. A fresh tenant with no env set would fail; with env set to Nakie, they'd see Nakie data.
- **Migration 003** — Seeds only Nakie. No documented way to create a second workspace. Fresh SaaS needs: create workspace → add user to workspace_members → connect Drive/Shopify.
- **.env.example** — Points new deploys at Nakie workspace UUID.

**Foundational (architectural):**
- **getDefaultWorkspaceId()** — Scripts and some flows assume one workspace. For multi-tenant, scripts need workspace_id (env or arg).
- **No sign-up / no workspace creation** — User cannot self-serve. Requires manual Supabase + SQL. Phase 2D can document the minimal path without building full UI.

**Cosmetic:**
- UI branding (Header, Footer, title), tailwind color names, PROJECT.md, design.md, Shopify comments.

---

## 2. Recommended Phase 2D Scope

| # | Task | Type | Description |
|---|------|------|--------------|
| 1 | **Make Gemini prompts workspace-agnostic** | **Blocker** | Replace Nakie-specific prompts with generic brand-agnostic wording. Remove hardcoded "Nakie" and "Australian eco-outdoor brand". |
| 2 | **Load product context from workspace products table** | **Blocker** | `geminiAnalyzer` must accept `workspaceId` and build product context from `products` table (or empty string if none). Remove `data/nakie-products.json` from analysis path. |
| 3 | **Generic DEFAULT_RESULT description** | **Blocker** | Change "Video from the Nakie collection." to something generic (e.g. "Video from the collection."). |
| 4 | **Document workspace creation path** | **Foundational** | Add `docs/WORKSPACE_ONBOARDING.md` with exact SQL/steps to create a workspace, add user, connect Drive/Shopify. No code change yet. |
| 5 | **Update .env.example for fresh SaaS** | **Foundational** | Change comment and example to show `DEFAULT_WORKSPACE_ID` as optional; document that it's only for dev/admin-secret fallback when no JWT. |
| 6 | **Clarify DEFAULT_WORKSPACE_ID semantics** | **Foundational** | In trpc/resolveWorkspace: when `DEFAULT_WORKSPACE_ID` is unset and no auth, return 401 (no fallback). When set, use as fallback for local dev. Document this. |
| 7 | **Generic UI branding** | **Cleanup** | Replace "nakie" / "Nakie Video Search" in Header, Footer, index.html with generic "Video Search" or app name from env. |
| 8 | **PRODUCT_FAMILIES as config or generic** | **Defer** | Keep as-is for now. Later: load from workspace config or make generic. |
| 9 | **Scripts workspace_id via env** | **Defer** | Scripts continue using `getDefaultWorkspaceId()` (reads `DEFAULT_WORKSPACE_ID`). Document that scripts target one workspace. Defer workspace CLI arg. |
| 10 | **Migration 003: optional second workspace** | **Defer** | Keep migration as-is. New workspace creation is manual (doc in task 4). Defer migration change. |

### Order of implementation

1. **Task 1** — Gemini prompts generic (unblocks analysis for any brand)
2. **Task 2** — Product context from `products` table (unblocks analysis for workspaces with Shopify-synced products)
3. **Task 3** — DEFAULT_RESULT generic
4. **Task 4** — Document workspace onboarding
5. **Task 5** — .env.example update
6. **Task 6** — DEFAULT_WORKSPACE_ID semantics (optional; can defer if we keep fallback for now)
7. **Task 7** — UI branding cleanup

### Temporary compatibility to keep

- **DEFAULT_WORKSPACE_ID fallback** — Keep for local dev and admin-secret flows. When set, unauthenticated requests use it. When unset, require auth. This preserves Nakie during transition.
- **Migration 003 seeded workspace** — Keep. Nakie (or first tenant) uses it. New workspaces created manually.
- **getDefaultWorkspaceId() in scripts** — Keep. Scripts target the workspace in env. No change until we add workspace CLI arg.

---

## 3. Product Direction Check

**Is the codebase moving toward fresh-onboarding SaaS?**

**Partially.** The architecture is multi-tenant (workspace_id everywhere, workspace_members, workspace_connections). But:

1. **Analysis is Nakie-specific** — Gemini prompts and product context assume Nakie. A new brand running a scan would get wrong prompts and wrong product names. **Task 1–3 fix this.**

2. **No self-serve onboarding** — No sign-up, no workspace creation UI. Fresh tenant needs manual Supabase Auth user + manual workspace row + manual workspace_members + Admin UI to connect Drive/Shopify. **Task 4 documents this.** Full onboarding UI is out of Phase 2D scope.

3. **DEFAULT_WORKSPACE_ID assumes one tenant** — Env fallback is convenient for single-tenant (Nakie) but ambiguous for multi-tenant. **Task 5–6 clarify.** We can keep fallback for dev while documenting that production should use JWT.

4. **Products flow** — Scanner already uses `getRefProducts(workspaceId)` from `products` table. The gap is **geminiAnalyzer** loading nakie-products.json. **Task 2** switches analysis to workspace products.

**What still assumes Nakie is the default tenant**

- `geminiAnalyzer`: prompts, product context, DEFAULT_RESULT
- `.env.example`: DEFAULT_WORKSPACE_ID = Nakie UUID
- Migration 003: seeds only Nakie
- UI: Header, Footer, title (cosmetic)

After Phase 2D tasks 1–7, the app will support any workspace with:
- Workspace row in DB
- User in workspace_members
- Drive + Gemini (and optionally Shopify) in workspace_connections
- Products from Shopify sync (or manual) in `products` table

Nakie can later onboard through this same flow.

---

## 4. First Build Prompt

Use this prompt to start Phase 2D implementation:

---

**Phase 2D – Task 1 only: Make Gemini prompts workspace-agnostic**

In `src/services/geminiAnalyzer.ts`, remove Nakie-specific wording from the AI prompts so analysis works for any brand/workspace.

**Current state:**
- `ANALYSIS_PROMPT` (line 116): "You are analyzing a video from Nakie, an Australian eco-outdoor brand."
- `thumbnailPrompt` (line 368): "You are analyzing a single thumbnail frame from a video by Nakie, an Australian eco-outdoor brand."

**Required change:**
- Replace brand-specific phrasing with generic wording, e.g.:
  - "You are analyzing a video from a brand's video library."
  - "You are analyzing a single thumbnail frame from a brand's video."
- Do NOT change the product context loading, CONTENT_TAG_TAXONOMY, or JSON schema.
- Do NOT change `getProductContext()` or `productContext` in this task.
- Preserve all other prompt rules (product identification, moment detection, junk detection, transcript, etc.).

**Scope:** Only the two prompt strings. No other files. No product context changes.

After the edit, run `npm run build` and stop. Do not implement Tasks 2–7 yet.

---
