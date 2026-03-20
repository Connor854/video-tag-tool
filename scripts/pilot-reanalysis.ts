/**
 * Pilot reanalysis: pick 25 thumbnail-only videos, re-analyze them with the
 * fixed code, and report results.
 *
 * Stratified sample:
 *   - 15 videos under 50MB (bulk of the backlog)
 *   - 5 videos 50-200MB
 *   - 5 videos 200MB-1GB (newly eligible after size limit raise)
 *
 * Run with: npx tsx scripts/pilot-reanalysis.ts
 */
import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';
import { getWorkspaceCredentials } from '../src/lib/workspace.js';
import { analyzeOneVideo } from '../src/services/scanner.js';

interface PilotVideo {
  id: string;
  drive_id: string;
  name: string;
  size_bytes: number;
  duration_seconds: number | null;
  products: string[] | null;
  analysis_mode: string | null;
  summary: string | null;
}

interface PilotResult {
  video: PilotVideo;
  success: boolean;
  newMode: string | null;
  newProducts: string[] | null;
  newSummary: string | null;
  error: string | null;
  durationMs: number;
}

async function main() {
  const workspaceId = getDefaultWorkspaceId();
  const creds = await getWorkspaceCredentials(workspaceId);

  if (!creds.googleServiceAccountKey || !creds.geminiApiKey) {
    console.error('Missing credentials. Set GOOGLE_SERVICE_ACCOUNT_KEY and GEMINI_API_KEY.');
    process.exit(1);
  }

  console.log('=== PILOT REANALYSIS — 25 videos ===\n');

  // Fetch thumbnail-only analyzed videos, stratified by size
  const strata = [
    { label: 'under 50MB', minBytes: 1, maxBytes: 50 * 1024 * 1024, count: 15 },
    { label: '50-200MB', minBytes: 50 * 1024 * 1024 + 1, maxBytes: 200 * 1024 * 1024, count: 5 },
    { label: '200MB-1GB', minBytes: 200 * 1024 * 1024 + 1, maxBytes: 1024 * 1024 * 1024, count: 5 },
  ];

  const pilotVideos: PilotVideo[] = [];

  for (const stratum of strata) {
    const { data, error } = await supabase
      .from('videos')
      .select('id, drive_id, name, size_bytes, duration_seconds, products, analysis_mode, summary')
      .eq('status', 'analyzed')
      .eq('analysis_mode', 'thumbnail')
      .gte('size_bytes', stratum.minBytes)
      .lte('size_bytes', stratum.maxBytes)
      .not('drive_id', 'is', null)
      .limit(stratum.count);

    if (error) {
      console.error(`Stratum "${stratum.label}" query error:`, error.message);
      continue;
    }
    console.log(`Stratum "${stratum.label}": found ${data?.length ?? 0} (want ${stratum.count})`);
    if (data) pilotVideos.push(...(data as PilotVideo[]));
  }

  console.log(`\nTotal pilot videos: ${pilotVideos.length}\n`);

  if (pilotVideos.length === 0) {
    console.log('No eligible videos found. Exiting.');
    return;
  }

  // Record "before" state
  const before = pilotVideos.map(v => ({
    id: v.id,
    name: v.name,
    sizeMB: (v.size_bytes / 1024 / 1024).toFixed(1),
    hadProducts: (v.products && v.products.length > 0) ? v.products.length : 0,
    mode: v.analysis_mode,
    summaryPreview: (v.summary ?? '').slice(0, 80),
  }));

  console.log('── BEFORE STATE ──\n');
  for (const b of before) {
    console.log(`  ${b.name} (${b.sizeMB}MB) | mode=${b.mode} | products=${b.hadProducts} | "${b.summaryPreview}"`);
  }

  // Process each video
  const results: PilotResult[] = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < pilotVideos.length; i++) {
    const v = pilotVideos[i];
    const sizeMB = (v.size_bytes / 1024 / 1024).toFixed(1);
    process.stdout.write(`\n[${i + 1}/${pilotVideos.length}] ${v.name} (${sizeMB}MB)... `);

    // Set to analyzing so analyzeOneVideo can process it
    await supabase.from('videos').update({ status: 'analyzing' }).eq('id', v.id);

    const startMs = Date.now();
    let success = false;
    let error: string | null = null;

    try {
      // analyzeOneVideo sets status='analyzing' internally, but we already did that
      // We need to temporarily set it back so the function can claim it
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
      process.stdout.write(`OK (${(durationMs / 1000).toFixed(1)}s) → mode=${updated?.analysis_mode} products=${updated?.products?.length ?? 0}`);
    } else {
      failCount++;
      process.stdout.write(`FAIL (${(durationMs / 1000).toFixed(1)}s) → status=${updated?.status} error=${(updated?.processing_error ?? error ?? 'unknown').slice(0, 100)}`);
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

    // Rate limiting — 2s between requests to be safe
    if (i < pilotVideos.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // ── RESULTS SUMMARY ──
  console.log('\n\n══════════════════════════════════════');
  console.log('         PILOT RESULTS SUMMARY');
  console.log('══════════════════════════════════════\n');

  console.log(`Total: ${pilotVideos.length}`);
  console.log(`Succeeded: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Success rate: ${(successCount / pilotVideos.length * 100).toFixed(0)}%`);

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
  const hasProductsAfter = results.filter(r => r.newProducts && r.newProducts.length > 0);

  console.log(`\nProduct recovery:`);
  console.log(`  Had products before: ${hadProductsBefore.length}`);
  console.log(`  Have products after: ${hasProductsAfter.length}`);
  console.log(`  Newly recovered: ${recoveredProducts.length}`);

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

  // Detailed per-video results
  console.log('\n── DETAILED RESULTS ──\n');
  for (const r of results) {
    const sizeMB = (r.video.size_bytes / 1024 / 1024).toFixed(1);
    const prodBefore = r.video.products?.length ?? 0;
    const prodAfter = r.newProducts?.length ?? 0;
    const summaryBefore = (r.video.summary ?? '').slice(0, 60);
    const summaryAfter = (r.newSummary ?? '').slice(0, 60);
    const status = r.success ? 'OK' : 'FAIL';
    const recovered = (prodAfter > 0 && prodBefore === 0) ? ' ★RECOVERED' : '';

    console.log(`  [${status}] ${r.video.name} (${sizeMB}MB, ${(r.durationMs / 1000).toFixed(1)}s)`);
    console.log(`    mode: ${r.video.analysis_mode} → ${r.newMode}`);
    console.log(`    products: ${prodBefore} → ${prodAfter}${recovered}`);
    if (r.newProducts && r.newProducts.length > 0) {
      console.log(`    products: ${r.newProducts.join(', ')}`);
    }
    console.log(`    summary: "${summaryBefore}" → "${summaryAfter}"`);
    if (r.error && !r.success) {
      console.log(`    error: ${r.error.slice(0, 200)}`);
    }
    console.log();
  }

  // Size stratum breakdown
  console.log('── BY SIZE STRATUM ──\n');
  for (const stratum of strata) {
    const stratumResults = results.filter(r =>
      r.video.size_bytes >= stratum.minBytes && r.video.size_bytes <= stratum.maxBytes
    );
    const ok = stratumResults.filter(r => r.success).length;
    const recovered = stratumResults.filter(r =>
      r.success && r.newProducts && r.newProducts.length > 0 &&
      (!r.video.products || r.video.products.length === 0)
    ).length;
    console.log(`  ${stratum.label}: ${ok}/${stratumResults.length} succeeded, ${recovered} recovered products`);
  }
}

main().catch(console.error);
