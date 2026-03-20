import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  // Check distinct analysis_mode values
  const { data } = await supabase
    .from('videos')
    .select('analysis_mode, products')
    .eq('status', 'analyzed')
    .limit(1000);

  const modes: Record<string, { withProducts: number; withoutProducts: number }> = {};
  for (const r of data ?? []) {
    const m = String(r.analysis_mode ?? 'null');
    if (!modes[m]) modes[m] = { withProducts: 0, withoutProducts: 0 };
    const hasProducts = r.products && Array.isArray(r.products) && r.products.length > 0;
    if (hasProducts) modes[m].withProducts++;
    else modes[m].withoutProducts++;
  }
  console.log('Analysis mode distribution (first 1000):');
  for (const [m, c] of Object.entries(modes)) {
    console.log(`  "${m}": ${c.withProducts} with products, ${c.withoutProducts} without`);
  }

  // Now get all full_video videos without products (paginated)
  console.log('\n── Full-video no-products investigation ──\n');

  // Check what the actual column name/value is
  const { data: sample } = await supabase
    .from('videos')
    .select('id, analysis_mode')
    .eq('status', 'analyzed')
    .not('analysis_mode', 'is', null)
    .limit(5);
  console.log('Sample analysis_mode values:', sample?.map(r => `"${r.analysis_mode}"`));

  // Get full_video analyzed videos without products
  const noProductFull: Array<any> = [];
  let from = 0;
  while (true) {
    const { data: batch } = await supabase
      .from('videos')
      .select('id, name, description, scene, content_tags, products, analysis_mode')
      .eq('status', 'analyzed')
      .not('analysis_mode', 'eq', 'thumbnail')
      .range(from, from + 999);
    if (!batch || batch.length === 0) break;
    for (const v of batch) {
      if (!v.products || (Array.isArray(v.products) && v.products.length === 0)) {
        noProductFull.push(v);
      }
    }
    if (batch.length < 1000) break;
    from += 1000;
  }

  console.log(`Non-thumbnail analyzed videos without products: ${noProductFull.length}`);

  // Categorize
  let genericCount = 0;
  let nakieMentionCount = 0;
  let noNakieCount = 0;
  let emptyCount = 0;
  const nakieMentions: any[] = [];

  for (const v of noProductFull) {
    const desc = (v.description ?? '').toLowerCase();
    if (!v.description || v.description.trim() === '') {
      emptyCount++;
    } else if (desc.includes('video from the nakie collection')) {
      genericCount++;
    } else if (desc.includes('nakie') || desc.includes('hammock') || desc.includes('towel') ||
               desc.includes('blanket') || desc.includes('backpack') || desc.includes('tote') ||
               desc.includes('protein') || desc.includes('tarp')) {
      nakieMentionCount++;
      if (nakieMentions.length < 20) nakieMentions.push(v);
    } else {
      noNakieCount++;
    }
  }

  console.log(`\nBreakdown:`);
  console.log(`  Generic summary ("Video from the Nakie collection"): ${genericCount}`);
  console.log(`  Mentions Nakie product but no tag: ${nakieMentionCount}`);
  console.log(`  No Nakie product mentioned: ${noNakieCount}`);
  console.log(`  Empty description: ${emptyCount}`);

  console.log(`\n── Nakie product mentioned but no products array ──\n`);
  for (const v of nakieMentions) {
    console.log(`  Name: ${v.name}`);
    console.log(`  Mode: ${v.analysis_mode}`);
    console.log(`  Desc: ${(v.description ?? '').slice(0, 300)}`);
    console.log(`  Scene: ${v.scene}`);
    console.log(`  Tags: ${JSON.stringify(v.content_tags)}`);
    console.log(`  ---`);
  }
}

main().catch(console.error);
