/**
 * Staged batch reanalysis: 100 thumbnail-only videos, stratified by size.
 *
 * Prioritizes videos missing product tags.
 * Excludes videos already reanalyzed in the pilot batch.
 *
 * Stratified sample (proportional to backlog):
 *   - 60 videos under 50MB
 *   - 25 videos 50-200MB
 *   - 15 videos 200MB-1GB
 *
 * Run with: npx tsx scripts/batch-100-reanalysis.ts
 */
import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';
import { getWorkspaceCredentials } from '../src/lib/workspace.js';
import { analyzeOneVideo } from '../src/services/scanner.js';

interface BatchVideo {
  id: string;
  drive_id: string;
  name: string;
  size_bytes: number;
  duration_seconds: number | null;
  products: string[] | null;
  analysis_mode: string | null;
  summary: string | null;
}

interface BatchResult {
  video: BatchVideo;
  success: boolean;
  newMode: string | null;
  newProducts: string[] | null;
  newSummary: string | null;
  error: string | null;
  durationMs: number;
}

const strata = [
  { label: 'under 50MB', minBytes: 1, maxBytes: 50 * 1024 * 1024, count: 60 },
  { label: '50-200MB', minBytes: 50 * 1024 * 1024 + 1, maxBytes: 200 * 1024 * 1024, count: 25 },
  { label: '200MB-1GB', minBytes: 200 * 1024 * 1024 + 1, maxBytes: 1024 * 1024 * 1024, count: 15 },
];

