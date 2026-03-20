import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  // Get full_video analyzed videos with no products
  const allVideos: Array<any> = [];
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from('videos')
      .select('id, name, description, scene, content_tags, products, analysis_mode')
      .eq('status', 'analyzed')
      .eq('analysis_mode', 'full_video')
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    allVideos.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const noProducts = allVideos.filter(v =>
    !v.products || (Array.isArray(v.products) && v.products.length === 0)
  );
  const withProducts = allVideos.filter(v =>
    v.products && Array.isArray(v.products) && v.products.length > 0
  );

  console.log(`Full video analyzed: ${allVideos.length}`);
  console.log(`  With products: ${withProducts.length}`);
  console.log(`  Without products: ${noProducts.length}`);

  // Categorize the no-product full_video videos
  const categories: Record<string, any[]> = {
    'generic_summary': [],      // "Video from the Nakie collection"
    'no_nakie_product': [],     // Real summary but no product visible
    'has_nakie_mention': [],    // Summary mentions Nakie but no product tagged
    'empty_description': [],    // No description at all
    'other': [],
  };

  for (const v of noProducts) {
    const desc = (v.description ?? '').toLowerCase();
    if (!v.description || v.description.trim() === '') {
      categories['empty_description'].push(v);
    } else if (desc.includes('video from the nakie collection')) {
      categories['generic_summary'].push(v);
    } else if (desc.includes('nakie') || desc.includes('hammock') || desc.includes('towel') ||
               desc.includes('blanket') || desc.includes('backpack') || desc.includes('tote') ||
               desc.includes('protein') || desc.includes('tarp')) {
      categories['has_nakie_mention'].push(v);
    } else {
      categories['no_nakie_product'].push(v);
    }
  }

  console.log('\n── CATEGORIES OF full_video VIDEOS WITH NO PRODUCTS ──\n');
  for (const [cat, vids] of Object.entries(categories)) {
    console.log(`${cat}: ${vids.length}`);
  }

  // Show samples of the most interesting category: has_nakie_mention
  console.log('\n── SAMPLES: has_nakie_mention (product mentioned but not tagged) ──\n');
  for (const v of categories['has_nakie_mention'].slice(0, 15)) {
    console.log(`  ID: ${v.id}`);
    console.log(`  Name: ${v.name}`);
    console.log(`  Description: ${(v.description ?? '').slice(0, 250)}`);
    console.log(`  Scene: ${v.scene}`);
    console.log(`  Tags: ${JSON.stringify(v.content_tags)}`);
    console.log(`  Products: ${JSON.stringify(v.products)}`);
    console.log(`  ---`);
  }

  // Show samples of no_nakie_product (genuinely no product visible)
  console.log('\n── SAMPLES: no_nakie_product (genuinely no product) ──\n');
  for (const v of categories['no_nakie_product'].slice(0, 10)) {
    console.log(`  ID: ${v.id}`);
    console.log(`  Name: ${v.name}`);
    console.log(`  Description: ${(v.description ?? '').slice(0, 250)}`);
    console.log(`  ---`);
  }

  // Show samples of generic_summary (analysis produced nothing useful)
  console.log('\n── SAMPLES: generic_summary (analysis produced placeholder) ──\n');
  for (const v of categories['generic_summary'].slice(0, 10)) {
    console.log(`  ID: ${v.id}  |  Name: ${v.name}  |  Scene: ${v.scene}  |  Tags: ${JSON.stringify(v.content_tags)}`);
  }

  // Check the 196 videos with products but no junction entries
  console.log('\n── 196 VIDEOS: products column populated but no video_products rows ──\n');
  const { data: orphans } = await supabase
    .from('videos')
    .select('id, name, products, analysis_mode')
    .eq('status', 'analyzed')
    .not('products', 'is', null)
    .limit(1000);

  if (orphans) {
    let orphanCount = 0;
    const orphanProducts: Record<string, number> = {};
    for (const v of orphans) {
      if (!v.products || v.products.length === 0) continue;
      const { data: junc } = await supabase
        .from('video_products')
        .select('id')
        .eq('video_id', v.id)
        .limit(1);
      if (!junc || junc.length === 0) {
        orphanCount++;
        for (const p of v.products) {
          orphanProducts[p] = (orphanProducts[p] ?? 0) + 1;
        }
        if (orphanCount <= 5) {
          console.log(`  ${v.name}: ${JSON.stringify(v.products)}`);
        }
      }
      if (orphanCount > 200) break;
    }
    console.log(`\n  Total orphan videos found (in first 1000): ${orphanCount}`);
    console.log(`\n  Product strings in orphans (top 20):`);
    const sorted = Object.entries(orphanProducts).sort((a, b) => b[1] - a[1]).slice(0, 20);
    for (const [p, c] of sorted) {
      console.log(`    "${p}": ${c}`);
    }
  }
}

main().catch(console.error);
