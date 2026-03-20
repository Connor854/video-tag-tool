-- Phase D: Shopify Integration Migration
-- Run this in the Supabase SQL Editor before using Shopify sync or colorway validation.
--
-- 1. Adds indexes for Shopify product lookups
-- 2. Adds validation tracking columns to video_products

-- ============================================================
-- 1. Indexes for Shopify product lookups
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_products_shopify_product_id ON products(shopify_product_id);
CREATE INDEX IF NOT EXISTS idx_products_shopify_variant_id ON products(shopify_variant_id);

-- ============================================================
-- 2. Validation tracking on video_products
-- ============================================================
-- validated_at: when image-based validation was last run (prevents re-validating)
-- validation_reason: Gemini's explanation for the match/no-match decision

ALTER TABLE video_products ADD COLUMN IF NOT EXISTS validated_at timestamptz;
ALTER TABLE video_products ADD COLUMN IF NOT EXISTS validation_reason text;
