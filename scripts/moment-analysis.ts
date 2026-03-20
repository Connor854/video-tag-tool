/**
 * Analyze video_moments data to assess feasibility of product-specific moment suggestions.
 * Read-only queries only.
 *
 * Usage:
 *   export $(grep -v '^#' .env | xargs) && npx tsx scripts/moment-analysis.ts
 */

import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  // ── 1. Total moment count ──────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('1. TOTAL MOMENT COUNT');
  console.log('═══════════════════════════════════════════════════════');

  const { count: totalMoments, error: countErr } = await supabase
    .from('video_moments')
    .select('*', { count: 'exact', head: true });

  if (countErr) {
    console.error('Error counting moments:', countErr);
    return;
  }
  console.log(`Total rows in video_moments: ${totalMoments}`);

  // ── 2. Moment labels – top 50 ──────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('2. TOP 50 MOMENT LABELS');
  console.log('═══════════════════════════════════════════════════════');

  // Supabase JS doesn't support GROUP BY, so we fetch all labels and count client-side.
  // Paginate to get them all.
  const labelCounts: Record<string, number> = {};
  let labelPage = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('video_moments')
      .select('label')
      .range(labelPage * pageSize, (labelPage + 1) * pageSize - 1);
    if (error) { console.error('Error fetching labels:', error); break; }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const l = row.label ?? '(null)';
      labelCounts[l] = (labelCounts[l] || 0) + 1;
    }
    if (data.length < pageSize) break;
    labelPage++;
  }

  const sortedLabels = Object.entries(labelCounts)
    .sort((a, b) => b[1] - a[1]);

  console.log(`Distinct labels: ${sortedLabels.length}`);
  console.log('\nRank | Count | Label');
  console.log('-----|-------|------');
  for (let i = 0; i < Math.min(50, sortedLabels.length); i++) {
    console.log(`${String(i + 1).padStart(4)} | ${String(sortedLabels[i][1]).padStart(5)} | ${sortedLabels[i][0]}`);
  }

  // ── 3. Sample descriptions ────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('3. SAMPLE MOMENT DESCRIPTIONS (30)');
  console.log('═══════════════════════════════════════════════════════');

  const { data: sampleDescs, error: descErr } = await supabase
    .from('video_moments')
    .select('label, description, start_seconds')
    .not('description', 'is', null)
    .limit(30);

  if (descErr) console.error('Error:', descErr);
  else {
    for (const row of sampleDescs ?? []) {
      console.log(`  [${row.start_seconds}s] ${row.label}: ${row.description}`);
    }
  }

  // ── 4. Moments per video stats ────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('4. MOMENTS PER VIDEO (avg / min / max)');
  console.log('═══════════════════════════════════════════════════════');

  // Count moments per video_id client-side
  const videoCounts: Record<string, number> = {};
  let vcPage = 0;
  while (true) {
    const { data, error } = await supabase
      .from('video_moments')
      .select('video_id')
      .range(vcPage * pageSize, (vcPage + 1) * pageSize - 1);
    if (error) { console.error('Error:', error); break; }
    if (!data || data.length === 0) break;
    for (const row of data) {
      videoCounts[row.video_id] = (videoCounts[row.video_id] || 0) + 1;
    }
    if (data.length < pageSize) break;
    vcPage++;
  }

  const counts = Object.values(videoCounts);
  if (counts.length > 0) {
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    console.log(`Videos with moments: ${counts.length}`);
    console.log(`Average moments/video: ${avg.toFixed(1)}`);
    console.log(`Min: ${min}  |  Max: ${max}`);

    // Distribution
    const buckets: Record<string, number> = {};
    for (const c of counts) {
      const bucket = c <= 5 ? '1-5' : c <= 10 ? '6-10' : c <= 15 ? '11-15' : c <= 20 ? '16-20' : '21+';
      buckets[bucket] = (buckets[bucket] || 0) + 1;
    }
    console.log('\nDistribution:');
    for (const b of ['1-5', '6-10', '11-15', '16-20', '21+']) {
      console.log(`  ${b.padEnd(6)}: ${buckets[b] || 0} videos`);
    }
  }

  // ── 5. Product-moment correlation ─────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('5. PRODUCT-MOMENT CORRELATION');
  console.log('═══════════════════════════════════════════════════════');

  const productKeywords = ['hammock', 'beach towel', 'picnic blanket', 'tarp', 'backpack', 'puffy'];

  // Fetch videos with products
  const { data: videosWithProducts, error: vpErr } = await supabase
    .from('videos')
    .select('id, products')
    .not('products', 'is', null)
    .limit(500);

  if (vpErr) {
    console.error('Error fetching videos:', vpErr);
  } else {
    // Classify videos by product family
    const familyVideoIds: Record<string, string[]> = {};
    for (const kw of productKeywords) {
      familyVideoIds[kw] = [];
    }

    for (const v of videosWithProducts ?? []) {
      const prodText = JSON.stringify(v.products).toLowerCase();
      for (const kw of productKeywords) {
        if (prodText.includes(kw)) {
          familyVideoIds[kw].push(v.id);
        }
      }
    }

    for (const kw of productKeywords) {
      const ids = familyVideoIds[kw];
      console.log(`\n── ${kw.toUpperCase()} (${ids.length} videos) ──`);
      if (ids.length === 0) { console.log('  No videos found.'); continue; }

      // Fetch moments for these video IDs (up to 50 IDs at a time due to filter limits)
      const kwLabelCounts: Record<string, number> = {};
      let totalMomentsKw = 0;

      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const { data: moments, error: mErr } = await supabase
          .from('video_moments')
          .select('label')
          .in('video_id', batch);
        if (mErr) { console.error('  Error:', mErr); continue; }
        for (const m of moments ?? []) {
          kwLabelCounts[m.label ?? '(null)'] = (kwLabelCounts[m.label ?? '(null)'] || 0) + 1;
          totalMomentsKw++;
        }
      }

      console.log(`  Total moments: ${totalMomentsKw}`);
      const topLabels = Object.entries(kwLabelCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
      console.log('  Top 10 labels:');
      for (const [label, count] of topLabels) {
        console.log(`    ${String(count).padStart(4)}x  ${label}`);
      }
    }
  }

  // ── 6. Label consistency assessment ───────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('6. LABEL CONSISTENCY (top 100 labels)');
  console.log('═══════════════════════════════════════════════════════');

  const top100 = sortedLabels.slice(0, 100);
  let structuredCount = 0;
  let freeFormCount = 0;

  console.log('\nRank | Count | Label');
  console.log('-----|-------|------');
  for (let i = 0; i < top100.length; i++) {
    const [label, count] = top100[i];
    // Heuristic: structured labels tend to be short, use hyphens/underscores, lowercase
    const isStructured = label.length < 40 && /^[a-z0-9_-]+$/i.test(label.replace(/\s+/g, '-'));
    if (isStructured) structuredCount++;
    else freeFormCount++;
    const marker = isStructured ? '[S]' : '[F]';
    console.log(`${String(i + 1).padStart(4)} | ${String(count).padStart(5)} | ${marker} ${label}`);
  }

  console.log(`\nAssessment: ${structuredCount} structured, ${freeFormCount} free-form out of top 100`);
  if (freeFormCount > structuredCount) {
    console.log('Labels appear predominantly FREE-FORM (sentence-like descriptions).');
  } else {
    console.log('Labels appear predominantly STRUCTURED (category-like tokens).');
  }

  // ── 7. Sample moments for specific products ──────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('7. FULL MOMENTS FOR SAMPLE VIDEOS');
  console.log('═══════════════════════════════════════════════════════');

  for (const keyword of ['hammock', 'beach towel']) {
    console.log(`\n── Videos with "${keyword}" ──`);

    // Find 3 videos with this product
    const ids = (videosWithProducts ?? [])
      .filter(v => JSON.stringify(v.products).toLowerCase().includes(keyword))
      .slice(0, 3)
      .map(v => v.id);

    if (ids.length === 0) {
      console.log('  No videos found.');
      continue;
    }

    for (const videoId of ids) {
      // Get video title
      const { data: video } = await supabase
        .from('videos')
        .select('file_name, products')
        .eq('id', videoId)
        .single();

      console.log(`\n  Video: ${video?.file_name ?? videoId}`);
      console.log(`  Products: ${JSON.stringify(video?.products)}`);

      const { data: moments, error: mErr } = await supabase
        .from('video_moments')
        .select('start_seconds, end_seconds, label, description, products_visible')
        .eq('video_id', videoId)
        .order('start_seconds', { ascending: true });

      if (mErr) { console.error('  Error:', mErr); continue; }
      if (!moments || moments.length === 0) {
        console.log('  (no moments)');
        continue;
      }

      console.log(`  Moments (${moments.length}):`);
      for (const m of moments) {
        const timeRange = m.end_seconds
          ? `${m.start_seconds}s-${m.end_seconds}s`
          : `${m.start_seconds}s`;
        const prodVis = m.products_visible ? ` [products: ${JSON.stringify(m.products_visible)}]` : '';
        console.log(`    ${timeRange.padEnd(12)} | ${(m.label ?? '').padEnd(30)} | ${m.description ?? ''}${prodVis}`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('ANALYSIS COMPLETE');
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(console.error);
