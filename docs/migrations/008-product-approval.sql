-- Phase 2E: Product Catalog Approval
-- Run this migration manually in the Supabase SQL Editor.
--
-- Adds approved_at to products to support a review/approval flow.
-- Existing products are backfilled as approved so current behavior is unchanged.
--
-- 1. Add approved_at column (nullable)
-- 2. Backfill existing rows with now()
-- 3. Create partial index for approved-product queries

-- ============================================================
-- 1. Add approved_at column
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- ============================================================
-- 2. Backfill existing products as approved
-- ============================================================
-- Ensures current behavior is unchanged: all existing products
-- are treated as approved until we gate analysis on this field.

UPDATE products SET approved_at = now() WHERE approved_at IS NULL;

-- ============================================================
-- 3. Partial index for approved-product queries
-- ============================================================
-- Optimizes queries that filter by workspace_id and approved_at IS NOT NULL
-- (e.g. getProductContextForWorkspace, colourwaysForProducts, search).

CREATE INDEX IF NOT EXISTS idx_products_approved
  ON products(workspace_id)
  WHERE approved_at IS NOT NULL;
