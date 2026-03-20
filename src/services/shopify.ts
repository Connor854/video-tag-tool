/**
 * Read-only Shopify Admin API client.
 *
 * Shopify is the source of truth for the product catalog.
 * Syncs products/variants/images into the workspace-scoped products table,
 * inserting new rows and updating existing ones (upsert by shopify_variant_id).
 *
 * Supports two auth modes:
 *   1. Client credentials grant (Dev Dashboard apps) — exchanges
 *      client_id + client_secret for a short-lived access token.
 *   2. Legacy raw access token (custom apps created before 2025).
 *
 * Does NOT modify anything in Shopify — strictly read-only.
 */

import { supabase } from '../lib/supabase.js';
import { saveWorkspaceConnection } from '../lib/workspace.js';

// ============================================================
// Types
// ============================================================

interface ShopifyImage {
  id: number;
  src: string;
  variant_ids: number[];
}

interface ShopifyVariant {
  id: number;
  title: string;
  price: string;
}

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  product_type: string;
  tags: string;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
}

interface ShopifyProductsResponse {
  products: ShopifyProduct[];
}

export interface UnmatchedVariant {
  shopifyProductTitle: string;
  shopifyVariantTitle: string;
  constructedName: string;
  strategies: string[];   // which strategies were attempted
  failureReason: string;  // why none matched
}

export interface ShopifySyncResult {
  totalShopifyProducts: number;
  totalVariants: number;
  inserted: number;
  updated: number;
  skipped: SkippedVariant[];
}

export interface SkippedVariant {
  shopifyProductTitle: string;
  shopifyVariantTitle: string;
  reason: string;
}

/** Credentials needed to authenticate with Shopify. */
export interface ShopifyAuth {
  storeUrl: string;
  /** Client credentials grant (primary path) */
  clientId?: string;
  clientSecret?: string;
  /** Legacy raw token (backward compat) */
  accessToken?: string;
  /** Cached token + expiry from a previous client credentials exchange */
  cachedToken?: string;
  cachedTokenExpiresAt?: string;
}

// ============================================================
// Client Credentials Token Exchange
// ============================================================

interface TokenExchangeResult {
  access_token: string;
  expires_in: number; // seconds
}

/**
 * Exchange client_id + client_secret for a short-lived access token
 * via Shopify's client credentials grant.
 */
