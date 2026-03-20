# Phase 2D Plan (Revised): Shopify-First Product Catalog Architecture

**Product direction:** Shopify is the primary product source. The app syncs products from Shopify first, then the user reviews/approves during onboarding. The approved in-app catalog becomes the reference for analysis, matching, tagging, filtering, and search. Nakie will later use this same flow — no separate legacy import.

---

## 1. Updated Phase 2D Assessment

### Which current Phase 2D tasks still make sense

| Original task | Still valid? | Notes |
|---------------|--------------|-------|
| **Task 1 (Gemini prompts generic)** | Yes | Remove Nakie wording. Still needed. |
| **Task 2 (Product context from products table)** | Yes, **critical** | This is the architectural change that enables Shopify-first. Without it, analysis always uses nakie-products.json regardless of Shopify sync. |
| **Task 3 (DEFAULT_RESULT generic)** | Yes | Minor but correct. |
| **Task 4 (Document workspace creation)** | Yes | Foundational. |
| **Task 5 (.env.example)** | Yes | Foundational. |
| **Task 6 (DEFAULT_WORKSPACE_ID semantics)** | Defer | Can keep fallback for now. |
| **Task 7 (UI branding)** | Yes | Cleanup. |

### Which tasks are now incomplete (don't account for Shopify-first + review)

**Original Task 2** assumed: "Load product context from workspace products table." It did not explicitly account for:

1. **Approval flow** — New direction: user reviews/approves after sync. Current: no `approval_status` column. Products in table are treated as usable. **Phase 2D:** Treat all products in table as "approved" for analysis. No schema change. Defer approval UI to onboarding phase.

2. **Onboarding sequence** — New direction: Sync Shopify first → review → then scan. **Phase 2D:** Document this. No code change. The analyzer will use whatever is in `products` when scan runs. If empty, analysis returns generic product suggestions (empty catalog in prompt).

3. **Product catalog UI** — New direction: edit name/category, add variants, aliases, manual products, etc. **Phase 2D:** Not in scope. Defer to onboarding phase. Phase 2D only ensures: analyzer reads from `products` table.

4. **Schema for review/aliases/manual** — New direction: support aliases, manual products, archived. **Phase 2D:** Not in scope. Current schema has `active`, `shopify_product_id`, `shopify_variant_id`. Sufficient for "Shopify sync → products table → analyzer uses it." Defer schema changes.

### Exact files/modules this impacts

| File / Module | Current role | Phase 2D change |
|---------------|--------------|-----------------|
| `src/services/geminiAnalyzer.ts` | Loads nakie-products.json at module load; prompts say Nakie | Accept `workspaceId`, `productContext` (or fetch from DB); generic prompts; remove nakie-products.json |
| `src/services/scanner.ts` | Calls `analyzeVideoFull`/`analyzeVideoThumbnail` with no workspace context | Pass `workspaceId`; fetch product context for workspace; pass to analyzer |
| `src/services/shopify.ts` | Upserts to products table | No change — already Shopify-first |
| `src/server/routers/admin.ts` | `syncShopify` mutation | No change |
| `products` table | name, base_product, category, colorway, shopify_*, etc. | No schema change for Phase 2D |
| `scripts/seed-products.ts` | Seeds from nakie-products.json | Defer — document that fresh workspaces use Shopify sync |

---

## 2. Revised Recommended Task Order

| # | Task | Type | Phase | Description |
|---|------|------|-------|-------------|
| 1 | **Switch analyzer to workspace products table** | **Blocker** | 2D | `geminiAnalyzer` must accept `workspaceId` (or `productContext` string). Build context from `products` table (id, name, base_product, category, colorway). Scanner fetches and passes it. Remove nakie-products.json from analysis path. |
| 2 | **Make Gemini prompts generic** | **Blocker** | 2D | Replace "Nakie, an Australian eco-outdoor brand" with generic wording. |
| 3 | **Generic DEFAULT_RESULT** | **Blocker** | 2D | Change "Video from the Nakie collection." to "Video from the collection." |
| 4 | **Handle empty product catalog** | **Foundational** | 2D | When workspace has no products: pass empty context to analyzer. Prompt should still work (generic product rules). matchProducts already returns early when refProducts.length === 0. |
| 5 | **Document onboarding: Shopify → review → scan** | **Foundational** | 2D | Add `docs/ONBOARDING_FLOW.md`: Sync Shopify first, products in table = working catalog, run scan when ready. Note: Product catalog UI (review/edit) deferred. |
| 6 | **Document workspace creation** | **Foundational** | 2D | Add `docs/WORKSPACE_ONBOARDING.md` with SQL for creating workspace, adding user, connecting Drive/Shopify. |
| 7 | **Update .env.example** | **Foundational** | 2D | Clarify DEFAULT_WORKSPACE_ID as optional for dev fallback. |
| 8 | **Generic UI branding** | **Cleanup** | 2D | Replace "nakie" / "Nakie Video Search" in Header, Footer, index.html. |
| 9 | **Product catalog UI (review/edit)** | **Defer** | Onboarding | Admin page to view products, edit name/category, add manual, mark archived. |
| 10 | **Approval status column** | **Defer** | Onboarding | `products.approval_status` or `products.approved` if we want explicit review gate. |
| 11 | **Aliases, product_url, manual source** | **Defer** | Onboarding | Schema additions for full product system. |

