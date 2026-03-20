-- Phase C Status Model Migration
-- Run this in the Supabase SQL Editor before using the new video analysis pipeline.
--
-- Updates the video status model to support the full lifecycle:
--   synced → analyzing → analyzed → reanalysis_needed
--   synced → excluded
--   analyzing → error
--
-- Existing 'analyzed' videos from thumbnail-only analysis are set to
-- 'reanalysis_needed' so they can be re-processed with the full video pipeline.

-- Mark existing thumbnail-analyzed videos for re-analysis
-- (They were analyzed with a single thumbnail, not full video input)
UPDATE videos
SET status = 'reanalysis_needed'
WHERE status = 'analyzed'
  AND drive_id IS NOT NULL;

-- Videos that were 'processed' (from the old push-to-supabase flow) also need re-analysis
UPDATE videos
SET status = 'reanalysis_needed'
WHERE status = 'processed'
  AND drive_id IS NOT NULL;

-- 'pending' videos that were never analyzed should be treated as 'synced'
UPDATE videos
SET status = 'synced'
WHERE status = 'pending'
  AND drive_id IS NOT NULL;

-- ============================================================
-- Add analysis_mode column
-- ============================================================
-- Tracks HOW a video was analyzed so we can distinguish full-video
-- results from degraded thumbnail-only results.
--
-- Values:
--   'full_video'          — analyzed with full video uploaded to Gemini Files API
--   'thumbnail_fallback'  — analyzed from a single thumbnail frame (degraded)
--   NULL                  — not yet analyzed

ALTER TABLE videos ADD COLUMN IF NOT EXISTS analysis_mode text;
