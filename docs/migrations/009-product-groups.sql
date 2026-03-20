-- Phase A1: Generic Product Grouping
-- Run in the Supabase SQL Editor.
--
-- Adds workspace-scoped product groups for filter UI.
-- Replaces hardcoded PRODUCT_FAMILIES with DB-driven grouping.
--
-- 1. product_groups — display labels for filters (e.g. "Hammock", "Beach Towel")
-- 2. product_group_members — many-to-many: which products belong to which groups

-- ============================================================
-- 1. Product groups table
-- ============================================================

CREATE TABLE IF NOT EXISTS product_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai_suggested')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_groups_workspace
  ON product_groups(workspace_id);

-- ============================================================
-- 2. Product group members (many-to-many)
-- ============================================================

CREATE TABLE IF NOT EXISTS product_group_members (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_group_id uuid NOT NULL REFERENCES product_groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, product_group_id)
);

CREATE INDEX IF NOT EXISTS idx_product_group_members_group
  ON product_group_members(product_group_id);

CREATE INDEX IF NOT EXISTS idx_product_group_members_product
  ON product_group_members(product_id);