### Task order rationale

**Task 1 first** — Switching analyzer to workspace products is the core architectural change. It unblocks the Shopify-first flow. Without it, Shopify sync is irrelevant to analysis.

**Task 2–3** — Remove Nakie wording. Can be done in same PR as Task 1 or immediately after.

**Task 4** — Ensure empty catalog works. Important for new workspaces that sync but have no products yet, or for workspaces that haven't synced.

**Tasks 5–8** — Documentation and cleanup.

---

## 3. Product-Catalog Architecture Notes

### Path: Shopify sync → products table → user review → analyzer

**What already exists:**

| Component | Status | Location |
|-----------|--------|----------|
| **Shopify sync** | Implemented | `src/services/shopify.ts` — `syncShopifyProducts()` fetches from Shopify API, upserts to `products` table by `shopify_variant_id` |
| **Admin sync button** | Implemented | `src/client/components/AdminPage.tsx` — `syncShopify` mutation |
| **products table** | Exists | `docs/migrations/001-phase-b-schema.sql`, `003-workspace-scoping.sql`, `004-phase-d-shopify.sql` — columns: name, base_product, category, colorway, price, tags, shopify_product_id, shopify_variant_id, image_url, active. Workspace-scoped. |
| **workspace_connections** | Exists | Stores Shopify credentials per workspace (store_url, client_id, client_secret, etc.) |
| **Scanner matchProducts** | Uses products table | `src/services/scanner.ts` — `getRefProducts(workspaceId)` reads from `products` table. Used after analysis to map Gemini candidates to product IDs. |

**What is missing:**

| Component | Status | Location |
|-----------|--------|----------|
| **Analyzer product context** | Uses nakie-products.json | `src/services/geminiAnalyzer.ts` — `getProductContext()` reads static file. Gemini prompt gets Nakie catalog. **Must switch to products table.** |
| **Analyzer workspaceId** | Not passed | `analyzeVideoFull` and `analyzeVideoThumbnail` have no workspace context. Scanner has workspaceId but doesn't pass it. |
| **Product catalog UI** | Missing | No Admin page to view/edit products. User cannot review or correct imported catalog. |
| **Approval flow** | Missing | No approval_status. All products in table are treated as usable. |
| **Manual products** | Missing | No way to add products not in Shopify. No `source` column. |
| **Aliases** | Missing | No alternate names for matching. |

### Best path for Phase 2D

1. **Phase 2D (now):** Analyzer reads product context from `products` table via `workspaceId`. Scanner fetches products (same as `getRefProducts`), builds context string, passes to analyzer. No schema change. Products in table = working catalog. No approval gate yet.

2. **Onboarding phase (later):** Product catalog UI: list products, edit, add manual, mark archived. Optional: approval_status. Schema: aliases, product_url, source (shopify | manual).

3. **Nakie:** Will use same flow: create workspace, connect Shopify, sync products, (future: review in catalog UI), connect Drive, run scan.

---

## 4. First Build Prompt

Use this prompt to start Phase 2D implementation:

---

**Phase 2D – Task 1 only: Switch analyzer to workspace products table**

The analyzer must use the workspace's `products` table instead of `data/nakie-products.json` so that Shopify-synced products become the reference for video analysis.

**Current state:**
- `geminiAnalyzer.ts`: `getProductContext()` reads `nakie-products.json` at module load. `ANALYSIS_PROMPT` and `thumbnailPrompt` use `productContext` (static).
- `scanner.ts`: `analyzeOneVideo` has `workspaceId` but calls `analyzeVideoFull`/`analyzeVideoThumbnail` with no workspace or product context.

**Required change:**

1. **In `src/services/geminiAnalyzer.ts`:**
   - Add `getProductContextForWorkspace(workspaceId: string): Promise<string>` that fetches from `products` table (`SELECT name, base_product, category, colorway WHERE workspace_id = ? AND active = true`), group by category, format as prompt text (same structure as current: "Product Categories and Variants:\n\nCategory: ...\n  - product name"). Return empty string if no products.
   - Remove `getProductContext()` and the module-level `productContext`. Do NOT call `getProductContextForWorkspace` at module load.
   - Change `analyzeVideoFull` and `analyzeVideoThumbnail` to accept `productContext: string` as the last parameter (or `workspaceId` and fetch internally). Use the passed-in context in the prompt instead of the static `productContext`.

2. **In `src/services/scanner.ts`:**
   - Before calling `analyzeVideoFull` or `analyzeVideoThumbnail`, call `getProductContextForWorkspace(workspaceId)` (or equivalent) to get the context string.
   - Pass that context into the analyzer functions.

3. **Ensure empty catalog works:** When `products` is empty, pass `""`. The prompt should still work — Gemini will analyze without product names to suggest. The existing "Use EXACT product names from the catalog above" rule still applies; if catalog is empty, it effectively says "no products to match."

**Scope:** Do NOT change prompt wording (Nakie → generic) in this task. Do NOT add approval_status or catalog UI. Only switch the product context source from nakie-products.json to products table.

**Do NOT** delete `data/nakie-products.json` or `scripts/seed-products.ts` — they may be used elsewhere. Just remove them from the analyzer's path.

After the edit, run `npm run build` and stop. Do not implement Tasks 2–8 yet.

---
