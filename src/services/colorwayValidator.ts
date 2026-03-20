/**
 * Image-based colorway validation.
 *
 * Compares a Shopify product image against a video thumbnail using
 * Gemini Vision to determine if the product in the video matches the
 * catalog product. Promotes amber → green only on confident visual match.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from '../lib/supabase.js';

// ============================================================
// Types
// ============================================================

interface ValidationResult {
  match: boolean;
  product_type_match: boolean;
  colorway_match: boolean;
  reason: string;
}

export type ValidationSource = 'drive_thumbnail' | 'extracted_frame';

export interface ValidateMatchesResult {
  total: number;        // total amber matches checked
  promoted: number;     // upgraded to green
  rejected: number;     // stayed amber (visual mismatch)
  skipped: number;      // skipped (no image, already validated, etc.)
  errors: number;       // Gemini call failed
  source: ValidationSource;  // what image source was used for comparison
}

// ============================================================
// Rate limiting
// ============================================================

const VALIDATION_DELAY_MS = 1500;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// Single match validation via Gemini Vision
// ============================================================

const VALIDATION_PROMPT = `You are comparing two images to determine if the same product appears in both.

Image 1: A product photo from an e-commerce catalog.
Image 2: A frame from a video.

The product being compared is: "{productName}" in the "{colorway}" colorway, category "{category}".

Analyze both images and determine:
1. product_type_match: Is the same TYPE of product visible in both images? (e.g., both show a hammock, both show a beach towel)
2. colorway_match: Does the color/pattern/design in the video match the product photo? Consider that lighting and camera angles affect how colors appear.

Be conservative:
- If the product in the video is too small, blurry, or partially occluded to judge, set match to false.
- If the colors are plausible but you cannot be confident due to lighting, set colorway_match to false.
- Only set both to true if you are confident in the visual match.

Respond with ONLY valid JSON (no markdown fences):
{
  "match": true,
  "product_type_match": true,
  "colorway_match": true,
  "reason": "Brief explanation of your assessment"
}`;

async function validateSingleMatch(
  apiKey: string,
  shopifyImageUrl: string,
  videoThumbnailUrl: string,
  productName: string,
  colorway: string,
  category: string,
): Promise<ValidationResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  // Fetch both images
  const [shopifyResp, thumbResp] = await Promise.all([
    fetch(shopifyImageUrl),
    fetch(videoThumbnailUrl),
  ]);

  if (!shopifyResp.ok || !thumbResp.ok) {
    throw new Error('Failed to fetch one or both images');
  }

  const shopifyBuffer = Buffer.from(await shopifyResp.arrayBuffer());
  const thumbBuffer = Buffer.from(await thumbResp.arrayBuffer());

  const prompt = VALIDATION_PROMPT
    .replace('{productName}', productName)
    .replace('{colorway}', colorway || 'unknown')
    .replace('{category}', category);

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        mimeType: shopifyResp.headers.get('content-type') ?? 'image/jpeg',
        data: shopifyBuffer.toString('base64'),
      },
    },
    {
      inlineData: {
        mimeType: thumbResp.headers.get('content-type') ?? 'image/jpeg',
        data: thumbBuffer.toString('base64'),
      },
    },
  ]);

  const text = result.response.text().trim();
  let jsonStr = text;
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(jsonStr);

  return {
    match: Boolean(parsed.match),
    product_type_match: Boolean(parsed.product_type_match),
    colorway_match: Boolean(parsed.colorway_match),
    reason: String(parsed.reason || ''),
  };
}

// ============================================================
// Batch validation: process all eligible amber matches
// ============================================================

/**
 * Find all amber video_products matches that:
 *   1. Have a product_id (not category-only)
 *   2. The linked product has an image_url (Shopify sync populated it)
 *   3. Have not been validated yet (validated_at IS NULL)
 *
 * For each, compare the Shopify product image against the video thumbnail.
 * Promote to green only if both product_type_match and colorway_match are true.
 */
