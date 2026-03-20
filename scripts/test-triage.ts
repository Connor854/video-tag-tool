/**
 * Test script: runs sync + triage only (no Gemini analysis).
 * Reports triage metrics and example payloads.
 *
 * Usage: npx tsx scripts/test-triage.ts
 */

import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId, getWorkspaceCredentials } from '../src/lib/workspace.js';
import { syncDriveFiles, triageVideos, clearProductCache } from '../src/services/scanner.js';

async function main() {
  const workspaceId = getDefaultWorkspaceId();
  const creds = await getWorkspaceCredentials(workspaceId);

  if (!creds.googleDriveFolderId || !creds.googleServiceAccountKey) {
    console.error('Google Drive not configured');
    process.exit(1);
  }

  clearProductCache();

  // Phase 1: Sync
  console.log('=== Phase 1: Sync ===');
  const syncResult = await syncDriveFiles(workspaceId);
  console.log(`  Total in Drive: ${syncResult.totalInDrive}`);
  console.log(`  New files synced: ${syncResult.newFiles}`);
  console.log(`  Already synced: ${syncResult.alreadySynced}`);

  // Phase 1b: Triage
  console.log('\n=== Phase 1b: Triage ===');
  const triageSummary = await triageVideos(workspaceId);
  console.log(`  Total processed: ${triageSummary.total}`);
  console.log(`  Triaged: ${triageSummary.triaged}`);
  console.log(`  Excluded: ${triageSummary.excluded}`);

  // Query priority distribution
  console.log('\n=== Priority Distribution ===');
  const { data: triaged } = await supabase
    .from('videos')
    .select('priority')
    .eq('workspace_id', workspaceId)
    .eq('status', 'triaged');

  if (triaged && triaged.length > 0) {
    const high = triaged.filter((v) => (v.priority ?? 0) >= 70).length;
    const medium = triaged.filter((v) => (v.priority ?? 0) >= 40 && (v.priority ?? 0) < 70).length;
    const low = triaged.filter((v) => (v.priority ?? 0) < 40).length;
    console.log(`  High (70-100): ${high}`);
    console.log(`  Medium (40-69): ${medium}`);
    console.log(`  Low (0-39): ${low}`);

    // Priority histogram
    const buckets: Record<string, number> = {};
    for (const v of triaged) {
      const p = v.priority ?? 0;
      const bucket = `${Math.floor(p / 10) * 10}-${Math.floor(p / 10) * 10 + 9}`;
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    console.log('\n  Priority buckets:');
    for (const [bucket, count] of Object.entries(buckets).sort()) {
      console.log(`    ${bucket}: ${count}`);
    }
  }

  // Example triage_result payloads
  console.log('\n=== Example Triage Results (5 highest priority) ===');
  const { data: topVideos } = await supabase
    .from('videos')
    .select('name, drive_path, priority, triage_result')
    .eq('workspace_id', workspaceId)
    .eq('status', 'triaged')
    .order('priority', { ascending: false })
    .limit(5);

  if (topVideos) {
    for (const v of topVideos) {
      console.log(`\n  "${v.name}" (priority: ${v.priority})`);
      console.log(`    folder: ${v.drive_path || '(root)'}`);
      const tr = v.triage_result as any;
      if (tr) {
        if (tr.product_candidates?.length > 0) {
          console.log(`    product candidates: ${tr.product_candidates.map((c: any) => `${c.product_name} (${c.match_source}, sim=${c.similarity})`).join(', ')}`);
        }
        if (tr.folder_signals?.length > 0) {
          console.log(`    folder signals: ${tr.folder_signals.join(', ')}`);
        }
        console.log(`    breakdown: ${JSON.stringify(tr.priority_breakdown)}`);
      }
    }
  }

  // Also show 3 lowest priority
  console.log('\n=== Example Triage Results (3 lowest priority) ===');
  const { data: bottomVideos } = await supabase
    .from('videos')
    .select('name, drive_path, priority, triage_result')
    .eq('workspace_id', workspaceId)
    .eq('status', 'triaged')
    .order('priority', { ascending: true })
    .limit(3);

  if (bottomVideos) {
    for (const v of bottomVideos) {
      console.log(`\n  "${v.name}" (priority: ${v.priority})`);
      console.log(`    folder: ${v.drive_path || '(root)'}`);
      const tr = v.triage_result as any;
      if (tr) {
        if (tr.folder_signals?.length > 0) {
          console.log(`    folder signals: ${tr.folder_signals.join(', ')}`);
        }
        console.log(`    breakdown: ${JSON.stringify(tr.priority_breakdown)}`);
      }
    }
  }

  // Show excluded reasons
  console.log('\n=== Excluded Breakdown ===');
  const { data: excludedVideos } = await supabase
    .from('videos')
    .select('processing_error')
    .eq('workspace_id', workspaceId)
    .eq('status', 'excluded');

  if (excludedVideos && excludedVideos.length > 0) {
    const reasons: Record<string, number> = {};
    for (const v of excludedVideos) {
      const reason = v.processing_error ?? 'unknown';
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
    for (const [reason, count] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}x ${reason}`);
    }
  }

  // Queue order verification
  console.log('\n=== Queue Order (first 10 to be analyzed) ===');
  const { data: queueTop } = await supabase
    .from('videos')
    .select('name, priority, drive_path')
    .eq('workspace_id', workspaceId)
    .eq('status', 'triaged')
    .order('priority', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(10);

  if (queueTop) {
    for (let i = 0; i < queueTop.length; i++) {
      const v = queueTop[i];
      console.log(`  ${i + 1}. [p=${v.priority}] ${v.name}  (${v.drive_path || 'root'})`);
    }
  }
}

main().catch(console.error);
