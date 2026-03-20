import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  // Step 1: Get all analyzed videos in batches (minimal columns first)
  console.log('Fetching all analyzed video IDs and metadata...');
  const allVideos: Array<{ id: string; products: string[] | null; analysis_mode: string | null }> = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('videos')
      .select('id, products, analysis_mode')
      .eq('status', 'analyzed')
      .range(from, from + 999);
    if (error) { console.error('Query error:', error.message); break; }
    if (!data || data.length === 0) break;
    allVideos.push(...(data as any[]));
    if (data.length < 1000) break;
    from += 1000;
  }

  console.log(`Total analyzed: ${allVideos.length}`);

  // Classify
  const hasProducts = (v: any) => v.products && Array.isArray(v.products) && v.products.length > 0;
  const isFullVideo = (v: any) => String(v.analysis_mode ?? '').includes('full_video');
  const isThumbnail = (v: any) => String(v.analysis_mode ?? '').includes('thumbnail');

  const fullWithProduct = allVideos.filter(v => isFullVideo(v) && hasProducts(v));
  const fullNoProduct = allVideos.filter(v => isFullVideo(v) && !hasProducts(v));
  const thumbWithProduct = allVideos.filter(v => isThumbnail(v) && hasProducts(v));
  const thumbNoProduct = allVideos.filter(v => isThumbnail(v) && !hasProducts(v));
  const otherMode = allVideos.filter(v => !isFullVideo(v) && !isThumbnail(v));

  console.log(`\nfull_video WITH products: ${fullWithProduct.length}`);
  console.log(`full_video WITHOUT products: ${fullNoProduct.length}`);
  console.log(`thumbnail WITH products: ${thumbWithProduct.length}`);
  console.log(`thumbnail WITHOUT products: ${thumbNoProduct.length}`);
  console.log(`other/null mode: ${otherMode.length}`);

  // Step 2: For the full_video no-product cases, fetch descriptions in small batches
  console.log(`\nFetching descriptions for ${fullNoProduct.length} full_video no-product videos...`);

  let genericCount = 0;
  let nakieMentionCount = 0;
  let noNakieCount = 0;
  let emptyCount = 0;
  const nakieMentions: any[] = [];
  const noNakieSamples: any[] = [];

  const BATCH = 50;
  for (let i = 0; i < fullNoProduct.length; i += BATCH) {
    const ids = fullNoProduct.slice(i, i + BATCH).map(v => v.id);
    const { data } = await supabase
      .from('videos')
      .select('id, name, description, scene, content_tags')
      .in('id', ids);
    if (!data) continue;

    for (const v of data) {
      const desc = (v.description ?? '').toLowerCase();
      if (!v.description || v.description.trim() === '') {
        emptyCount++;
      } else if (desc.includes('video from the nakie collection')) {
        genericCount++;
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
  }

  console.log(`\n── full_video WITHOUT products breakdown (${fullNoProduct.length} total) ──`);
  console.log(`  Generic summary: ${genericCount}`);
  console.log(`  Mentions Nakie/product but no tag: ${nakieMentionCount}`);
  console.log(`  No Nakie mention (legit no product): ${noNakieCount}`);
  console.log(`  Empty description: ${emptyCount}`);

  console.log(`\n── CRITICAL: full_video mentions product but NO products array (${nakieMentionCount}) ──\n`);
  for (const v of nakieMentions) {
    console.log(`  Name: ${v.name}`);
    console.log(`  Desc: ${(v.description ?? '').slice(0, 300)}`);
    console.log(`  Scene: ${v.scene}  |  Tags: ${JSON.stringify(v.content_tags)}`);
    console.log(`  ---`);
  }

  console.log(`\n── No Nakie mention samples ──\n`);
  for (const v of noNakieSamples) {
    console.log(`  Name: ${v.name}`);
    console.log(`  Desc: ${(v.description ?? '').slice(0, 200)}`);
    console.log(`  ---`);
  }

  // Step 3: Unmatched product strings analysis
  console.log(`\n── UNMATCHED PRODUCT STRINGS ──\n`);
  const PATTERNS = [
    'hammock', 'picnic blanket', 'tote bag', 'travel backpack',
    'foldable backpack', 'beach towel', 'beach blanket', 'hooded towel',
    'protein bar', 'bug net', 'tarp', 'puffy blanket', 'cooler backpack',
    'cooler', 'backpack', 'towel', 'blanket',
  ];
  const productStringCounts: Record<string, number> = {};
  for (const v of allVideos) {
    if (v.products && Array.isArray(v.products)) {
      for (const p of v.products) {
        productStringCounts[p] = (productStringCounts[p] ?? 0) + 1;
      }
    }
  }

  const unmatchedWithCounts: Array<[string, number]> = [];
  for (const [ps, count] of Object.entries(productStringCounts)) {
    const lower = ps.toLowerCase();
    if (!PATTERNS.some(p => lower.includes(p))) {
      unmatchedWithCounts.push([ps, count]);
    }
  }
  unmatchedWithCounts.sort((a, b) => b[1] - a[1]);

  console.log(`Total distinct product strings: ${Object.keys(productStringCounts).length}`);
  console.log(`Unmatched strings: ${unmatchedWithCounts.length}`);
  console.log(`\nTop 30 unmatched by frequency:`);
  for (const [ps, count] of unmatchedWithCounts.slice(0, 30)) {
    console.log(`  "${ps}" → ${count} videos`);
  }
}

main().catch(console.error);
