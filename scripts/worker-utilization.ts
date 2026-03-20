import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

const WORKERS = 8;

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function fmt(seconds: number): string {
  return seconds.toFixed(2) + 's';
}

async function main() {
  // ─── 1. Current in-flight ───────────────────────────────────────
  console.log('═══════════════════════════════════════════════════');
  console.log('  1. CURRENT IN-FLIGHT (status = analyzing)');
  console.log('═══════════════════════════════════════════════════');

  const { data: inflight, count: inflightCount } = await supabase
    .from('videos')
    .select('id, name, duration_seconds, size_bytes', { count: 'exact' })
    .eq('status', 'analyzing');

  console.log(`In-flight count: ${inflightCount ?? 0}`);
  if (inflight?.length) {
    for (const v of inflight) {
      const mb = ((v.size_bytes ?? 0) / 1048576).toFixed(1);
      const dur = v.duration_seconds ?? 0;
      console.log(`  ${v.name}  |  ${dur}s  |  ${mb} MB`);
    }
  }

  // ─── 2. Completion cadence (last 15 min) ────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  2. COMPLETION CADENCE (last 15 minutes)');
  console.log('═══════════════════════════════════════════════════');

  const fifteenAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: recent, count: recentCount } = await supabase
    .from('videos')
    .select('name, indexed_at', { count: 'exact' })
    .not('indexed_at', 'is', null)
    .gte('indexed_at', fifteenAgo)
    .order('indexed_at', { ascending: true })
    .limit(1000);

  const totalRecent = recentCount ?? recent?.length ?? 0;
  console.log(`Completions in last 15 min: ${totalRecent}`);
  if (totalRecent > 0) {
    const perMin = (totalRecent / 15).toFixed(2);
    const perHour = (totalRecent * 4).toFixed(0);
    console.log(`Rate: ${perMin} videos/min  |  ${perHour} videos/hr`);
  }
  if (recent?.length) {
    console.log('\nTimeline:');
    for (const v of recent) {
      const t = new Date(v.indexed_at!).toISOString().slice(11, 19);
      console.log(`  ${t}  ${v.name}`);
    }
  }

  // ─── 3. Gap analysis (last 100 completions) ─────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  3. GAP ANALYSIS (last 100 completions)');
  console.log('═══════════════════════════════════════════════════');

  const { data: last100 } = await supabase
    .from('videos')
    .select('name, indexed_at')
    .not('indexed_at', 'is', null)
    .in('status', ['analyzed', 'excluded'])
    .order('indexed_at', { ascending: false })
    .limit(100);

  if (!last100 || last100.length < 2) {
    console.log('Not enough completed videos for gap analysis.');
  } else {
    // Reverse to chronological order
    const chronological = [...last100].reverse();
    const timestamps = chronological.map(v => new Date(v.indexed_at!).getTime());

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

    const stallCount = gaps.filter(g => g > 30).length;
    const burstCount = gaps.filter(g => g < 3).length;

    console.log(`Gaps computed from ${gaps.length} consecutive pairs`);
    console.log(`  Min:    ${fmt(min)}`);
    console.log(`  Max:    ${fmt(max)}`);
    console.log(`  Mean:   ${fmt(mean)}`);
    console.log(`  Median: ${fmt(median)}`);
    console.log(`  P90:    ${fmt(p90)}`);
    console.log(`  P95:    ${fmt(p95)}`);
    console.log(`  Gaps > 30s (stall indicators):   ${stallCount}`);
    console.log(`  Gaps < 3s  (near-simultaneous):  ${burstCount}`);

    // ─── 4. Concurrent processing inference ─────────────────────
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  4. CONCURRENT PROCESSING INFERENCE');
    console.log('═══════════════════════════════════════════════════');

    const effectiveTime = median * WORKERS;
    console.log(`With ${WORKERS} workers and median gap of ${fmt(median)}:`);
    console.log(`  Inferred per-video processing time: ${fmt(effectiveTime)}`);

    const expectedGapIfAll = effectiveTime / WORKERS;
    console.log(`  Expected gap if all ${WORKERS} workers active: ${fmt(expectedGapIfAll)}`);

    // Infer active workers from mean gap
    // If T is avg processing time and W workers are active, gap ~ T/W
    // We know T ~ effectiveTime (estimated from median * 8)
    // So active workers ~ effectiveTime / mean
    const inferredWorkers = effectiveTime / mean;
    console.log(`  Inferred active workers (from mean gap): ~${inferredWorkers.toFixed(1)}`);

    if (inferredWorkers >= WORKERS * 0.8) {
      console.log(`  -> Suggests all ${WORKERS} workers are active.`);
    } else if (inferredWorkers >= WORKERS * 0.5) {
      console.log(`  -> Suggests ${Math.round(inferredWorkers)} of ${WORKERS} workers active (partial utilization).`);
    } else {
      console.log(`  -> Suggests only ~${Math.round(inferredWorkers)} workers active (low utilization).`);
    }

    // ─── 5. Burst pattern detection ─────────────────────────────
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  5. BURST PATTERN DETECTION');
    console.log('═══════════════════════════════════════════════════');

    let clusterCount = 0;
    let inCluster = false;
    const clusters: { size: number; startIdx: number }[] = [];

    for (let i = 0; i < gaps.length; i++) {
      if (gaps[i] < 2) {
        if (!inCluster) {
          inCluster = true;
          clusters.push({ size: 2, startIdx: i });
        } else {
          clusters[clusters.length - 1].size++;
        }
      } else {
        inCluster = false;
      }
    }

    console.log(`Clusters (2+ completions within 2s of each other): ${clusters.length}`);
    if (clusters.length > 0) {
      console.log('Cluster sizes:');
      for (const c of clusters) {
        const startTime = new Date(timestamps[c.startIdx]).toISOString().slice(11, 19);
        console.log(`  ${c.size} videos near ${startTime}`);
      }
      const totalInClusters = clusters.reduce((a, c) => a + c.size, 0);
      console.log(`Total videos in clusters: ${totalInClusters} / ${last100.length}`);
      if (clusters.length > gaps.length * 0.3) {
        console.log('-> Frequent burst completions suggest true parallel processing.');
      } else {
        console.log('-> Bursts are infrequent; workers may be staggered or fewer than expected.');
      }
    }

    // ─── 6. Throughput trend (3-min windows) ────────────────────
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  6. THROUGHPUT TREND (5 x 3-minute windows)');
    console.log('═══════════════════════════════════════════════════');

    const now = Date.now();
    const windowMs = 3 * 60 * 1000;

    // Use recent data (from query 2) for trend analysis
    // Re-query to get all completions in last 15 min with timestamps
    const { data: trendData } = await supabase
      .from('videos')
      .select('indexed_at')
      .not('indexed_at', 'is', null)
      .gte('indexed_at', fifteenAgo)
      .order('indexed_at', { ascending: true })
      .limit(1000);

    if (trendData && trendData.length > 0) {
      for (let w = 4; w >= 0; w--) {
        const winStart = now - (w + 1) * windowMs;
        const winEnd = now - w * windowMs;
        const count = trendData.filter(v => {
          const t = new Date(v.indexed_at!).getTime();
          return t >= winStart && t < winEnd;
        }).length;
        const startLabel = new Date(winStart).toISOString().slice(11, 19);
        const endLabel = new Date(winEnd).toISOString().slice(11, 19);
        const bar = '█'.repeat(count);
        console.log(`  ${startLabel}-${endLabel}:  ${String(count).padStart(3)} ${bar}`);
      }

      // Detect trend
      const windowCounts: number[] = [];
      for (let w = 4; w >= 0; w--) {
        const winStart = now - (w + 1) * windowMs;
        const winEnd = now - w * windowMs;
        windowCounts.push(trendData.filter(v => {
          const t = new Date(v.indexed_at!).getTime();
          return t >= winStart && t < winEnd;
        }).length);
      }

      const firstHalf = windowCounts.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
      const secondHalf = windowCounts.slice(3).reduce((a, b) => a + b, 0) / 2;
      if (secondHalf > firstHalf * 1.2) {
        console.log('  -> Trend: ACCELERATING');
      } else if (secondHalf < firstHalf * 0.8) {
        console.log('  -> Trend: DECELERATING');
      } else {
        console.log('  -> Trend: STEADY');
      }
    } else {
      console.log('No completions in the last 15 minutes for trend analysis.');
    }
  }

  // ─── 7. Processing time estimation ──────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  7. PROCESSING TIME ESTIMATION (updated_at -> indexed_at)');
  console.log('═══════════════════════════════════════════════════');

  const { data: timingData } = await supabase
    .from('videos')
    .select('name, indexed_at, updated_at, created_at, duration_seconds')
    .not('indexed_at', 'is', null)
    .in('status', ['analyzed', 'excluded'])
    .order('indexed_at', { ascending: false })
    .limit(50);

  if (!timingData || timingData.length === 0) {
    console.log('No completed videos found.');
  } else {
    // Check if updated_at exists and differs from indexed_at
    const hasUpdatedAt = timingData.some(v => (v as any).updated_at != null);

    if (!hasUpdatedAt) {
      console.log('No updated_at column found on videos table (or all null).');
      console.log('Cannot compute per-video processing time without a claim timestamp.');
    } else {
      // updated_at is set by Supabase moddatetime trigger on every update.
      // The final update (which sets indexed_at) also updates updated_at,
      // so updated_at ≈ indexed_at for completed videos.
      // Check if they differ meaningfully.
      const diffs: { name: string; diff: number; duration: number }[] = [];
      let sameCount = 0;

      for (const v of timingData) {
        const ua = (v as any).updated_at;
        const ia = v.indexed_at;
        if (!ua || !ia) continue;

        const diffSec = (new Date(ia).getTime() - new Date(ua).getTime()) / 1000;
        if (Math.abs(diffSec) < 1) {
          sameCount++;
        } else {
          diffs.push({
            name: v.name ?? '(unnamed)',
            diff: diffSec,
            duration: v.duration_seconds ?? 0,
          });
        }
      }

      if (sameCount > timingData.length * 0.8) {
        console.log(`updated_at ≈ indexed_at for ${sameCount}/${timingData.length} videos.`);
        console.log('This means updated_at is set by a trigger on the final update,');
        console.log('not on the claim step. Cannot derive per-video processing time.');
        console.log('\nTo enable processing time tracking, the claimVideo function');
        console.log('should set a dedicated claimed_at or started_at timestamp.');
      } else {
        // Check if the diffs are all very large (suggesting updated_at is stale/never updated)
        const absDiffs = diffs.map(d => Math.abs(d.diff)).sort((a, b) => a - b);
        const medianDiff = percentile(absDiffs, 50);

        if (medianDiff > 3600) {
          // updated_at is stale -- not being updated by triggers on row changes
          const days = (medianDiff / 86400).toFixed(1);
          console.log(`updated_at is STALE (median offset from indexed_at: ~${days} days).`);
          console.log(`This means there is no moddatetime trigger updating updated_at on row changes.`);
          console.log(`The updated_at value reflects the original insert/sync time, not the claim time.`);
          console.log(`\nCannot derive per-video processing time from these columns.`);
          console.log(`To enable processing time tracking, the claimVideo function`);
          console.log(`should set a dedicated claimed_at or started_at timestamp.`);

          // Show sample for confirmation
          console.log('\nSample updated_at vs indexed_at (last 5):');
          for (const v of timingData.slice(0, 5)) {
            const ua = (v as any).updated_at;
            const ia = v.indexed_at;
            console.log(`  ${v.name}`);
            console.log(`    updated_at: ${ua}`);
            console.log(`    indexed_at: ${ia}`);
          }
        } else {
          console.log(`Videos where updated_at differs from indexed_at: ${diffs.length}`);
          if (diffs.length > 0) {
            console.log(`  Min processing time:  ${fmt(absDiffs[0])}`);
            console.log(`  Max processing time:  ${fmt(absDiffs[absDiffs.length - 1])}`);
            console.log(`  Median:               ${fmt(medianDiff)}`);
            console.log(`  Mean:                 ${fmt(absDiffs.reduce((a, b) => a + b, 0) / absDiffs.length)}`);

            console.log('\nSample (last 10):');
            for (const d of diffs.slice(0, 10)) {
              console.log(`  ${d.name}  |  duration: ${d.duration}s  |  processing: ${fmt(Math.abs(d.diff))}`);
            }
          }
        }
      }
    }
  }

  // ─── Summary ──────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  DONE');
  console.log('═══════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
