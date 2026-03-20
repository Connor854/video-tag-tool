import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  // Get ALL analyzed videos (paginated), categorize in code
  const allVideos: Array<any> = [];
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from('videos')
      .select('id, name, description, scene, content_tags, products, analysis_mode')
      .eq('status', 'analyzed')
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    allVideos.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  console.log(`Total analyzed: ${allVideos.length}`);

  // Check raw analysis_mode values
  const rawModes = new Set(allVideos.map(v => JSON.stringify(v.analysis_mode)));
  console.log(`Distinct analysis_mode values: ${[...rawModes].join(', ')}`);

  // Classify
  const isFullVideo = (v: any) => {
    const m = String(v.analysis_mode ?? '');
    return m.includes('full_video');
  };
  const isThumbnail = (v: any) => {
    const m = String(v.analysis_mode ?? '');
    return m.includes('thumbnail');
  };
  const hasProducts = (v: any) => v.products && Array.isArray(v.products) && v.products.length > 0;

  const fullNoProduct = allVideos.filter(v => isFullVideo(v) && !hasProducts(v));
  const fullWithProduct = allVideos.filter(v => isFullVideo(v) && hasProducts(v));
  const thumbNoProduct = allVideos.filter(v => isThumbnail(v) && !hasProducts(v));
  const thumbWithProduct = allVideos.filter(v => isThumbnail(v) && hasProducts(v));

  console.log(`\nfull_video WITH products: ${fullWithProduct.length}`);
  console.log(`full_video WITHOUT products: ${fullNoProduct.length}`);
  console.log(`thumbnail WITH products: ${thumbWithProduct.length}`);
  console.log(`thumbnail WITHOUT products: ${thumbNoProduct.length}`);

  // Categorize full_video no-product videos
  let genericCount = 0;
  let nakieMentionCount = 0;
  let noNakieCount = 0;
  let emptyCount = 0;
  const nakieMentions: any[] = [];
  const noNakieSamples: any[] = [];
  const genericSamples: any[] = [];

  for (const v of fullNoProduct) {
    const desc = (v.description ?? '').toLowerCase();
    if (!v.description || v.description.trim() === '') {
      emptyCount++;
    } else if (desc.includes('video from the nakie collection')) {
      genericCount++;
      if (genericSamples.length < 5) genericSamples.push(v);
    } else if (desc.includes('nakie') || desc.includes('hammock') || desc.includes('towel') ||
               desc.includes('blanket') || desc.includes('backpack') || desc.includes('tote') ||
               desc.includes('protein') || desc.includes('tarp') || desc.includes('cooler')) {
      nakieMentionCount++;
      if (nakieMentions.length < 20) nakieMentions.push(v);
    } else {
      noNakieCount++;
      if (noNakieSamples.length < 10) noNakieSamples.push(v);
    }
  }

  console.log(`\n── full_video WITHOUT products breakdown ──`);
  console.log(`  Generic summary: ${genericCount}`);
  console.log(`  Mentions Nakie product: ${nakieMentionCount}`);
  console.log(`  No Nakie mention: ${noNakieCount}`);
  console.log(`  Empty description: ${emptyCount}`);

  console.log(`\n── CRITICAL: Mentions product but no tag (${nakieMentionCount}) ──\n`);
  for (const v of nakieMentions) {
    console.log(`  Name: ${v.name}`);
    console.log(`  Desc: ${(v.description ?? '').slice(0, 300)}`);
    console.log(`  Products: ${JSON.stringify(v.products)}`);
    console.log(`  ---`);
  }

  console.log(`\n── No Nakie mention (legitimate no-product) ──\n`);
  for (const v of noNakieSamples) {
    console.log(`  Name: ${v.name}`);
    console.log(`  Desc: ${(v.description ?? '').slice(0, 200)}`);
    console.log(`  ---`);
  }

  console.log(`\n── Generic placeholders (full_video) ──\n`);
  for (const v of genericSamples) {
    console.log(`  Name: ${v.name} | Scene: ${v.scene} | Tags: ${JSON.stringify(v.content_tags)}`);
  }

  // Also check: how many thumbnail videos have the generic summary?
  const thumbGeneric = thumbNoProduct.filter(v =>
    (v.description ?? '').toLowerCase().includes('video from the nakie collection')
  );
  console.log(`\n── Thumbnail generic summary count: ${thumbGeneric.length} / ${thumbNoProduct.length} ──`);

  // Count the 223 unmatched product strings in more detail
  console.log(`\n── UNMATCHED PRODUCT STRINGS ANALYSIS ──\n`);
  const PATTERNS = [
    'hammock', 'picnic blanket', 'tote bag', 'travel backpack',
    'foldable backpack', 'beach towel', 'beach blanket', 'hooded towel',
    'protein bar', 'bug net', 'tarp', 'puffy blanket', 'cooler backpack',
    'cooler', 'backpack', 'towel', 'blanket',
  ];
  const allProductStrings = new Set<string>();
  for (const v of allVideos) {
    if (v.products && Array.isArray(v.products)) {
      for (const p of v.products) allProductStrings.add(p);
    }
  }

  const unmatched: string[] = [];
  for (const ps of allProductStrings) {
    const lower = ps.toLowerCase();
    if (!PATTERNS.some(p => lower.includes(p))) {
      unmatched.push(ps);
    }
  }

  // Group unmatched by likely category
  const unmatchedGroups: Record<string, string[]> = {
    'backpack_variants': [],
    'carry_pouch_bag': [],
    'colorway_only': [],
    'accessory': [],
    'other': [],
  };

  for (const s of unmatched) {
    const lower = s.toLowerCase();
    if (lower.includes('backpack') || lower.includes('bag') && lower.includes('back')) {
      unmatchedGroups['backpack_variants'].push(s);
    } else if (lower.includes('pouch') || lower.includes('carry') || lower.includes('bag')) {
      unmatchedGroups['carry_pouch_bag'].push(s);
    } else if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(s) || lower.includes('colour') || lower.includes('color')) {
      unmatchedGroups['colorway_only'].push(s);
    } else if (lower.includes('magnesium') || lower.includes('gym') || lower.includes('cap') ||
               lower.includes('hat') || lower.includes('spray')) {
      unmatchedGroups['accessory'].push(s);
    } else {
      unmatchedGroups['other'].push(s);
    }
  }

  for (const [group, items] of Object.entries(unmatchedGroups)) {
    if (items.length === 0) continue;
    console.log(`  ${group} (${items.length}):`);
    for (const i of items.slice(0, 15)) {
      // Count how many videos have this string
      let count = 0;
      for (const v of allVideos) {
        if (v.products?.includes(i)) count++;
      }
      console.log(`    "${i}" (${count} videos)`);
    }
    if (items.length > 15) console.log(`    ... and ${items.length - 15} more`);
  }
}

main().catch(console.error);
