/**
 * Comprehensive throughput analysis for the video analysis batch.
 * Read-only -- does NOT modify any data.
 *
 * Usage:
 *   export $(grep -v '^#' .env | xargs) && npx tsx scripts/throughput-analysis.ts
 */

import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { execSync } from 'child_process';

// ── Helpers ─────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function fmt(seconds: number): string {
  return seconds.toFixed(2) + 's';
}

function fmtMB(bytes: number): string {
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function isoNow(): string {
  return new Date().toISOString();
}

function isoAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

const SEPARATOR = '═══════════════════════════════════════════════════════════════';

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const now = Date.now();

  // ─────────────────────────────────────────────────────────────────
  // 1. CURRENT THROUGHPUT (last 5 minutes)
  // ─────────────────────────────────────────────────────────────────
  console.log(SEPARATOR);
  console.log('  1. CURRENT THROUGHPUT (last 5 minutes)');
  console.log(SEPARATOR);

  const cutoff5 = isoAgo(5);
  const { count: count5 } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .not('indexed_at', 'is', null)
    .gte('indexed_at', cutoff5);

  const c5 = count5 ?? 0;
  const rate5 = c5 / (5 / 60);
  console.log(`  Videos analyzed in last 5 min: ${c5}`);
  console.log(`  Rate: ${rate5.toFixed(2)} videos/hr`);
  console.log(`  Math: ${c5} / (5 / 60) = ${rate5.toFixed(2)}`);

  // ─────────────────────────────────────────────────────────────────
  // 2. THROUGHPUT OVER TIME WINDOWS (15, 30, 60 min)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n' + SEPARATOR);
  console.log('  2. THROUGHPUT OVER TIME WINDOWS');
  console.log(SEPARATOR);

  for (const windowMin of [15, 30, 60]) {
    const cutoff = isoAgo(windowMin);
    const { count } = await supabase
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .not('indexed_at', 'is', null)
      .gte('indexed_at', cutoff);

    const c = count ?? 0;
    const rate = c / (windowMin / 60);
    console.log(`\n  Window: last ${windowMin} minutes`);
    console.log(`    Count: ${c}`);
    console.log(`    Rate:  ${rate.toFixed(2)} videos/hr`);
    console.log(`    Math:  ${c} / (${windowMin} / 60) = ${c} / ${(windowMin / 60).toFixed(4)} = ${rate.toFixed(2)}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. THROUGHPUT TREND - 6 ten-minute buckets over last 60 min
  // ─────────────────────────────────────────────────────────────────
  console.log('\n' + SEPARATOR);
  console.log('  3. THROUGHPUT TREND (6 x 10-minute buckets, last 60 min)');
  console.log(SEPARATOR);

  const cutoff60 = isoAgo(60);
  // Fetch all completions in last 60 min (up to 1000)
  const { data: trend60Data } = await supabase
    .from('videos')
    .select('indexed_at')
    .not('indexed_at', 'is', null)
    .gte('indexed_at', cutoff60)
    .order('indexed_at', { ascending: true })
    .limit(1000);

  const bucketCounts: number[] = [];
  if (trend60Data && trend60Data.length > 0) {
    for (let b = 5; b >= 0; b--) {
      const bucketStart = now - (b + 1) * 10 * 60 * 1000;
      const bucketEnd = now - b * 10 * 60 * 1000;
      const count = trend60Data.filter(v => {
        const t = new Date(v.indexed_at!).getTime();
        return t >= bucketStart && t < bucketEnd;
      }).length;
      bucketCounts.push(count);
      const rate = count / (10 / 60);
      const startLabel = new Date(bucketStart).toISOString().slice(11, 19);
      const endLabel = new Date(bucketEnd).toISOString().slice(11, 19);
      const bar = '\u2588'.repeat(Math.min(count, 80));
      console.log(`  ${startLabel} - ${endLabel}:  ${String(count).padStart(4)} completions  (${rate.toFixed(1)} /hr)  ${bar}`);
    }

    // Trend detection
    const firstHalf = bucketCounts.slice(0, 3);
    const secondHalf = bucketCounts.slice(3);
    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    console.log(`\n  First 3 buckets avg: ${avgFirst.toFixed(1)}  |  Last 3 buckets avg: ${avgSecond.toFixed(1)}`);
    if (avgSecond > avgFirst * 1.2) {
      console.log('  Trend: ACCELERATING (up)');
    } else if (avgSecond < avgFirst * 0.8) {
      console.log('  Trend: DECELERATING (down)');
    } else {
      console.log('  Trend: FLAT (steady)');
    }
  } else {
    console.log('  No completions in the last 60 minutes.');
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. PEAK THROUGHPUT DETECTION (last 12 hours, 30-min buckets)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n' + SEPARATOR);
  console.log('  4. PEAK THROUGHPUT DETECTION (last 12 hrs, 30-min buckets)');
  console.log(SEPARATOR);

  // We need to count completions across 12 hours. Supabase caps at 1000 rows.
  // Use count queries for each bucket instead.
  const BUCKET_SIZE_MIN = 30;
  const NUM_BUCKETS = (12 * 60) / BUCKET_SIZE_MIN; // 24 buckets
  let peakCount = 0;
  let peakStart = 0;
  let currentBucketCount = 0;

  for (let b = NUM_BUCKETS - 1; b >= 0; b--) {
    const bucketStartMs = now - (b + 1) * BUCKET_SIZE_MIN * 60 * 1000;
    const bucketEndMs = now - b * BUCKET_SIZE_MIN * 60 * 1000;
    const bStart = new Date(bucketStartMs).toISOString();
    const bEnd = new Date(bucketEndMs).toISOString();

    const { count } = await supabase
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .not('indexed_at', 'is', null)
      .gte('indexed_at', bStart)
      .lt('indexed_at', bEnd);

    const c = count ?? 0;
    if (c > peakCount) {
      peakCount = c;
      peakStart = bucketStartMs;
    }
    if (b === 0) {
      currentBucketCount = c;
    }
  }

  const peakRate = peakCount / (BUCKET_SIZE_MIN / 60);
  const currentRate = currentBucketCount / (BUCKET_SIZE_MIN / 60);
  const peakLabel = new Date(peakStart).toISOString().slice(11, 19);
  const peakEndLabel = new Date(peakStart + BUCKET_SIZE_MIN * 60 * 1000).toISOString().slice(11, 19);

  console.log(`  Peak bucket: ${peakLabel} - ${peakEndLabel}`);
  console.log(`    Count: ${peakCount}  |  Rate: ${peakRate.toFixed(1)} videos/hr`);
  console.log(`  Current bucket (most recent ${BUCKET_SIZE_MIN} min):`);
  console.log(`    Count: ${currentBucketCount}  |  Rate: ${currentRate.toFixed(1)} videos/hr`);
  if (peakRate > 0) {
    const pctOfPeak = ((currentRate / peakRate) * 100).toFixed(1);
    console.log(`    Current is ${pctOfPeak}% of peak`);
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. VIDEO CHARACTERISTICS OVER TIME (last 60 min, 3 x 20-min)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n' + SEPARATOR);
  console.log('  5. VIDEO CHARACTERISTICS OVER TIME (3 x 20-min windows)');
  console.log(SEPARATOR);

  for (let w = 2; w >= 0; w--) {
    const wStart = isoAgo((w + 1) * 20);
    const wEnd = isoAgo(w * 20);
    const wStartLabel = new Date(now - (w + 1) * 20 * 60 * 1000).toISOString().slice(11, 19);
    const wEndLabel = new Date(now - w * 20 * 60 * 1000).toISOString().slice(11, 19);

    const { data: charData } = await supabase
      .from('videos')
      .select('duration_seconds, size_bytes, analysis_mode')
      .not('indexed_at', 'is', null)
      .gte('indexed_at', wStart)
      .lt('indexed_at', wEnd)
      .limit(1000);

    const items = charData ?? [];
    const count = items.length;

    console.log(`\n  Window: ${wStartLabel} - ${wEndLabel}  (${count} videos)`);

    if (count > 0) {
      const durations = items.map(v => v.duration_seconds ?? 0);
      const sizes = items.map(v => v.size_bytes ?? 0);
      const avgDur = durations.reduce((a, b) => a + b, 0) / count;
      const avgSize = sizes.reduce((a, b) => a + b, 0) / count;
      const fullCount = items.filter(v => v.analysis_mode === 'full_video').length;
      const thumbCount = items.filter(v => v.analysis_mode === 'thumbnail_fallback').length;
      const otherCount = count - fullCount - thumbCount;

      console.log(`    Avg duration:   ${avgDur.toFixed(1)}s`);
      console.log(`    Avg size:       ${fmtMB(avgSize)}`);
      console.log(`    full_video:     ${fullCount}`);
      console.log(`    thumbnail_fallback: ${thumbCount}`);
      if (otherCount > 0) console.log(`    other modes:    ${otherCount}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 6. GAP ANALYSIS (last 100 completions)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n' + SEPARATOR);
  console.log('  6. GAP ANALYSIS (last 100 completions)');
  console.log(SEPARATOR);

  const { data: last100 } = await supabase
    .from('videos')
    .select('indexed_at')
    .not('indexed_at', 'is', null)
    .order('indexed_at', { ascending: false })
    .limit(100);

  if (!last100 || last100.length < 2) {
    console.log('  Not enough completed videos for gap analysis.');
  } else {
    // Chronological order
    const timestamps = last100
      .map(v => new Date(v.indexed_at!).getTime())
      .sort((a, b) => a - b);

    const gaps: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      gaps.push((timestamps[i] - timestamps[i - 1]) / 1000);
    }

    const sorted = [...gaps].sort((a, b) => a - b);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const median = percentile(sorted, 50);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p90 = percentile(sorted, 90);
    const p95 = percentile(sorted, 95);

    console.log(`  ${gaps.length} gaps computed from ${last100.length} completions`);
    console.log(`    Min:    ${fmt(min)}`);
    console.log(`    Max:    ${fmt(max)}`);
    console.log(`    Mean:   ${fmt(mean)}`);
    console.log(`    Median: ${fmt(median)}`);
    console.log(`    P90:    ${fmt(p90)}`);
    console.log(`    P95:    ${fmt(p95)}`);

    const gt20 = gaps.filter(g => g > 20).length;
    const gt30 = gaps.filter(g => g > 30).length;
    const gt60 = gaps.filter(g => g > 60).length;
    console.log(`\n    Gaps > 20s: ${gt20}`);
    console.log(`    Gaps > 30s: ${gt30}`);
    console.log(`    Gaps > 60s: ${gt60}`);

    // Compare first 50 gaps vs last 50 gaps (chronological)
    const firstHalfGaps = gaps.slice(0, Math.floor(gaps.length / 2));
    const secondHalfGaps = gaps.slice(Math.floor(gaps.length / 2));
    const avgFirst = firstHalfGaps.reduce((a, b) => a + b, 0) / firstHalfGaps.length;
    const avgSecond = secondHalfGaps.reduce((a, b) => a + b, 0) / secondHalfGaps.length;

    console.log(`\n    First half avg gap (older):  ${fmt(avgFirst)}  (${firstHalfGaps.length} gaps)`);
    console.log(`    Second half avg gap (newer): ${fmt(avgSecond)}  (${secondHalfGaps.length} gaps)`);
    if (avgSecond > avgFirst * 1.3) {
      console.log('    --> Gaps are INCREASING over time (slowing down)');
    } else if (avgSecond < avgFirst * 0.7) {
      console.log('    --> Gaps are DECREASING over time (speeding up)');
    } else {
      console.log('    --> Gaps are roughly STABLE');
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 7. WORKER UTILIZATION
  // ─────────────────────────────────────────────────────────────────
  console.log('\n' + SEPARATOR);
  console.log('  7. WORKER UTILIZATION');
  console.log(SEPARATOR);

  const CONFIGURED_WORKERS = 10;
  const { data: analyzing, count: analyzingCount } = await supabase
    .from('videos')
    .select('id, name, duration_seconds, size_bytes', { count: 'exact' })
    .eq('status', 'analyzing');

  const activeWorkers = analyzingCount ?? 0;
  console.log(`  Configured workers: ${CONFIGURED_WORKERS}`);
  console.log(`  Videos in 'analyzing' status: ${activeWorkers}`);
  console.log(`  Utilization: ${activeWorkers}/${CONFIGURED_WORKERS} = ${((activeWorkers / CONFIGURED_WORKERS) * 100).toFixed(0)}%`);

  if (analyzing?.length) {
    console.log('\n  Currently analyzing:');
    for (const v of analyzing) {
      const mb = ((v.size_bytes ?? 0) / 1048576).toFixed(1);
      const dur = v.duration_seconds ?? 0;
      console.log(`    ${v.name}  |  ${dur}s  |  ${mb} MB`);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 8. RESOURCE CHECK (batch process)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n' + SEPARATOR);
  console.log('  8. RESOURCE CHECK (batch process)');
  console.log(SEPARATOR);

  try {
    const psOutput = execSync('ps aux | grep analyze-batch | grep -v grep', { encoding: 'utf-8' }).trim();
    if (psOutput) {
      const lines = psOutput.split('\n');
      for (const line of lines) {
        const parts = line.split(/\s+/);
        // ps aux columns: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND...
        const pid = parts[1];
        const cpu = parts[2];
        const mem = parts[3];
        const rss = parts[5];
        const startTime = parts[8];
        const elapsed = parts[9];
        const rssMB = (parseInt(rss, 10) / 1024).toFixed(1);
        console.log(`  PID:     ${pid}`);
        console.log(`  CPU%:    ${cpu}`);
        console.log(`  MEM%:    ${mem}`);
        console.log(`  RSS:     ${rssMB} MB (${rss} KB)`);
        console.log(`  START:   ${startTime}`);
        console.log(`  TIME:    ${elapsed}`);
      }
    } else {
      console.log('  No analyze-batch process found running.');
    }
  } catch {
    console.log('  No analyze-batch process found running.');
  }

  // ─────────────────────────────────────────────────────────────────
  // 9. QUEUE COMPOSITION (remaining triaged videos)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n' + SEPARATOR);
  console.log('  9. QUEUE COMPOSITION (remaining triaged videos)');
  console.log(SEPARATOR);

  // Duration buckets
  const durationBuckets = [
    { label: '0-10s', min: 0, max: 10 },
    { label: '10-20s', min: 10, max: 20 },
    { label: '20-30s', min: 20, max: 30 },
    { label: '30-60s', min: 30, max: 60 },
    { label: '1-2min', min: 60, max: 120 },
    { label: '2-5min', min: 120, max: 300 },
    { label: '5min+', min: 300, max: 999999 },
  ];

  console.log('\n  By duration:');
  for (const b of durationBuckets) {
    const { count } = await supabase
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'triaged')
      .gte('duration_seconds', b.min)
      .lt('duration_seconds', b.max);
    console.log(`    ${b.label.padEnd(10)} ${count ?? 0}`);
  }

  // Also count triaged with null duration
  const { count: nullDurCount } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'triaged')
    .is('duration_seconds', null);
  if ((nullDurCount ?? 0) > 0) {
    console.log(`    ${'(no dur)'.padEnd(10)} ${nullDurCount}`);
  }

  // Size buckets
  const sizeBuckets = [
    { label: '0-10MB', min: 0, max: 10 * 1048576 },
    { label: '10-50MB', min: 10 * 1048576, max: 50 * 1048576 },
    { label: '50-100MB', min: 50 * 1048576, max: 100 * 1048576 },
    { label: '100-200MB', min: 100 * 1048576, max: 200 * 1048576 },
    { label: '200MB+', min: 200 * 1048576, max: 999999999999 },
  ];

  console.log('\n  By size:');
  for (const b of sizeBuckets) {
    const { count } = await supabase
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'triaged')
      .gte('size_bytes', b.min)
      .lt('size_bytes', b.max);
    console.log(`    ${b.label.padEnd(10)} ${count ?? 0}`);
  }

  const { count: nullSizeCount } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'triaged')
    .is('size_bytes', null);
  if ((nullSizeCount ?? 0) > 0) {
    console.log(`    ${'(no size)'.padEnd(10)} ${nullSizeCount}`);
  }

  // Total triaged
  const { count: totalTriaged } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'triaged');
  console.log(`\n  Total triaged (remaining queue): ${totalTriaged ?? 0}`);

  // ─────────────────────────────────────────────────────────────────
  // 10. RATE LIMIT / ERROR SIGNALS
  // ─────────────────────────────────────────────────────────────────
  console.log('\n' + SEPARATOR);
  console.log('  10. RATE LIMIT / ERROR SIGNALS');
  console.log(SEPARATOR);

  // Videos with processing_error set
  const { count: errorCount } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .not('processing_error', 'is', null);
  console.log(`  Videos with processing_error set: ${errorCount ?? 0}`);

  // Videos in error status
  const { count: errorStatusCount } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'error');
  console.log(`  Videos with status='error': ${errorStatusCount ?? 0}`);

  // Recent errors (last 60 min)
  const { data: recentErrors } = await supabase
    .from('videos')
    .select('name, processing_error, indexed_at')
    .not('processing_error', 'is', null)
    .gte('indexed_at', isoAgo(60))
    .order('indexed_at', { ascending: false })
    .limit(10);

  if (recentErrors?.length) {
    console.log(`\n  Recent errors (last 60 min): ${recentErrors.length}`);
    for (const e of recentErrors) {
      const ts = e.indexed_at ? new Date(e.indexed_at).toISOString().slice(11, 19) : '??';
      const msg = (e.processing_error ?? 'unknown').slice(0, 120);
      console.log(`    [${ts}] ${e.name}: ${msg}`);
    }
  } else {
    console.log('  No errors in the last 60 minutes.');
  }

  // Stuck in 'analyzing' for > 10 minutes
  const stuckCutoff = isoAgo(10);
  // We need to check videos in 'analyzing' status that have been there a while.
  // updated_at may indicate when they were claimed.
  const { data: stuckVideos } = await supabase
    .from('videos')
    .select('name, duration_seconds, size_bytes, updated_at')
    .eq('status', 'analyzing')
    .lt('updated_at', stuckCutoff)
    .limit(50);

  if (stuckVideos?.length) {
    console.log(`\n  Stuck in 'analyzing' > 10 min: ${stuckVideos.length}`);
    for (const v of stuckVideos) {
      const mb = ((v.size_bytes ?? 0) / 1048576).toFixed(1);
      const dur = v.duration_seconds ?? 0;
      const updAt = v.updated_at ? new Date(v.updated_at).toISOString().slice(11, 19) : '??';
      console.log(`    ${v.name}  |  ${dur}s  |  ${mb} MB  |  updated_at: ${updAt}`);
    }
  } else {
    console.log('  No videos stuck in analyzing > 10 minutes.');
  }

  // ─────────────────────────────────────────────────────────────────
  console.log('\n' + SEPARATOR);
  console.log('  ANALYSIS COMPLETE');
  console.log(SEPARATOR);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
