import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

/**
 * Ranks product colorways by footage volume.
 * Uses video_products junction table with proper pagination.
 * Groups by canonical product family.
 */

// Map (base_product, category) → canonical product family
function getFamily(baseProduct: string, category: string): string | null {
  const bp = baseProduct.toLowerCase();
  const cat = category.toLowerCase();

  if (bp.includes('hammock')) return 'Hammock';
  if (bp.includes('picnic blanket')) return 'Picnic Blanket';
  if (bp.includes('puffy blanket') || bp.includes('sustainable down')) return 'Puffy Blanket';
  if (bp.includes('beach blanket') || bp.includes('xl sand free')) return 'Double Beach Towel';
  if (bp.includes('beach towel') || bp.includes('sand free beach towel')) return 'Single Beach Towel';
  if (cat === 'kids hooded towel') return 'Hooded Towel';
  if (bp.includes('hooded towel')) return 'Hooded Towel';
  if (bp.includes('cooler backpack')) return 'Cooler Backpack';
  if (bp.includes('travel backpack')) return 'Travel Backpack';
  if (bp.includes('tote bag')) return 'Tote Bag';
  if (bp.includes('tarp')) return 'Tarp';
  if (bp.includes('protein bar')) return 'Protein Bars';
  if (bp.includes('foldable backpack') || bp === '30l') return 'Foldable Backpack';

  return null; // skip bundles, spare parts, promos, GWP, etc.
}

// Colorways that are not real colorways (size variants, meta entries)
const SKIP_COLORWAYS = new Set([
  'Giveaway Winner', 'Kids Large', 'Kids Medium', 'Spare Parts',
  'Couples Combo', 'NRL Couples Combo',
]);

async function countVideosForProducts(productIds: string[]): Promise<number> {
  const videoIds = new Set<string>();
  const PAGE = 1000;

  for (const pid of productIds) {
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('video_products')
        .select('video_id')
        .eq('product_id', pid)
        .range(from, from + PAGE - 1);
      if (error) { console.error(`Error for ${pid}:`, error.message); break; }
      if (!data || data.length === 0) break;
      data.forEach(r => videoIds.add(r.video_id));
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  return videoIds.size;
}

async function main() {
  // Get all products with colorways
  const { data: products } = await supabase
    .from('products')
    .select('id, name, base_product, colorway, category, active')
    .not('colorway', 'is', null);

  if (!products) { console.error('No products found'); return; }

  // Group by family → colorway → product IDs
  const familyData: Record<string, Record<string, { productIds: string[]; active: boolean }>> = {};

  for (const p of products) {
    const family = getFamily(p.base_product ?? '', p.category ?? '');
    if (!family) continue;

    const cw = p.colorway as string;
    if (SKIP_COLORWAYS.has(cw)) continue;

    if (!familyData[family]) familyData[family] = {};
    if (!familyData[family][cw]) familyData[family][cw] = { productIds: [], active: false };
    familyData[family][cw].productIds.push(p.id);
    if (p.active) familyData[family][cw].active = true;
  }

  // Count videos per colorway per family
  const FAMILIES_ORDER = [
    'Hammock', 'Picnic Blanket', 'Puffy Blanket', 'Single Beach Towel',
    'Double Beach Towel', 'Hooded Towel', 'Travel Backpack', 'Cooler Backpack',
    'Tote Bag', 'Tarp', 'Protein Bars', 'Foldable Backpack',
  ];

  for (const family of FAMILIES_ORDER) {
    const colorways = familyData[family];
    if (!colorways) {
      console.log(`\n=== ${family} === (no products found)`);
      continue;
    }

    const results: Array<{ colorway: string; count: number; active: boolean }> = [];

    for (const [cw, data] of Object.entries(colorways)) {
      const count = await countVideosForProducts(data.productIds);
      results.push({ colorway: cw, count, active: data.active });
    }

    results.sort((a, b) => b.count - a.count);
    const total = results.reduce((s, r) => s + r.count, 0);

    console.log(`\n=== ${family} === (${results.length} colorways, ${total} total video links)`);
    for (const [i, r] of results.entries()) {
      const pct = total > 0 ? ((r.count / total) * 100).toFixed(1) : '0.0';
      const flags: string[] = [];
      if (!r.active) flags.push('INACTIVE');
      if (r.count === 0) flags.push('NO DATA');
      const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
      console.log(`  ${i + 1}. ${r.colorway}: ${r.count} videos (${pct}%)${flagStr}`);
    }
  }
}

main().catch(console.error);
