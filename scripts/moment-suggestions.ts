import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

const PRODUCT_FAMILIES = [
  { label: 'Hammock', pattern: 'hammock' },
  { label: 'Picnic Blanket', pattern: 'picnic blanket' },
  { label: 'Puffy Blanket', pattern: 'puffy blanket' },
  { label: 'Single Beach Towel', pattern: 'beach towel' },
  { label: 'Double Beach Towel', pattern: 'beach blanket' },
  { label: 'Hooded Towel', pattern: 'hooded towel' },
  { label: 'Travel Backpack', pattern: 'travel backpack' },
  { label: 'Cooler Backpack', pattern: 'cooler backpack' },
  { label: 'Tote Bag', pattern: 'tote bag' },
  { label: 'Foldable Backpack', pattern: 'foldable backpack' },
  { label: 'Tarp', pattern: 'tarp' },
  { label: 'Bug Net', pattern: 'bug net' },
  { label: 'Protein Bars', pattern: 'protein bar' },
];

async function main() {
  // Get all analyzed videos with products
  const allVideos: Array<{ id: string; products: string[] }> = [];
  let from = 0;
  const PAGE = 1000;

  while (true) {
    const { data } = await supabase
      .from('videos')
      .select('id, products')
      .eq('status', 'analyzed')
      .not('products', 'is', null)
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    allVideos.push(...(data as any[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`Total analyzed videos with products: ${allVideos.length}`);

  // Classify videos by product family
  const familyVideoIds: Record<string, string[]> = {};
  for (const fam of PRODUCT_FAMILIES) {
    familyVideoIds[fam.label] = [];
  }

  for (const v of allVideos) {
    const prodText = (v.products ?? []).join(' ').toLowerCase();
    for (const fam of PRODUCT_FAMILIES) {
      if (prodText.includes(fam.pattern)) {
        familyVideoIds[fam.label].push(v.id);
      }
    }
  }

  // For each family, fetch moments and aggregate labels
  for (const fam of PRODUCT_FAMILIES) {
    const videoIds = familyVideoIds[fam.label];
    if (videoIds.length === 0) {
      console.log(`\n=== ${fam.label} === (0 videos, skipping)`);
      continue;
    }

    // Fetch moments for these videos (paginate if needed)
    const allMoments: Array<{ label: string; description: string }> = [];
    const CHUNK = 200;
    for (let i = 0; i < videoIds.length; i += CHUNK) {
      const chunk = videoIds.slice(i, i + CHUNK);
      const { data: moments } = await supabase
        .from('video_moments')
        .select('label, description')
        .in('video_id', chunk);
      if (moments) allMoments.push(...moments);
    }

    // Count labels
    const labelCounts: Record<string, number> = {};
    const labelDescriptions: Record<string, string[]> = {};
    for (const m of allMoments) {
      const lbl = m.label ?? 'unknown';
      labelCounts[lbl] = (labelCounts[lbl] ?? 0) + 1;
      if (!labelDescriptions[lbl]) labelDescriptions[lbl] = [];
      if (labelDescriptions[lbl].length < 5) {
        labelDescriptions[lbl].push(m.description ?? '');
      }
    }

    // Sort by frequency
    const sorted = Object.entries(labelCounts).sort((a, b) => b[1] - a[1]);

    console.log(`\n=== ${fam.label} === (${videoIds.length} videos, ${allMoments.length} moments)`);
    for (const [label, count] of sorted) {
      const pct = ((count / allMoments.length) * 100).toFixed(1);
      console.log(`  ${label}: ${count} (${pct}%)`);
      // Show 2 sample descriptions
      for (const desc of (labelDescriptions[label] ?? []).slice(0, 2)) {
        console.log(`    → ${desc.slice(0, 120)}`);
      }
    }
  }
}

main().catch(console.error);