async function main() {
  const workspaceId = getDefaultWorkspaceId();
  const creds = await getWorkspaceCredentials(workspaceId);

  if (!creds.googleServiceAccountKey || !creds.geminiApiKey) {
    console.error('Missing credentials. Set GOOGLE_SERVICE_ACCOUNT_KEY and GEMINI_API_KEY.');
    process.exit(1);
  }

  console.log('=== STAGED BATCH REANALYSIS — 100 videos ===\n');

  // Find videos already reanalyzed (full_video mode) to exclude them
  const { data: alreadyDone } = await supabase
    .from('videos')
    .select('id')
    .eq('analysis_mode', 'full_video')
    .limit(10000);
  const excludeIds = new Set((alreadyDone ?? []).map(v => v.id));
  console.log(`Excluding ${excludeIds.size} already-reanalyzed videos\n`);

  const batchVideos: BatchVideo[] = [];

  for (const stratum of strata) {
    // Prioritize videos with no products (empty array or null)
    // Fetch more than needed so we can filter out already-done videos
    const fetchLimit = stratum.count * 3;

    const { data, error } = await supabase
      .from('videos')
      .select('id, drive_id, name, size_bytes, duration_seconds, products, analysis_mode, summary')
      .eq('status', 'analyzed')
      .eq('analysis_mode', 'thumbnail')
      .gte('size_bytes', stratum.minBytes)
      .lte('size_bytes', stratum.maxBytes)
      .not('drive_id', 'is', null)
      .order('products', { ascending: true, nullsFirst: true })
      .limit(fetchLimit);

    if (error) {
      console.error(`Stratum "${stratum.label}" query error:`, error.message);
      continue;
    }

    // Filter out already-reanalyzed and prioritize no-product videos
    const eligible = (data ?? []).filter(v => !excludeIds.has(v.id));
    const noProducts = eligible.filter(v => !v.products || v.products.length === 0);
    const withProducts = eligible.filter(v => v.products && v.products.length > 0);

    // Take no-product videos first, then fill with product videos
    const selected = [...noProducts, ...withProducts].slice(0, stratum.count);
    const noProductCount = Math.min(noProducts.length, stratum.count);

    console.log(`Stratum "${stratum.label}": ${selected.length}/${stratum.count} selected (${noProductCount} missing products, ${selected.length - noProductCount} with products)`);
    batchVideos.push(...(selected as BatchVideo[]));
  }

  console.log(`\nTotal batch videos: ${batchVideos.length}\n`);

  if (batchVideos.length === 0) {
    console.log('No eligible videos found. Exiting.');
    return;
  }

  // Record "before" state
  console.log('── BEFORE STATE (summary) ──\n');
  const noProductsBefore = batchVideos.filter(v => !v.products || v.products.length === 0).length;
  const withProductsBefore = batchVideos.filter(v => v.products && v.products.length > 0).length;
  console.log(`  Missing products: ${noProductsBefore}`);
  console.log(`  Has products: ${withProductsBefore}`);
  for (const stratum of strata) {
    const inStratum = batchVideos.filter(v => v.size_bytes >= stratum.minBytes && v.size_bytes <= stratum.maxBytes);
    console.log(`  ${stratum.label}: ${inStratum.length} videos`);
  }

  // Process each video
  const results: BatchResult[] = [];
  let successCount = 0;
  let failCount = 0;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;

  for (let i = 0; i < batchVideos.length; i++) {
    const v = batchVideos[i];
    const sizeMB = (v.size_bytes / 1024 / 1024).toFixed(1);
    process.stdout.write(`\n[${i + 1}/${batchVideos.length}] ${v.name} (${sizeMB}MB)... `);

    const startMs = Date.now();
    let success = false;
    let error: string | null = null;

    try {
      // Set to reanalysis_needed so analyzeOneVideo can claim it
      await supabase.from('videos').update({ status: 'reanalysis_needed' }).eq('id', v.id);

      success = await analyzeOneVideo(
        workspaceId,
        v.id,
        v.drive_id,
        v.name,
        v.size_bytes,
        creds.googleServiceAccountKey!,
        creds.geminiApiKey!,
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const durationMs = Date.now() - startMs;

    // Fetch updated state
    const { data: updated } = await supabase
      .from('videos')
      .select('analysis_mode, products, summary, status, processing_error')
      .eq('id', v.id)
      .single();

    if (success) {
      successCount++;
      consecutiveFailures = 0;
      process.stdout.write(`OK (${(durationMs / 1000).toFixed(1)}s) → mode=${updated?.analysis_mode} products=${updated?.products?.length ?? 0}`);
    } else {
      failCount++;
      consecutiveFailures++;
      const errMsg = (updated?.processing_error ?? error ?? 'unknown').slice(0, 100);
      process.stdout.write(`FAIL (${(durationMs / 1000).toFixed(1)}s) → status=${updated?.status} error=${errMsg}`);

      // Circuit breaker: stop if too many consecutive failures
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.log(`\n\n⚠️  CIRCUIT BREAKER: ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Stopping batch early.`);
        // Restore remaining videos to analyzed status
        for (let j = i + 1; j < batchVideos.length; j++) {
          await supabase.from('videos').update({ status: 'analyzed' }).eq('id', batchVideos[j].id);
        }
        break;
      }
    }

    results.push({
      video: v,
      success,
      newMode: updated?.analysis_mode ?? null,
      newProducts: updated?.products ?? null,
      newSummary: updated?.summary ?? null,
      error: updated?.processing_error ?? error,
      durationMs,
    });

    // Rate limiting — 2s between requests
    if (i < batchVideos.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // ── RESULTS SUMMARY ──
  console.log('\n\n══════════════════════════════════════════');
  console.log('       BATCH-100 RESULTS SUMMARY');
  console.log('══════════════════════════════════════════\n');

  console.log(`Total attempted: ${results.length}`);
  console.log(`Succeeded: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Success rate: ${(successCount / results.length * 100).toFixed(1)}%`);

  // Mode breakdown
  const modeBreakdown: Record<string, number> = {};
  for (const r of results) {
    const mode = r.success ? (r.newMode ?? 'unknown') : 'error';
    modeBreakdown[mode] = (modeBreakdown[mode] ?? 0) + 1;
  }
  console.log('\nAnalysis mode breakdown:');
  for (const [mode, count] of Object.entries(modeBreakdown)) {
    console.log(`  ${mode}: ${count}`);
  }

  // Product recovery
  const recoveredProducts = results.filter(r =>
    r.success && r.newProducts && r.newProducts.length > 0 &&
    (!r.video.products || r.video.products.length === 0)
  );
  const hadProductsBefore = results.filter(r => r.video.products && r.video.products.length > 0);
  const hasProductsAfter = results.filter(r => r.success && r.newProducts && r.newProducts.length > 0);
  const lostProducts = results.filter(r =>
    r.success && r.video.products && r.video.products.length > 0 &&
    (!r.newProducts || r.newProducts.length === 0)
  );

  console.log(`\nProduct recovery:`);
  console.log(`  Had products before: ${hadProductsBefore.length}`);
  console.log(`  Have products after (succeeded only): ${hasProductsAfter.length}`);
  console.log(`  Newly recovered: ${recoveredProducts.length}`);
  console.log(`  Lost products (regression): ${lostProducts.length}`);

  // Average processing time by size band
  console.log('\nAverage processing time by size band:');
  for (const stratum of strata) {
    const stratumResults = results.filter(r =>
      r.video.size_bytes >= stratum.minBytes && r.video.size_bytes <= stratum.maxBytes && r.success
    );
    if (stratumResults.length > 0) {
      const avgMs = stratumResults.reduce((sum, r) => sum + r.durationMs, 0) / stratumResults.length;
      const minMs = Math.min(...stratumResults.map(r => r.durationMs));
      const maxMs = Math.max(...stratumResults.map(r => r.durationMs));
      console.log(`  ${stratum.label}: avg ${(avgMs / 1000).toFixed(1)}s, min ${(minMs / 1000).toFixed(1)}s, max ${(maxMs / 1000).toFixed(1)}s (n=${stratumResults.length})`);
    } else {
      console.log(`  ${stratum.label}: no successful results`);
    }
  }

  // Error breakdown
  const errorReasons: Record<string, number> = {};
  for (const r of results.filter(r => !r.success)) {
    const reason = (r.error ?? 'unknown').slice(0, 120);
    errorReasons[reason] = (errorReasons[reason] ?? 0) + 1;
  }
  if (Object.keys(errorReasons).length > 0) {
    console.log('\nFailure reasons:');
    for (const [reason, count] of Object.entries(errorReasons).sort((a, b) => b[1] - a[1])) {
      console.log(`  [${count}x] ${reason}`);
    }
  }

  // By size stratum
  console.log('\n── BY SIZE STRATUM ──\n');
  for (const stratum of strata) {
    const stratumResults = results.filter(r =>
      r.video.size_bytes >= stratum.minBytes && r.video.size_bytes <= stratum.maxBytes
    );
    const ok = stratumResults.filter(r => r.success).length;
    const fail = stratumResults.filter(r => !r.success).length;
    const recovered = stratumResults.filter(r =>
      r.success && r.newProducts && r.newProducts.length > 0 &&
      (!r.video.products || r.video.products.length === 0)
    ).length;
    const noProductsStillEmpty = stratumResults.filter(r =>
      r.success && (!r.newProducts || r.newProducts.length === 0) &&
      (!r.video.products || r.video.products.length === 0)
    ).length;
    console.log(`  ${stratum.label}: ${ok}/${stratumResults.length} succeeded, ${fail} failed, ${recovered} recovered products, ${noProductsStillEmpty} still empty`);
  }

  // Status transition verification
  console.log('\n── STATUS TRANSITION VERIFICATION ──\n');
  const successStatuses: Record<string, number> = {};
  const failStatuses: Record<string, number> = {};
  for (const r of results) {
    const { data: final } = await supabase
      .from('videos')
      .select('status, analysis_mode')
      .eq('id', r.video.id)
      .single();
    if (r.success) {
      const key = `status=${final?.status}, mode=${final?.analysis_mode}`;
      successStatuses[key] = (successStatuses[key] ?? 0) + 1;
    } else {
      const key = `status=${final?.status}, mode=${final?.analysis_mode}`;
      failStatuses[key] = (failStatuses[key] ?? 0) + 1;
    }
  }
  console.log('Successful videos final state:');
  for (const [key, count] of Object.entries(successStatuses)) {
    console.log(`  ${key}: ${count}`);
  }
  if (Object.keys(failStatuses).length > 0) {
    console.log('Failed videos final state:');
    for (const [key, count] of Object.entries(failStatuses)) {
      console.log(`  ${key}: ${count}`);
    }
  }

  // Instability indicators
  console.log('\n── INSTABILITY CHECK ──\n');
  const timeouts = results.filter(r => r.error && r.error.includes('timed out'));
  const rateLimits = results.filter(r => r.error && (r.error.includes('429') || r.error.includes('rate')));
  const parseErrors = results.filter(r => r.error && r.error.includes('parse'));
  const longRunning = results.filter(r => r.durationMs > 300_000); // >5 min
  console.log(`  Timeouts: ${timeouts.length}`);
  console.log(`  Rate limit errors: ${rateLimits.length}`);
  console.log(`  Parse errors: ${parseErrors.length}`);
  console.log(`  Long-running (>5min): ${longRunning.length}`);
  console.log(`  Circuit breaker triggered: ${consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? 'YES' : 'no'}`);

  if (timeouts.length === 0 && rateLimits.length === 0 && consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
    console.log('\n  ✅ No signs of instability. Safe to scale further.');
  } else {
    console.log('\n  ⚠️  Review issues above before scaling.');
  }
}

main().catch(console.error);