async function exchangeClientCredentials(
  storeUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<TokenExchangeResult> {
  const tokenUrl = `https://${storeUrl}/admin/oauth/access_token`;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response: Response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify token exchange failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as TokenExchangeResult;

  if (!data.access_token) {
    throw new Error('Shopify token exchange returned no access_token');
  }

  return data;
}

/**
 * Resolve a valid access token from ShopifyAuth, using cached token
 * when still valid, exchanging client credentials when expired,
 * or falling back to a raw legacy token.
 *
 * When a new token is obtained via client credentials, it is persisted
 * back to workspace_connections so subsequent calls can reuse it.
 */
export async function resolveAccessToken(
  auth: ShopifyAuth,
  workspaceId?: string,
): Promise<string> {
  // Path 1: Client credentials grant
  if (auth.clientId && auth.clientSecret) {
    // Check if cached token is still valid (with 5-minute buffer)
    if (auth.cachedToken && auth.cachedTokenExpiresAt) {
      const expiresAt = new Date(auth.cachedTokenExpiresAt).getTime();
      const bufferMs = 5 * 60 * 1000;
      if (Date.now() < expiresAt - bufferMs) {
        return auth.cachedToken;
      }
    }

    // Exchange for a new token
    console.log('Exchanging Shopify client credentials for access token...');
    const result = await exchangeClientCredentials(
      auth.storeUrl,
      auth.clientId,
      auth.clientSecret,
    );

    const expiresAt = new Date(Date.now() + result.expires_in * 1000).toISOString();

    // Persist the new token back to workspace_connections
    if (workspaceId) {
      await saveWorkspaceConnection(workspaceId, 'shopify', {
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
        cached_access_token: result.access_token,
        cached_token_expires_at: expiresAt,
      }, {
        store_url: auth.storeUrl,
        connected_via: 'client_credentials',
      });
    }

    return result.access_token;
  }

  // Path 2: Legacy raw access token
  if (auth.accessToken) {
    return auth.accessToken;
  }

  throw new Error('No Shopify credentials available (need client_id+client_secret or access_token)');
}

// ============================================================
// Fetch all products from Shopify Admin API (paginated)
// ============================================================

async function fetchAllShopifyProducts(
  storeUrl: string,
  accessToken: string,
): Promise<ShopifyProduct[]> {
  const allProducts: ShopifyProduct[] = [];
  let url: string | null =
    `https://${storeUrl}/admin/api/2024-01/products.json?limit=250&fields=id,title,handle,product_type,tags,variants,images`;

  while (url) {
    const currentUrl: string = url;
    const response: Response = await fetch(currentUrl, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Shopify API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as ShopifyProductsResponse;
    allProducts.push(...data.products);

    // Follow Link header for pagination
    const linkHeader: string | null = response.headers.get('link');
    url = null;
    if (linkHeader) {
      const nextMatch: RegExpMatchArray | null = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (nextMatch) {
        url = nextMatch[1];
      }
    }
  }

  return allProducts;
}

// ============================================================
// Find the best image for a variant
// ============================================================

function getVariantImage(product: ShopifyProduct, variantId: number): string | null {
  // First try variant-specific image
  const variantImage = product.images.find((img) =>
    img.variant_ids.includes(variantId),
  );
  if (variantImage) return variantImage.src;

  // Fallback to first product image
  if (product.images.length > 0) return product.images[0].src;

  return null;
}

// ============================================================
// Derive product fields from Shopify data
// ============================================================

/**
 * Parse a Shopify product title into base_product and colorway.
 *
 * Nakie uses two patterns:
 *   1. "Colorway - Base Product"  (e.g. "Forest Green - Recycled Hammock with Straps")
 *   2. No dash → title is the base product, no colorway
 *
 * Only splits on the FIRST " - " to handle base products that contain dashes.
 * Returns { baseProduct, colorway } where colorway may be null.
 */
function parseProductTitle(title: string): { baseProduct: string; colorway: string | null } {
  const dashIdx = title.indexOf(' - ');
  if (dashIdx === -1) {
    return { baseProduct: title, colorway: null };
  }
  return {
    colorway: title.slice(0, dashIdx).trim(),
    baseProduct: title.slice(dashIdx + 3).trim(),
  };
}

/**
 * Build the canonical product name for a Shopify product+variant.
 * This becomes the `name` column — the unique human-readable identifier.
 *
 * For single-variant products with "Default Title": just the product title.
 * For multi-variant products where the variant is a size (S/M/L, Small/Medium/Large):
 *   just the product title (size is not a colorway).
 * For other multi-variant products: "VariantTitle - ProductTitle"
 *   (but only if the title doesn't already contain " - ", in which case
 *   the colorway is already embedded and we use the title as-is).
 */
const SIZE_PATTERN = /^(XXS|XS|S|M|L|XL|XXL|XXXL|Small|Medium|Large|Extra Large|One Size|\d+)$/i;

function buildProductName(
  productTitle: string,
  variantTitle: string,
): string {
  if (variantTitle === 'Default Title') return productTitle;
  if (SIZE_PATTERN.test(variantTitle)) return productTitle;
  return productTitle;
}

/**
 * Parse Shopify's comma-separated tags string into a clean string array.
 */
function parseShopifyTags(tags: string): string[] {
  if (!tags) return [];
  return tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Determine the category for a product from Shopify's product_type.
 * Falls back to 'Uncategorized' for empty product_type.
 */
function deriveCategory(productType: string): string {
  return productType.trim() || 'Uncategorized';
}

// ============================================================
// Sync Shopify products to our products table (upsert)
// ============================================================

/**
 * Fetch products from Shopify and upsert them into the workspace's
 * products table. Shopify is the source of truth for the product catalog.
 *
 * For each Shopify variant:
 *   - If a row with the same shopify_variant_id exists: update it.
 *   - Otherwise: insert a new row.
 *
 * Field derivation:
 *   - name: product title (colorway is part of the title for Nakie products)
 *   - base_product: portion after " - " (or full title if no dash)
 *   - colorway: portion before " - " (or null if no dash)
 *   - category: Shopify product_type (or "Uncategorized")
 *   - price: variant price as string
 *   - tags: Shopify tags split into array
 *   - active: true
 *
 * Skipped variants (logged but not inserted):
 *   - Variants that look like size variants (S/M/L) for a product that
 *     already has a Default Title or colorway entry — avoids duplicate rows.
 *   - Gift Card denomination variants ($20, $50, etc.)
 */
export async function syncShopifyProducts(
  workspaceId: string,
  auth: ShopifyAuth,
): Promise<ShopifySyncResult> {
  console.log(`Fetching products from Shopify store: ${auth.storeUrl}`);
  const accessToken = await resolveAccessToken(auth, workspaceId);
  const shopifyProducts = await fetchAllShopifyProducts(auth.storeUrl, accessToken);

  // Load existing products keyed by shopify_variant_id for fast lookup
  const { data: existing, error } = await supabase
    .from('products')
    .select('id, shopify_variant_id')
    .eq('workspace_id', workspaceId)
    .not('shopify_variant_id', 'is', null);

  if (error) {
    throw new Error(`Failed to fetch existing products: ${error.message}`);
  }

  const existingByVariantId = new Map(
    (existing ?? []).map((p) => [p.shopify_variant_id, p.id]),
  );

  let inserted = 0;
  let updated = 0;
  let totalVariants = 0;
  const skipped: SkippedVariant[] = [];

  // Track which product titles have already been inserted (for deduping size variants)
  const insertedNames = new Set<string>();

  for (const shopifyProduct of shopifyProducts) {
    const productTitle = shopifyProduct.title.trim();
    const { baseProduct, colorway } = parseProductTitle(productTitle);
    const category = deriveCategory(shopifyProduct.product_type);
    const tags = parseShopifyTags(shopifyProduct.tags);

    for (const variant of shopifyProduct.variants) {
      totalVariants++;
      const variantTitle = variant.title.trim();
      const variantIdStr = String(variant.id);
      const imageUrl = getVariantImage(shopifyProduct, variant.id);

      // Skip gift card denominations — they aren't real products
      if (category === 'Gift Cards' && variantTitle !== 'Default Title') {
        skipped.push({
          shopifyProductTitle: productTitle,
          shopifyVariantTitle: variantTitle,
          reason: 'Gift card denomination variant',
        });
        continue;
      }

      // For size variants (S/M/L), use the product title as the name
      // and only create one row per product title
      const isSizeVariant = SIZE_PATTERN.test(variantTitle);
      const productName = buildProductName(productTitle, variantTitle);

      if (isSizeVariant && variantTitle !== 'Default Title') {
        // Check if we already have a row for this product (from a previous variant or earlier in this sync)
        const alreadyExists = existingByVariantId.has(variantIdStr);
        const alreadyInserted = insertedNames.has(productName.toLowerCase());

        if (!alreadyExists && alreadyInserted) {
          skipped.push({
            shopifyProductTitle: productTitle,
            shopifyVariantTitle: variantTitle,
            reason: `Size variant — row already exists for "${productName}"`,
          });
          continue;
        }
      }

      const row = {
        workspace_id: workspaceId,
        name: productName,
        base_product: baseProduct,
        colorway: colorway,
        category,
        price: variant.price,
        tags,
        shopify_product_id: String(shopifyProduct.id),
        shopify_variant_id: variantIdStr,
        image_url: imageUrl,
        active: true,
        updated_at: new Date().toISOString(),
      };

      const existingId = existingByVariantId.get(variantIdStr);

      if (existingId) {
        // Update existing row — do not include approved_at; preserve current value
        const { error: updateErr } = await supabase
          .from('products')
          .update(row)
          .eq('id', existingId);

        if (updateErr) {
          console.error(`Failed to update product ${existingId}:`, updateErr.message);
        } else {
          updated++;
        }
      } else {
        // Insert new row — set approved_at to null (pending review)
        const { error: insertErr } = await supabase
          .from('products')
          .insert({ ...row, approved_at: null });

        if (insertErr) {
          // Unique constraint violation — row already exists by name
          if (insertErr.code === '23505') {
            skipped.push({
              shopifyProductTitle: productTitle,
              shopifyVariantTitle: variantTitle,
              reason: `Duplicate name "${productName}" — already exists in products table`,
            });
          } else {
            console.error(`Failed to insert product "${productName}":`, insertErr.message);
            skipped.push({
              shopifyProductTitle: productTitle,
              shopifyVariantTitle: variantTitle,
              reason: `Insert error: ${insertErr.message}`,
            });
          }
        } else {
          inserted++;
          insertedNames.add(productName.toLowerCase());
        }
      }
    }
  }

  console.log(
    `Shopify sync: ${shopifyProducts.length} products, ${totalVariants} variants, ` +
    `${inserted} inserted, ${updated} updated, ${skipped.length} skipped`,
  );

  if (skipped.length > 0) {
    const logLimit = 30;
    for (const s of skipped.slice(0, logLimit)) {
      console.log(`  SKIPPED: [${s.shopifyProductTitle}] variant=[${s.shopifyVariantTitle}] — ${s.reason}`);
    }
    if (skipped.length > logLimit) {
      console.log(`  ... and ${skipped.length - logLimit} more skipped`);
    }
  }

  return {
    totalShopifyProducts: shopifyProducts.length,
    totalVariants,
    inserted,
    updated,
    skipped,
  };
}
