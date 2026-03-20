-- Phase A: Triage Queue Migration
-- Run this in the Supabase SQL Editor.
--
-- Adds triage/priority columns to support the analysis queue:
--   synced → triaged → analyzing → analyzed
--   synced → excluded (via triage)
--
-- New columns:
--   priority        — integer 0-100, determines queue order (higher = sooner)
--   triage_result   — JSONB with parsed signals, candidate products, reasoning
--
-- Also adds indexes for efficient queue polling by (status, priority).

-- ============================================================
-- 1. Add triage columns
-- ============================================================

ALTER TABLE videos ADD COLUMN IF NOT EXISTS priority integer;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS triage_result jsonb;

-- ============================================================
-- 2. Ensure drive_path column exists
-- ============================================================
-- This column was defined in the original schema but never populated.
-- The updated Drive crawl will now populate it with the folder path.

ALTER TABLE videos ADD COLUMN IF NOT EXISTS drive_path text;

-- ============================================================
-- 3. Indexes for queue polling
-- ============================================================
-- Primary queue index: find triaged videos ordered by priority (highest first)

CREATE INDEX IF NOT EXISTS idx_videos_queue
  ON videos(workspace_id, status, priority DESC NULLS LAST)
  WHERE status IN ('triaged', 'synced');

-- Status lookup (general)
CREATE INDEX IF NOT EXISTS idx_videos_status
  ON videos(status);

-- ============================================================
-- 4. Migrate existing analysis_mode values for consistency
-- ============================================================
-- Normalize 'thumbnail_fallback' → 'thumbnail' for clarity.
-- Keep 'full_video' as-is. Column name stays analysis_mode.

UPDATE videos
SET analysis_mode = 'thumbnail'
WHERE analysis_mode = 'thumbnail_fallback';
