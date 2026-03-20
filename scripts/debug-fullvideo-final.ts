import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  // Get all analyzed videos (minimal columns, paginated)
  const allVideos: Array<{ id: string; products: string[] | null; analysis_mode: string | null }> = [];
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from('videos')
      .select('id, products, analysis_mode')
      .eq('status', 'analyzed')
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    allVideos.push(...(data as any[]));
    if (data.length < 1000) break;
    from += 1000;
  }

  const hasProducts = (v: any) => v.products && Array.isArray(v.products) && v.products.length > 0;
  const isFullVideo = (v: any) => String(v.analysis_mode ?? '').includes('full_video');
  const isThumbnail = (v: any) => String(v.analysis_mode ?? '').includes('thumbnail');

  const fullNoProduct = allVideos.filter(v => isFullVideo(v) && !hasProducts(v));
  const fullWithProduct = allVideos.filter(v => isFullVideo(v) && hasProducts(v));
  const thumbNoProduct = allVideos.filter(v => isThumbnail(v) && !hasProducts(v));
  const thumbWithProduct = allVideos.filter(v => isThumbnail(v) && hasProducts(v));

  console.log(`Total analyzed: ${allVideos.length}`);
  console.log(`full_video WITH products: ${fullWithProduct.length}`);
  console.log(`full_video WITHOUT products: ${fullNoProduct.length}`);
  console.log(`thumbnail WITH products: ${thumbWithProduct.length}`);
  console.log(`thumbnail WITHOUT products: ${thumbNoProduct.length}`);

  // Fetch summaries for full_video no-product cases in batches
  console.log(`\n── Categorizing ${fullNoProduct.length} full_video no-product videos ──\n`);

  let genericCount = 0;
  let nakieMentionCount = 0;
  let noNakieCount = 0;
  let emptyCount = 0;
  const nakieMentions: any[] = [];
  const noNakieSamples: any[] = [];
  const genericSamples: any[] = [];

  for (let i = 0; i < fullNoProduct.length; i += 50) {
    const ids = fullNoProduct.slice(i, i + 50).map(v => v.id);
    const { data } = await supabase
      .from('videos')
      .select('id, name, summary, scene, content_tags')
      .in('id', ids);
    if (!data) continue;

    for (const v of data) {
      const summ = (v.summary ?? '').toLowerCase();
      if (!v.summary || v.summary.trim() === '') {
        emptyCount++;
      } else if (summ.includes('video from the nakie collection')) {
        genericCount++;
        if (genericSamples.length < 5) genericSamples.push(v);
      } else if (summ.includes('nakie') || summ.includes('hammock') || summ.includes('towel') ||
                 summ.includes('blanket') || summ.includes('backpack') || summ.includes('tote') ||
                 summ.includes('protein') || summ.includes('tarp') || summ.includes('cooler')) {
        nakieMentionCount++;
        if (nakieMentions.length < 20) nakieMentions.push(v);
      } else {
        noNakieCount++;
        if (noNakieSamples.length < 10) noNakieSamples.push(v);
      }
    }
  }

  console.log(`Generic summary ("Video from the Nakie collection"): ${genericCount}`);
  console.log(`Mentions Nakie/product but no tag: ${nakieMentionCount}`);
  console.log(`No Nakie product mentioned: ${noNakieCount}`);
  console.log(`Empty summary: ${emptyCount}`);

  console.log(`\n── CRITICAL: ${nakieMentionCount} full_video with product mention but empty products ──\n`);
  for (const v of nakieMentions) {
    console.log(`  Name: ${v.name}`);
    console.log(`  Summary: ${(v.summary ?? '').slice(0, 300)}`);
    console.log(`  Scene: ${v.scene}  |  Tags: ${JSON.stringify(v.content_tags)}`);
    console.log(`  ---`);
  }

  console.log(`\n── ${noNakieCount} full_video: no Nakie mention (legitimate no-product) ──\n`);
  for (const v of noNakieSamples) {
    console.log(`  Name: ${v.name}`);
    console.log(`  Summary: ${(v.summary ?? '').slice(0, 200)}`);
    console.log(`  ---`);
  }

  console.log(`\n── ${genericCount} full_video: generic placeholder summaries ──\n`);
  for (const v of genericSamples) {
    console.log(`  ${v.name} | Scene: ${v.scene} | Tags: ${JSON.stringify(v.content_tags)}`);
  }

  // Thumbnail stats
  console.log(`\n── Thumbnail analysis (${thumbNoProduct.length} without products) ──\n`);
  let thumbGeneric = 0;
  let thumbNakie = 0;
  let thumbEmpty = 0;
  let thumbOther = 0;

  for (let i = 0; i < Math.min(thumbNoProduct.length, 2000); i += 50) {
    const ids = thumbNoProduct.slice(i, i + 50).map(v => v.id);
    const { data } = await supabase
      .from('videos')
      .select('id, summary')
      .in('id', ids);
    if (!data) continue;
    for (const v of data) {
      const summ = (v.summary ?? '').toLowerCase();
      if (!v.summary || v.summary.trim() === '') thumbEmpty++;
      else if (summ.includes('video from the nakie collection')) thumbGeneric++;
      else if (summ.includes('nakie') || summ.includes('hammock') || summ.includes('towel') ||
               summ.includes('blanket') || summ.includes('backpack')) thumbNakie++;
      else thumbOther++;
    }
  }
  console.log(`(sampled first 2000 of ${thumbNoProduct.length})`);
  console.log(`  Generic placeholder: ${thumbGeneric}`);
  console.log(`  Mentions Nakie product: ${thumbNakie}`);
  console.log(`  Empty summary: ${thumbEmpty}`);
  console.log(`  No product mention: ${thumbOther}`);

  // Unmatched product strings
  console.log(`\n── UNMATCHED PRODUCT STRINGS (sorted by video count) ──\n`);
  const PATTERNS = [
    'hammock', 'picnic blanket', 'tote bag', 'travel backpack',
    'foldable backpack', 'beach towel', 'beach blanket', 'hooded towel',
    'protein bar', 'bug net', 'tarp', 'puffy blanket', 'cooler backpack',
    'cooler', 'backpack', 'towel', 'blanket',
  ];
  const psCounts: Record<string, number> = {};
  for (const v of allVideos) {
    if (v.products && Array.isArray(v.products)) {
      for (const p of v.products) psCounts[p] = (psCounts[p] ?? 0) + 1;
    }
  }

  const unmatched: Array<[string, number]> = [];
  for (const [ps, count] of Object.entries(psCounts)) {
    if (!PATTERNS.some(p => ps.toLowerCase().includes(p))) {
      unmatched.push([ps, count]);
    }
  }
  unmatched.sort((a, b) => b[1] - a[1]);
  console.log(`${unmatched.length} unmatched out of ${Object.keys(psCounts).length} distinct strings`);
  for (const [ps, count] of unmatched.slice(0, 40)) {
    console.log(`  "${ps}" → ${count} videos`);
  }
}

main().catch(console.error);
