import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

/**
 * Ranks product colorways by how much footage exists for each one.
 *
 * Approach A: video_products junction table (structured, product_id → colorway)
 * Approach B: videos.products raw text array (broader, pattern match on colorway name)
 *
 * We use Approach A as primary (most accurate) and Approach B as validation.
 */

interface Product {
  id: string;
  name: string;
  base_product: string | null;
  colorway: string | null;
  category: string | null;
  active: boolean;
}

// Map base_product names to canonical product family labels
const BASE_TO_FAMILY: Record<string, string> = {
  'Recycled Hammock with Straps': 'Hammock',
  'Recycled Single Beach Towel': 'Single Beach Towel',
  'Recycled Double Beach Towel': 'Double Beach Towel',
  'Recycled Picnic Blanket': 'Picnic Blanket',
  'Recycled XL Picnic Blanket': 'Picnic Blanket',
  'Outdoor Puffy Blanket': 'Puffy Blanket',
  'Recycled Hooded Towel': 'Hooded Towel',
  'Recycled Kids Hooded Towel': 'Hooded Towel',
  'Recycled Tote Bag': 'Tote Bag',
  'Travel Backpack': 'Travel Backpack',
  'Recycled Cooler Backpack': 'Cooler Backpack',
  'Recycled Tarp': 'Tarp',
  'Foldable Backpack': 'Foldable Backpack',
};

async function main() {
  // ─── Step 1: Get all products with colorways ───
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, name, base_product, colorway, category, active')
    .not('colorway', 'is', null)
    .order('base_product')
    .order('colorway');

  if (prodErr) { console.error('Products query error:', prodErr); return; }
  console.log(`Total products with colorways: ${products!.length}`);

  // Group products by family
  const productsByFamily: Record<string, Product[]> = {};
  for (const p of products!) {
    const family = BASE_TO_FAMILY[p.base_product ?? ''] ?? p.category ?? 'Unknown';
    if (!productsByFamily[family]) productsByFamily[family] = [];
    productsByFamily[family].push(p as Product);
  }

  console.log('\nProduct families found:');
  for (const [fam, prods] of Object.entries(productsByFamily).sort()) {
    const colorways = [...new Set(prods.map(p => p.colorway))];
    console.log(`  ${fam}: ${prods.length} products, ${colorways.length} colorways`);
  }

  // ─── Step 2: Approach A — Count via video_products junction table ───
  console.log('\n========================================');
  console.log('APPROACH A: video_products junction table');
  console.log('========================================\n');

  for (const [family, prods] of Object.entries(productsByFamily).sort()) {
    // Group products by colorway (multiple products can share a colorway, e.g., regular + XL)
    const colorwayProducts: Record<string, string[]> = {};
    for (const p of prods) {
      const cw = p.colorway!;
      if (!colorwayProducts[cw]) colorwayProducts[cw] = [];
      colorwayProducts[cw].push(p.id);
    }

    // For each colorway, count distinct videos in video_products
    const colorwayCounts: Array<{ colorway: string; videoCount: number; active: boolean }> = [];

    for (const [colorway, productIds] of Object.entries(colorwayProducts)) {
      // Count distinct video_ids for these product_ids
      const CHUNK = 50;
      const videoIdSet = new Set<string>();

      for (let i = 0; i < productIds.length; i += CHUNK) {
        const chunk = productIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from('video_products')
          .select('video_id')
          .in('product_id', chunk);
        if (error) { console.error(`  Error querying video_products for ${colorway}:`, error.message); continue; }
        if (data) data.forEach(r => videoIdSet.add(r.video_id));
      }

      const isActive = prods.filter(p => p.colorway === colorway).some(p => p.active);
      colorwayCounts.push({ colorway, videoCount: videoIdSet.size, active: isActive });
    }

    // Sort by video count descending
    colorwayCounts.sort((a, b) => b.videoCount - a.videoCount);
    const totalVideos = colorwayCounts.reduce((s, c) => s + c.videoCount, 0);

    console.log(`=== ${family} === (${colorwayCounts.length} colorways, ${totalVideos} total video-product links)`);
    for (const [i, c] of colorwayCounts.entries()) {
      const pct = totalVideos > 0 ? ((c.videoCount / totalVideos) * 100).toFixed(1) : '0.0';
      const activeFlag = c.active ? '' : ' [INACTIVE]';
      console.log(`  ${i + 1}. ${c.colorway}: ${c.videoCount} videos (${pct}%)${activeFlag}`);
    }
    console.log();
  }

  // ─── Step 3: Approach B — Count via videos.products raw text array ───
  console.log('\n========================================');
  console.log('APPROACH B: videos.products raw text matching');
  console.log('========================================\n');

  // Get all analyzed videos with products (paginated)
  const allVideos: Array<{ id: string; products: string[] }> = [];
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from('videos')
      .select('id, products')
      .eq('status', 'analyzed')
      .not('products', 'is', null)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    allVideos.push(...(data as any[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Total analyzed videos with products: ${allVideos.length}\n`);

  for (const [family, prods] of Object.entries(productsByFamily).sort()) {
    // Get unique colorways and their full product names
    const colorwayNames: Record<string, string[]> = {};
    for (const p of prods) {
      const cw = p.colorway!;
      if (!colorwayNames[cw]) colorwayNames[cw] = [];
      colorwayNames[cw].push(p.name.toLowerCase());
    }

    const colorwayCounts: Array<{ colorway: string; videoCount: number }> = [];

    for (const [colorway, names] of Object.entries(colorwayNames)) {
      let count = 0;
      for (const v of allVideos) {
        const prodText = (v.products ?? []).map(p => p.toLowerCase());
        // Check if any product string matches any of this colorway's product names
        if (prodText.some(p => names.some(n => p.includes(n) || n.includes(p)))) {
          count++;
        }
      }
      colorwayCounts.push({ colorway, videoCount: count });
    }

    colorwayCounts.sort((a, b) => b.videoCount - a.videoCount);
    const totalVideos = colorwayCounts.reduce((s, c) => s + c.videoCount, 0);

    console.log(`=== ${family} === (${colorwayCounts.length} colorways)`);
    for (const [i, c] of colorwayCounts.entries()) {
      const pct = totalVideos > 0 ? ((c.videoCount / totalVideos) * 100).toFixed(1) : '0.0';
      console.log(`  ${i + 1}. ${c.colorway}: ${c.videoCount} videos (${pct}%)`);
    }
    console.log();
  }
}

main().catch(console.error);
