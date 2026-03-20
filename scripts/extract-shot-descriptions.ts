import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

const FAMILIES = [
  { label: 'Hammock', pattern: 'hammock' },
  { label: 'Picnic Blanket', pattern: 'picnic blanket' },
  { label: 'Puffy Blanket', pattern: 'puffy' },
  { label: 'Single Beach Towel', pattern: 'beach towel' },
  { label: 'Hooded Towel', pattern: 'hooded towel' },
  { label: 'Travel Backpack', pattern: 'travel backpack' },
  { label: 'Cooler Backpack', pattern: 'cooler' },
  { label: 'Tote Bag', pattern: 'tote bag' },
];

async function main() {
  // Get analyzed videos with products (paginate)
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

  // Classify by family
  const familyIds: Record<string, string[]> = {};
  for (const fam of FAMILIES) familyIds[fam.label] = [];
  for (const v of allVideos) {
    const text = (v.products ?? []).join(' ').toLowerCase();
    for (const fam of FAMILIES) {
      if (text.includes(fam.pattern)) familyIds[fam.label].push(v.id);
    }
  }

  // For each family, get ALL moment descriptions
  for (const fam of FAMILIES) {
    const ids = familyIds[fam.label];
    if (ids.length === 0) { console.log(`\n=== ${fam.label} === (0 videos)`); continue; }

    const moments: Array<{ label: string; description: string }> = [];
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const { data } = await supabase
        .from('video_moments')
        .select('label, description')
        .in('video_id', chunk);
      if (data) moments.push(...data);
    }

    console.log(`\n=== ${fam.label} === (${ids.length} videos, ${moments.length} moments)`);

    // Group by broad label, then show all descriptions
    const byLabel: Record<string, string[]> = {};
    for (const m of moments) {
      const lbl = m.label ?? 'unknown';
      if (!byLabel[lbl]) byLabel[lbl] = [];
      byLabel[lbl].push(m.description ?? '');
    }

    for (const [label, descs] of Object.entries(byLabel).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n  [${label}] (${descs.length} moments)`);
      // Show 30 sample descriptions for clustering
      const samples = descs.slice(0, 30);
      for (const d of samples) {
        console.log(`    - ${d.slice(0, 150)}`);
      }
      if (descs.length > 30) console.log(`    ... and ${descs.length - 30} more`);
    }
  }
}

main().catch(console.error);
