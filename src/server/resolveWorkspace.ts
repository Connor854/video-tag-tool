/**
 * Resolve workspace from an Express request for non-tRPC routes.
 * Mirrors the auth/workspace logic used in src/server/trpc.ts workspaceMiddleware.
 */

import type { Request } from 'express';
import { supabase } from '../lib/supabase.js';

export type ResolvedWorkspace = {
  workspaceId: string;
  authMethod: 'admin_secret' | 'jwt' | 'fallback';
  userId: string | null;
};

/**
 * Resolve the current workspace from request headers.
 * Uses the same precedence as tRPC workspace middleware:
 * 1. Admin secret (x-admin-secret or Bearer <secret>)
 * 2. JWT Bearer token → workspace from workspace_members
 * 3. Fallback to DEFAULT_WORKSPACE_ID when no auth headers (local dev / single-tenant)
 *
 * @returns ResolvedWorkspace when a workspace can be determined, null otherwise
 */
export async function resolveWorkspaceFromRequest(
  req: Request,
): Promise<ResolvedWorkspace | null> {
  const xAdminSecret = req.headers['x-admin-secret'] as string | undefined;
  const authHeader = req.headers['authorization'] as string | undefined;
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : undefined;
  const adminSecret =
    xAdminSecret ??
    (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader);

  const envAdminSecret = process.env['ADMIN_SECRET'];
  const envDefaultWorkspace = process.env['DEFAULT_WORKSPACE_ID'];

  let workspaceId: string | null = null;
  let userId: string | null = null;
  let authMethod: 'admin_secret' | 'jwt' | 'fallback' = 'fallback';

  // 1. Admin secret (x-admin-secret or Bearer <secret>)
  if (
    adminSecret &&
    envAdminSecret &&
    adminSecret === envAdminSecret
  ) {
    workspaceId = envDefaultWorkspace ?? null;
    authMethod = 'admin_secret';
  }
  // 2. JWT — verify and resolve workspace from membership
  else if (bearerToken) {
    if (bearerToken === envAdminSecret) {
      workspaceId = envDefaultWorkspace ?? null;
      authMethod = 'admin_secret';
    } else {
      const { data: { user }, error } = await supabase.auth.getUser(
        bearerToken,
      );
      if (!error && user) {
        userId = user.id;
        const { data: member } = await supabase
          .from('workspace_members')
          .select('workspace_id')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (member) {
          workspaceId = member.workspace_id;
          authMethod = 'jwt';
        }
      }
    }
  }

  // 3. Fallback for local dev (no auth headers) — see docs/DEFAULT_WORKSPACE_ID_SEMANTICS.md
  if (!workspaceId && envDefaultWorkspace) {
    workspaceId = envDefaultWorkspace;
    authMethod = 'fallback';
  }

  if (!workspaceId) {
    return null;
  }

  return {
    workspaceId,
    authMethod,
    userId,
  };
}
