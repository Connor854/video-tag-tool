-- Phase 1: Durable Scan Progress
-- Run this in the Supabase SQL Editor before deploying Phase 1 code.
--
-- Creates scan_jobs table to persist scan run metadata.
-- The videos table remains the queue; scan_jobs tracks run-level progress.

CREATE TABLE IF NOT EXISTS scan_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'aborted', 'failed')),
  progress integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  current_file text,
  error_message text,
  workers integer NOT NULL DEFAULT 3,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_jobs_workspace_status
  ON scan_jobs(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_scan_jobs_started
  ON scan_jobs(started_at DESC);
