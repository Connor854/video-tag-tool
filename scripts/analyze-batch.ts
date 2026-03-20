/**
 * Run analysis on a batch of videos from the priority queue.
 *
 * Usage:
 *   npx tsx scripts/analyze-batch.ts                    # 10 videos, 3 workers, workspace from DEFAULT_WORKSPACE_ID
 *   npx tsx scripts/analyze-batch.ts 50                 # 50 videos, 3 workers
 *   npx tsx scripts/analyze-batch.ts 50 5               # 50 videos, 5 workers
 *   npx tsx scripts/analyze-batch.ts 50 5 <workspace-id> # explicit workspace
 *
 * Skips sync+triage (uses existing queue). Run test-triage.ts first
 * if the queue is empty.
 *
 * Creates a scan_jobs row for durable progress tracking. Use Admin UI
 * "Start Scan" for the same flow via the web app.
 */

import 'dotenv/config';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';
import { supabase } from '../src/lib/supabase.js';
import { getActiveScanJob, failScanJob } from '../src/server/routers/admin.js';
import { startScan } from '../src/services/scanner.js';

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

async function main() {
  const maxVideos = parseInt(process.argv[2] ?? '10', 10);
  const workers = parseInt(process.argv[3] ?? '3', 10);
  const workspaceArg = process.argv[4];

  const workspaceId = workspaceArg && isUuid(workspaceArg)
    ? workspaceArg
    : getDefaultWorkspaceId();

  console.log(`Analyzing up to ${maxVideos} videos with ${workers} workers (queue only, no re-sync)`);
  if (workspaceArg && isUuid(workspaceArg)) {
    console.log(`Workspace: ${workspaceId}`);
  }

  const existingJob = await getActiveScanJob(workspaceId);
  if (existingJob) {
    console.error('Scan already in progress. Stop it from Admin UI or wait for it to finish.');
    process.exit(1);
  }

  const { data: job, error: insertError } = await supabase
    .from('scan_jobs')
    .insert({
      workspace_id: workspaceId,
      status: 'running',
      progress: 0,
      total: 0,
      workers,
    })
    .select('id')
    .single();

  if (insertError || !job) {
    console.error('Failed to create scan job:', insertError);
    process.exit(1);
  }

  try {
    const result = await startScan(workspaceId, {
      maxVideos,
      workers,
      queueOnly: true,
      jobId: job.id,
    });

    console.log('\n=== Results ===');
    console.log(`  Analyzed: ${result.analyzed}`);
    console.log(`  Errors: ${result.errors}`);
    console.log(`  Skipped (triage excluded): ${result.skipped}`);
  } catch (err) {
    console.error('Scan failed:', err);
    await failScanJob(job.id, String(err));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
