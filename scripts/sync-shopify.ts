/**
 * Standalone Shopify product sync script.
 *
 * Usage:
 *   npx tsx scripts/sync-shopify.ts                  # workspace from DEFAULT_WORKSPACE_ID
 *   npx tsx scripts/sync-shopify.ts <workspace-id>   # explicit workspace
 *
 * Requires SUPABASE_URL, SUPABASE_ANON_KEY. If no workspace arg, DEFAULT_WORKSPACE_ID in .env.
 * Shopify credentials must be saved in workspace_connections (via admin UI)
 * or passed as SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN env vars.
 */

import 'dotenv/config';
import { syncShopifyProducts } from '../src/services/shopify.js';
import { getDefaultWorkspaceId, getWorkspaceCredentials } from '../src/lib/workspace.js';

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

async function main() {
  const workspaceArg = process.argv[2];
  const workspaceId = workspaceArg && isUuid(workspaceArg)
    ? workspaceArg
    : getDefaultWorkspaceId();

  if (workspaceArg && isUuid(workspaceArg)) {
    console.log(`Workspace: ${workspaceId}`);
  }
  const creds = await getWorkspaceCredentials(workspaceId);

  const storeUrl = creds.shopifyStoreUrl ?? process.env['SHOPIFY_STORE_URL'];

  if (!storeUrl) {
    console.error('Shopify store URL not found. Set it in the admin UI or as SHOPIFY_STORE_URL in .env');
    process.exit(1);
  }

  const hasClientCreds = creds.shopifyClientId && creds.shopifyClientSecret;
  const hasLegacyToken = Boolean(creds.shopifyAccessToken ?? process.env['SHOPIFY_ACCESS_TOKEN']);

  if (!hasClientCreds && !hasLegacyToken) {
    console.error('Shopify credentials not found. Either:');
    console.error('  1. Save Client ID + Client Secret in the admin UI, or');
    console.error('  2. Set SHOPIFY_ACCESS_TOKEN in .env (legacy)');
    process.exit(1);
  }

  const result = await syncShopifyProducts(workspaceId, {
    storeUrl,
    clientId: creds.shopifyClientId,
    clientSecret: creds.shopifyClientSecret,
    accessToken: creds.shopifyAccessToken ?? process.env['SHOPIFY_ACCESS_TOKEN'],
    cachedToken: creds.shopifyCachedToken,
    cachedTokenExpiresAt: creds.shopifyCachedTokenExpiresAt,
  });

  console.log('\nSync complete:');
  console.log(`  Shopify products: ${result.totalShopifyProducts}`);
  console.log(`  Total variants: ${result.totalVariants}`);
  console.log(`  Inserted: ${result.inserted}`);
  console.log(`  Updated: ${result.updated}`);
  console.log(`  Skipped: ${result.skipped.length}`);

  if (result.skipped.length > 0) {
    console.log('\nSkipped variants:');
    for (const s of result.skipped.slice(0, 30)) {
      console.log(`  - [${s.shopifyProductTitle}] ${s.shopifyVariantTitle}: ${s.reason}`);
    }
    if (result.skipped.length > 30) {
      console.log(`  ... and ${result.skipped.length - 30} more`);
    }
  }
}

main().catch(console.error);
