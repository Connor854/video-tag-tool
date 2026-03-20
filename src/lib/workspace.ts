/**
 * Workspace resolution and credential access.
 *
 * MVP: reads DEFAULT_WORKSPACE_ID from env and credentials from
 * the workspace_connections table in Supabase.
 *
 * Future: resolves workspace from JWT claims / session, credentials
 * from encrypted storage or OAuth token refresh.
 */

import { supabase } from './supabase.js';

// ============================================================
// Types
// ============================================================

export interface WorkspaceCredentials {
  geminiApiKey?: string;
  googleServiceAccountKey?: string; // JSON string of service account
  googleDriveFolderId?: string;
  shopifyStoreUrl?: string;
  /** Client credentials grant (primary path for Dev Dashboard apps) */
  shopifyClientId?: string;
  shopifyClientSecret?: string;
  /** Legacy raw access token (backward compat for old custom apps) */
  shopifyAccessToken?: string;
  /** Cached token from client credentials exchange */
  shopifyCachedToken?: string;
  shopifyCachedTokenExpiresAt?: string;
  /** How Shopify was connected: 'oauth' | 'client_credentials' | 'manual_token' */
  shopifyConnectedVia?: string;
}

// ============================================================
// Workspace ID resolution
// ============================================================

/**
 * Get workspace ID from DEFAULT_WORKSPACE_ID env var.
 * Used by headless scripts (analyze-batch, sync-shopify, test-triage, etc.) that have no request context.
 * Throws if unset. For request handling, workspace comes from tRPC/resolveWorkspace (JWT or admin secret).
 * See docs/DEFAULT_WORKSPACE_ID_SEMANTICS.md for full semantics.
 */
export function getDefaultWorkspaceId(): string {
  const id = process.env['DEFAULT_WORKSPACE_ID'];
  if (!id) {
    throw new Error(
      'DEFAULT_WORKSPACE_ID not set. Run migration 003 and add the workspace ID to .env',
    );
  }
  return id;
}

// ============================================================
// Credential access
// ============================================================

/**
 * Fetch credentials for a specific provider from workspace_connections.
 */
async function getConnection(
  workspaceId: string,
  provider: string,
): Promise<{ credentials: Record<string, string>; metadata: Record<string, string> } | null> {
  const { data, error } = await supabase
    .from('workspace_connections')
    .select('credentials, metadata')
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .single();

  if (error || !data) return null;
  return {
    credentials: (data.credentials ?? {}) as Record<string, string>,
    metadata: (data.metadata ?? {}) as Record<string, string>,
  };
}

/**
 * Get all credentials needed for scanning (Drive + Gemini).
 * Falls back to env vars for MVP bootstrapping.
 */
export async function getWorkspaceCredentials(
  workspaceId: string,
): Promise<WorkspaceCredentials> {
  const [driveConn, geminiConn, shopifyConn] = await Promise.all([
    getConnection(workspaceId, 'google_drive'),
    getConnection(workspaceId, 'gemini'),
    getConnection(workspaceId, 'shopify'),
  ]);

  return {
    googleServiceAccountKey:
      driveConn?.credentials['service_account_key'] ??
      process.env['GOOGLE_SERVICE_ACCOUNT_KEY'] ??
      undefined,
    googleDriveFolderId:
      driveConn?.metadata['folder_id'] ??
      process.env['GOOGLE_DRIVE_FOLDER_ID'] ??
      undefined,
    geminiApiKey:
      geminiConn?.credentials['api_key'] ??
      process.env['GEMINI_API_KEY'] ??
      undefined,
    shopifyStoreUrl:
      shopifyConn?.metadata['store_url'] ?? undefined,
    shopifyClientId:
      shopifyConn?.credentials['client_id'] ?? undefined,
    shopifyClientSecret:
      shopifyConn?.credentials['client_secret'] ?? undefined,
    shopifyAccessToken:
      shopifyConn?.credentials['access_token'] ?? undefined,
    shopifyCachedToken:
      shopifyConn?.credentials['cached_access_token'] ?? undefined,
    shopifyCachedTokenExpiresAt:
      shopifyConn?.credentials['cached_token_expires_at'] ?? undefined,
    shopifyConnectedVia: shopifyConn?.metadata['connected_via'] ?? undefined,
  };
}

/**
 * Save credentials for a provider to workspace_connections.
 * Used by the admin settings save flow.
 */
export async function saveWorkspaceConnection(
  workspaceId: string,
  provider: string,
  credentials: Record<string, string>,
  metadata: Record<string, string> = {},
): Promise<void> {
  const { error } = await supabase
    .from('workspace_connections')
    .upsert(
      {
        workspace_id: workspaceId,
        provider,
        credentials,
        metadata,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,provider' },
    );

  if (error) {
    throw new Error(`Failed to save ${provider} connection: ${error.message}`);
  }
}
