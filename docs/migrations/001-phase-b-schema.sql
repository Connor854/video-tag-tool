-- Phase B Schema Migration
-- Run this in the Supabase SQL Editor before starting the new scanner.
--
-- This migration:
-- 1. Adds new columns to the videos table (aspect_ratio, content_tags, transcript)
-- 2. Ensures drive_id has a unique constraint (needed for scanner upsert)
-- 3. Creates the products reference table
-- 4. Creates the video_products junction table (many-to-many with confidence)
-- 5. Creates the video_moments table (timestamped segments)
-- 6. Creates RPC functions for efficient filter/stats queries

-- ============================================================
-- 1. Add new columns to videos table
-- ============================================================

ALTER TABLE videos ADD COLUMN IF NOT EXISTS aspect_ratio text;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS content_tags text[] DEFAULT '{}';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS transcript text;

-- ============================================================
-- 2. Ensure drive_id unique constraint (needed for upsert)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_drive_id ON videos(drive_id);

-- ============================================================
-- 3. Products reference table
-- ============================================================
-- This holds the canonical product catalog.
-- Populated from nakie-products.json initially, later synced from Shopify.

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,                -- Full product name: "Forest Green - Recycled Hammock with Straps"
  base_product text NOT NULL,        -- Base product: "Recycled Hammock with Straps"
  category text NOT NULL,            -- Category: "Hammocks"
  colorway text,                     -- Colorway/design name: "Forest Green" (null for colorless products)
  price text,                        -- Price string: "$129.95"
  tags text[] DEFAULT '{}',          -- Search tags: ["hammock", "forest green", "recycled"]
  shopify_product_id text,           -- Future: Shopify product ID
  shopify_variant_id text,           -- Future: Shopify variant ID
  image_url text,                    -- Future: product image for visual matching
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(name)
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_base_product ON products(base_product);
CREATE INDEX IF NOT EXISTS idx_products_colorway ON products(colorway);

-- ============================================================
-- 4. Video-products junction table
-- ============================================================
-- Links videos to products with confidence levels.
-- Supports the tagging hierarchy:
--   green = high-confidence exact match (validated against catalog)
--   amber = candidate / possible match

CREATE TABLE IF NOT EXISTS video_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,  -- NULL allowed for category-only tags
  category text NOT NULL,                                      -- Always populated (e.g., "Hammocks")
  confidence text NOT NULL CHECK (confidence IN ('green', 'amber')),
  source text NOT NULL DEFAULT 'gemini',                       -- 'gemini', 'gemini-image-match', 'manual', 'filename'
  created_at timestamptz DEFAULT now(),
  UNIQUE(video_id, product_id)
);

-- Allow category-only entries (no product_id) — separate unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_products_category_only
  ON video_products(video_id, category)
  WHERE product_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_video_products_video ON video_products(video_id);
CREATE INDEX IF NOT EXISTS idx_video_products_product ON video_products(product_id);
CREATE INDEX IF NOT EXISTS idx_video_products_confidence ON video_products(confidence);

-- ============================================================
-- 5. Video moments table
-- ============================================================
-- Stores AI-detected meaningful moments within a video.
-- Each moment represents a distinct segment (typically 3-15 seconds)
-- based on scene/action/product/context changes.

CREATE TABLE IF NOT EXISTS video_moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  start_seconds real NOT NULL,
  end_seconds real,
  label text NOT NULL,              -- Short searchable tag: "product-closeup", "unboxing", "beach-setup"
  description text,                 -- One sentence: "Person threading strap around tree"
  products_visible text[],          -- Product names visible in this moment
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_moments_video ON video_moments(video_id);
CREATE INDEX IF NOT EXISTS idx_video_moments_label ON video_moments(label);

-- ============================================================
-- 6. RPC functions for efficient queries
-- ============================================================

-- Efficient filter options extraction (replaces fetching all rows)
CREATE OR REPLACE FUNCTION get_filter_options()
RETURNS json AS $$
  SELECT json_build_object(
    'products', (
      SELECT COALESCE(array_agg(DISTINCT val ORDER BY val), '{}')
      FROM videos, unnest(products) AS val
      WHERE status != 'excluded' AND drive_id IS NOT NULL
    ),
    'scenes', (
      SELECT COALESCE(array_agg(DISTINCT scene ORDER BY scene), '{}')
      FROM videos
      WHERE scene IS NOT NULL AND status != 'excluded' AND drive_id IS NOT NULL
    ),
    'shot_types', (
      SELECT COALESCE(array_agg(DISTINCT shot_type ORDER BY shot_type), '{}')
      FROM videos
      WHERE shot_type IS NOT NULL AND status != 'excluded' AND drive_id IS NOT NULL
    ),
    'audio_types', (
      SELECT COALESCE(array_agg(DISTINCT audio_type ORDER BY audio_type), '{}')
      FROM videos
      WHERE audio_type IS NOT NULL AND status != 'excluded' AND drive_id IS NOT NULL
    ),
    'content_tags', (
      SELECT COALESCE(array_agg(DISTINCT val ORDER BY val), '{}')
      FROM videos, unnest(content_tags) AS val
      WHERE status != 'excluded' AND drive_id IS NOT NULL
    )
  );
$$ LANGUAGE sql STABLE;

-- Efficient total size calculation (replaces fetching all rows)
CREATE OR REPLACE FUNCTION get_total_size_bytes()
RETURNS bigint AS $$
  SELECT COALESCE(SUM(size_bytes), 0)::bigint FROM videos;
$$ LANGUAGE sql STABLE;