export async function validateAmberMatches(
  workspaceId: string,
  geminiApiKey: string,
): Promise<ValidateMatchesResult> {
  // Query amber matches with product images, joined to get what we need
  const { data: amberMatches, error } = await supabase
    .from('video_products')
    .select(`
      id,
      video_id,
      product_id,
      category,
      products:product_id (
        id,
        name,
        colorway,
        category,
        image_url
      ),
      videos:video_id (
        id,
        drive_id,
        thumbnail_url
      )
    `)
    .eq('workspace_id', workspaceId)
    .eq('confidence', 'amber')
    .not('product_id', 'is', null)
    .is('validated_at', null);

  if (error) {
    throw new Error(`Failed to query amber matches: ${error.message}`);
  }

  const matches = amberMatches ?? [];

  // Current implementation uses Drive thumbnails. When frame extraction
  // is added, this source can be switched per-match based on availability.
  const validationSource: ValidationSource = 'drive_thumbnail';

  const result: ValidateMatchesResult = {
    total: matches.length,
    promoted: 0,
    rejected: 0,
    skipped: 0,
    errors: 0,
    source: validationSource,
  };

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];

    // Type-safe extraction from Supabase join
    const product = match.products as unknown as {
      id: string;
      name: string;
      colorway: string | null;
      category: string;
      image_url: string | null;
    } | null;

    const video = match.videos as unknown as {
      id: string;
      drive_id: string | null;
      thumbnail_url: string | null;
    } | null;

    // Skip if product has no image
    if (!product?.image_url) {
      result.skipped++;
      // Mark as validated so we don't re-check
      await supabase
        .from('video_products')
        .update({
          validated_at: new Date().toISOString(),
          validation_reason: 'Skipped: no product image available',
        })
        .eq('id', match.id);
      continue;
    }

    // Skip if video has no thumbnail
    if (!video?.drive_id) {
      result.skipped++;
      await supabase
        .from('video_products')
        .update({
          validated_at: new Date().toISOString(),
          validation_reason: 'Skipped: no video thumbnail available',
        })
        .eq('id', match.id);
      continue;
    }

    const thumbnailUrl = video.thumbnail_url ??
      `https://drive.google.com/thumbnail?id=${video.drive_id}&sz=w640`;

    try {
      const validation = await validateSingleMatch(
        geminiApiKey,
        product.image_url,
        thumbnailUrl,
        product.name,
        product.colorway ?? '',
        product.category,
      );

      const now = new Date().toISOString();

      const sourceTag = `[source:${validationSource}]`;

      if (validation.product_type_match && validation.colorway_match) {
        // Promote to green
        await supabase
          .from('video_products')
          .update({
            confidence: 'green',
            validated_at: now,
            validation_reason: `${sourceTag} ${validation.reason}`,
          })
          .eq('id', match.id);
        result.promoted++;
        console.log(`Promoted to green: ${product.name} in video ${video.drive_id} — ${validation.reason}`);
      } else {
        // Stay amber, record why
        await supabase
          .from('video_products')
          .update({
            validated_at: now,
            validation_reason: `${sourceTag} Not promoted: product_type=${validation.product_type_match}, colorway=${validation.colorway_match}. ${validation.reason}`,
          })
          .eq('id', match.id);
        result.rejected++;
        console.log(`Stayed amber: ${product.name} in video ${video.drive_id} — ${validation.reason}`);
      }
    } catch (err) {
      console.error(`Validation failed for match ${match.id}:`, err);
      result.errors++;

      // Don't mark validated_at so it can be retried
    }

    // Rate limit between calls
    if (i < matches.length - 1) {
      await delay(VALIDATION_DELAY_MS);
    }
  }

  console.log(
    `Validation complete: ${result.promoted} promoted, ${result.rejected} rejected, ` +
    `${result.skipped} skipped, ${result.errors} errors`,
  );

  return result;
}
