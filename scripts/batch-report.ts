import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  // ── 1. Total videos ──
  const { count: totalCount } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true });
  console.log('═══════════════════════════════════════════');
  console.log('         BATCH PROGRESS REPORT');
  console.log('═══════════════════════════════════════════');
  console.log(`\n1. Total videos in system: ${totalCount ?? 0}`);

  // ── 2. Count by status ──
  const statuses = ['analyzed', 'analyzing', 'triaged', 'excluded', 'error', 'synced', 'reanalysis_needed'];
  console.log('\n2. Count by status:');
  const statusCounts: Record<string, number> = {};
  for (const s of statuses) {
    const { count } = await supabase
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .eq('status', s);
    statusCounts[s] = count ?? 0;
    console.log(`   ${s.padEnd(22)} ${count ?? 0}`);
  }

  // ── 3. Currently processing (analyzing) ──
  console.log('\n3. Currently processing (status=analyzing):');
  const { data: analyzing } = await supabase
    .from('videos')
    .select('name, duration_seconds, size_bytes')
    .eq('status', 'analyzing');

  if (analyzing?.length) {
    for (const v of analyzing) {
      const mb = Math.round((v.size_bytes ?? 0) / 1048576);
      const dur = v.duration_seconds ?? 0;
      console.log(`   - ${v.name}  |  ${dur}s  |  ${mb} MB`);
    }
  } else {
    console.log('   (none)');
  }

  // ── 4. Throughput calculation ──
  console.log('\n4. Throughput (videos/hour):');
  for (const n of [50, 100, 250]) {
    const { data: timestamps } = await supabase
      .from('videos')
      .select('indexed_at')
      .eq('status', 'analyzed')
      .not('indexed_at', 'is', null)
      .order('indexed_at', { ascending: false })
      .limit(n);

    if (timestamps && timestamps.length >= 2) {
      const sorted = timestamps.map(t => new Date(t.indexed_at).getTime()).sort((a, b) => a - b);
      const minTs = sorted[0];
      const maxTs = sorted[sorted.length - 1];
      const hours = (maxTs - minTs) / (1000 * 60 * 60);
      const rate = hours > 0 ? (timestamps.length / hours).toFixed(2) : 'N/A';
      const span = hours.toFixed(2);
      console.log(`   Last ${String(n).padEnd(4)} analyzed: ${rate} videos/hr  (span: ${span} hrs, actual rows: ${timestamps.length})`);
    } else {
      console.log(`   Last ${String(n).padEnd(4)} analyzed: insufficient data (${timestamps?.length ?? 0} rows)`);
    }
  }

  // ── 5. Analysis mode breakdown ──
  console.log('\n5. Analysis mode breakdown (analyzed videos):');
  for (const mode of ['full_video', 'thumbnail_fallback', 'thumbnail']) {
    const { count } = await supabase
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'analyzed')
      .eq('analysis_mode', mode);
    if ((count ?? 0) > 0) {
      console.log(`   ${mode.padEnd(22)} ${count}`);
    }
  }
  // Also check for null analysis_mode among analyzed
  const { count: nullModeCount } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'analyzed')
    .is('analysis_mode', null);
  if ((nullModeCount ?? 0) > 0) {
    console.log(`   ${'(null)'.padEnd(22)} ${nullModeCount}`);
  }

  // ── 6. Product hit rate ──
  console.log('\n6. Product hit rate (analyzed videos):');
  const totalAnalyzed = statusCounts['analyzed'] ?? 0;
  // products is text[], so non-empty means not null and length > 0
  // Use csv filter: products is not null and not empty
  const { count: withProducts } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'analyzed')
    .not('products', 'is', null)
    .neq('products', '{}');
  const hitRate = totalAnalyzed > 0 ? ((withProducts ?? 0) / totalAnalyzed * 100).toFixed(1) : '0';
  console.log(`   With products:    ${withProducts ?? 0} / ${totalAnalyzed}  (${hitRate}%)`);
  console.log(`   Without products: ${totalAnalyzed - (withProducts ?? 0)} / ${totalAnalyzed}`);

  // ── 7. Errors ──
  console.log('\n7. Errors:');
  const { count: errorCount } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'error');
  console.log(`   Total errors: ${errorCount ?? 0}`);

  const { data: errors } = await supabase
    .from('videos')
    .select('name, processing_error')
    .eq('status', 'error')
    .order('indexed_at', { ascending: false })
    .limit(5);
  if (errors?.length) {
    console.log('   Last 5 error messages:');
    for (const e of errors) {
      const msg = (e.processing_error ?? 'unknown').slice(0, 120);
      console.log(`   - [${e.name}] ${msg}`);
    }
  }

  // ── 8. Average gap between last 20 completions ──
  console.log('\n8. Average gap between last 20 completions:');
  const { data: recent20 } = await supabase
    .from('videos')
    .select('indexed_at')
    .eq('status', 'analyzed')
    .not('indexed_at', 'is', null)
    .order('indexed_at', { ascending: false })
    .limit(20);

  if (recent20 && recent20.length >= 2) {
    const times = recent20.map(t => new Date(t.indexed_at).getTime()).sort((a, b) => b - a);
    let totalGap = 0;
    for (let i = 0; i < times.length - 1; i++) {
      totalGap += times[i] - times[i + 1];
    }
    const avgGapMs = totalGap / (times.length - 1);
    const avgGapSec = (avgGapMs / 1000).toFixed(1);
    const avgGapMin = (avgGapMs / 60000).toFixed(2);
    console.log(`   Avg gap: ${avgGapSec}s  (${avgGapMin} min)`);

    // Also show min/max gap
    const gaps = [];
    for (let i = 0; i < times.length - 1; i++) {
      gaps.push(times[i] - times[i + 1]);
    }
    const minGap = (Math.min(...gaps) / 1000).toFixed(1);
    const maxGap = (Math.max(...gaps) / 1000).toFixed(1);
    console.log(`   Min gap: ${minGap}s  |  Max gap: ${maxGap}s`);

    // Time since last completion
    const lastCompletion = new Date(recent20[0].indexed_at);
    const sinceLastSec = ((Date.now() - lastCompletion.getTime()) / 1000).toFixed(0);
    const sinceLastMin = ((Date.now() - lastCompletion.getTime()) / 60000).toFixed(1);
    console.log(`   Time since last completion: ${sinceLastSec}s (${sinceLastMin} min)`);
  } else {
    console.log('   Insufficient data');
  }

  // ── 9. Last 5 analyzed videos ──
  console.log('\n9. Last 5 analyzed videos:');
  const { data: last5 } = await supabase
    .from('videos')
    .select('name, indexed_at')
    .eq('status', 'analyzed')
    .not('indexed_at', 'is', null)
    .order('indexed_at', { ascending: false })
    .limit(5);

  if (last5?.length) {
    for (const v of last5) {
      const ts = new Date(v.indexed_at).toISOString();
      console.log(`   ${ts}  ${v.name}`);
    }
  } else {
    console.log('   (none)');
  }

  console.log('\n═══════════════════════════════════════════');
}

main().catch(console.error);
