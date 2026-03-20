-- Workspace Scoping Migration
-- Run this in the Supabase SQL Editor before deploying workspace-aware code.
--
-- Creates the multi-tenant foundation:
--   1. workspaces table (one row per customer)
--   2. workspace_connections table (per-workspace credentials for external services)
--   3. workspace_id column on videos, products, video_products, video_moments
--   4. Seeds one Nakie workspace for MVP
--   5. Backfills existing rows with the Nakie workspace ID
--   6. Updates RPC functions to accept workspace_id parameter

-- ============================================================
-- 1. Workspaces table
-- ============================================================

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,        -- URL-safe identifier
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- 2. Workspace connections table
-- ============================================================
-- Stores per-workspace credentials for external services.
-- MVP: replaces flat SQLite settings for Drive/Gemini/Shopify keys.
-- Future: stores OAuth tokens after user authorizes via Connect flow.

CREATE TABLE IF NOT EXISTS workspace_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL,           -- 'google_drive', 'gemini', 'shopify'
  credentials jsonb NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',  -- non-secret config (e.g., folder IDs)
  connected_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_workspace_connections_workspace
  ON workspace_connections(workspace_id);

-- ============================================================
-- 3. Seed the Nakie workspace
-- ============================================================
-- This ID is used as DEFAULT_WORKSPACE_ID in .env for MVP.
-- IMPORTANT: Copy this UUID into your .env file after running this migration.

INSERT INTO workspaces (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Nakie', 'nakie')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- 4. Add workspace_id to videos
-- ============================================================

ALTER TABLE videos ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);

-- Backfill existing videos
UPDATE videos
SET workspace_id = '00000000-0000-0000-0000-000000000001'
WHERE workspace_id IS NULL;

-- Now make it NOT NULL (safe because we just backfilled)
ALTER TABLE videos ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE videos ALTER COLUMN workspace_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_videos_workspace ON videos(workspace_id);

-- ============================================================
-- 5. Add workspace_id to products
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);

UPDATE products
SET workspace_id = '00000000-0000-0000-0000-000000000001'
WHERE workspace_id IS NULL;

ALTER TABLE products ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE products ALTER COLUMN workspace_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_products_workspace ON products(workspace_id);

-- Update the unique constraint on products to be workspace-scoped
-- Drop old constraint first, then add new one
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_name_key;
ALTER TABLE products ADD CONSTRAINT products_workspace_name_key UNIQUE(workspace_id, name);

-- ============================================================
-- 6. Add workspace_id to video_products
-- ============================================================

ALTER TABLE video_products ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);

UPDATE video_products
SET workspace_id = '00000000-0000-0000-0000-000000000001'
WHERE workspace_id IS NULL;

ALTER TABLE video_products ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE video_products ALTER COLUMN workspace_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_video_products_workspace ON video_products(workspace_id);

-- ============================================================
-- 7. Add workspace_id to video_moments
-- ============================================================

ALTER TABLE video_moments ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);

UPDATE video_moments
SET workspace_id = '00000000-0000-0000-0000-000000000001'
WHERE workspace_id IS NULL;

ALTER TABLE video_moments ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE video_moments ALTER COLUMN workspace_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_video_moments_workspace ON video_moments(workspace_id);

-- ============================================================
-- 8. Update RPC functions with workspace_id parameter
-- ============================================================

CREATE OR REPLACE FUNCTION get_filter_options(p_workspace_id uuid DEFAULT '00000000-0000-0000-0000-000000000001')
RETURNS json AS $$
  SELECT json_build_object(
    'products', (
      SELECT COALESCE(array_agg(DISTINCT val ORDER BY val), '{}')
      FROM videos, unnest(products) AS val
      WHERE status != 'excluded' AND drive_id IS NOT NULL AND workspace_id = p_workspace_id
    ),
    'scenes', (
      SELECT COALESCE(array_agg(DISTINCT scene ORDER BY scene), '{}')
      FROM videos
      WHERE scene IS NOT NULL AND status != 'excluded' AND drive_id IS NOT NULL AND workspace_id = p_workspace_id
    ),
    'shot_types', (
      SELECT COALESCE(array_agg(DISTINCT shot_type ORDER BY shot_type), '{}')
      FROM videos
      WHERE shot_type IS NOT NULL AND status != 'excluded' AND drive_id IS NOT NULL AND workspace_id = p_workspace_id
    ),
    'audio_types', (
      SELECT COALESCE(array_agg(DISTINCT audio_type ORDER BY audio_type), '{}')
      FROM videos
      WHERE audio_type IS NOT NULL AND status != 'excluded' AND drive_id IS NOT NULL AND workspace_id = p_workspace_id
    ),
    'content_tags', (
      SELECT COALESCE(array_agg(DISTINCT val ORDER BY val), '{}')
      FROM videos, unnest(content_tags) AS val
      WHERE status != 'excluded' AND drive_id IS NOT NULL AND workspace_id = p_workspace_id
    )
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION get_total_size_bytes(p_workspace_id uuid DEFAULT '00000000-0000-0000-0000-000000000001')
RETURNS bigint AS $$
  SELECT COALESCE(SUM(size_bytes), 0)::bigint FROM videos WHERE workspace_id = p_workspace_id;
$$ LANGUAGE sql STABLE;
