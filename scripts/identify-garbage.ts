/**
 * Identify garbage "analyzed" rows from the failed overnight batch.
 * Does NOT modify anything — just reports what would be reset.
 */
import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  // Criteria for garbage rows from the failed batch:
  // 1. status = 'analyzed'
  // 2. analysis_mode = 'thumbnail' (all failed full-video uploads fell back to thumbnail)
  // 3. products = '[]' (empty array — DEFAULT_RESULT has no products)
  // 4. key_moments = '[]' (empty array — DEFAULT_RESULT has no moments)
  // 5. summary starts with 'Video from the Nakie collection' (DEFAULT_RESULT description)
  //
  // These criteria together precisely identify rows where the thumbnail
  // fallback silently returned DEFAULT_RESULT due to the invalid API key.
  // Legitimate thumbnail analyses would have actual products/moments/descriptions.

  // Count matching rows
  const { data: garbage, error } = await supabase
    .from('videos')
    .select('id, name, summary, products, key_moments, analysis_mode, indexed_at')
    .eq('status', 'analyzed')
    .eq('analysis_mode', 'thumbnail')
    .eq('summary', 'Video from the Nakie collection.')
    .limit(5000);

  if (error) {
    console.error('Query error:', error);
    return;
  }

  const confirmed = (garbage ?? []).filter(v => {
    const products = v.products as any[];
    const moments = v.key_moments as any[];
    return (products?.length ?? 0) === 0 && (moments?.length ?? 0) === 0;
  });

  console.log(`=== Garbage Identification ===`);
  console.log(`  Total 'analyzed' with thumbnail + default summary: ${garbage?.length ?? 0}`);
  console.log(`  Of those, also have empty products AND moments: ${confirmed.length}`);

  // Check date range
  if (confirmed.length > 0) {
    const dates = confirmed.map(v => v.indexed_at).filter(Boolean).sort();
    console.log(`  Earliest indexed_at: ${dates[0]}`);
    console.log(`  Latest indexed_at: ${dates[dates.length - 1]}`);
  }

  // Show 5 examples
  console.log(`\n=== Sample Garbage Rows ===`);
  for (const v of confirmed.slice(0, 5)) {
    console.log(`  ${v.name} | indexed: ${v.indexed_at} | summary: "${(v.summary ?? '').slice(0, 60)}"`);
  }

  // Now check: are there any LEGITIMATE analyzed+thumbnail rows that DON'T match?
  // These would be from earlier successful runs or real thumbnail analyses.
  const { data: legit } = await supabase
    .from('videos')
    .select('id, name, summary, products, analysis_mode')
    .eq('status', 'analyzed')
    .eq('analysis_mode', 'thumbnail')
    .neq('summary', 'Video from the Nakie collection.')
    .limit(20);

  console.log(`\n=== Legitimate Thumbnail Analyses (would NOT be reset) ===`);
  console.log(`  Count: ${legit?.length ?? 0}`);
  for (const v of (legit ?? []).slice(0, 5)) {
    const prods = (v.products as any[])?.length ?? 0;
    console.log(`  ${v.name} | products=${prods} | summary: "${(v.summary ?? '').slice(0, 60)}"`);
  }

  // Also check: any analyzed rows with full_video mode?
  const { count: fullVideoCount } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'analyzed')
    .eq('analysis_mode', 'full_video');

  console.log(`\n=== Full Video Analyses (would NOT be reset) ===`);
  console.log(`  Count: ${fullVideoCount ?? 0}`);

  // Also check rows still stuck in 'analyzing'
  const { data: stuck } = await supabase
    .from('videos')
    .select('id, name')
    .eq('status', 'analyzing');

  console.log(`\n=== Stuck in 'analyzing' (will also reset) ===`);
  console.log(`  Count: ${stuck?.length ?? 0}`);
  for (const v of stuck ?? []) {
    console.log(`  ${v.name}`);
  }
}

main().catch(console.error);
