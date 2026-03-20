-- Phase 2: Workspace membership for SaaS auth
-- Run in Supabase SQL Editor before deploying Phase 2 code.
--
-- Links users (auth.users) to workspaces.
-- Supabase Auth creates auth.users; we reference it by id.

CREATE TABLE IF NOT EXISTS workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user
  ON workspace_members(user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace
  ON workspace_members(workspace_id);

-- To seed a user into the Nakie workspace after creating them via Supabase Auth:
-- INSERT INTO workspace_members (workspace_id, user_id, role)
-- VALUES ('00000000-0000-0000-0000-000000000001', '<auth.users.id>', 'owner')
-- ON CONFLICT (workspace_id, user_id) DO NOTHING;
