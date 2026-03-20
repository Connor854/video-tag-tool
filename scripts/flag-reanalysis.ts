/**
 * Flag thumbnail-only videos for reanalysis.
 *
 * This script does NOT re-analyze anything — it only sets status='reanalysis_needed'
 * so the next scan run (with queueOnly: true) will pick them up.
 *
 * Two groups are flagged:
 *   1. Thumbnail videos under 200MB — these were silent download/upload failures.
 *      With the fix in place, they'll now retry full video analysis properly.
 *   2. Thumbnail videos 200MB–1GB — previously exceeded the 200MB limit,
 *      now within the raised 1GB limit.
 *
 * Run with: npx tsx scripts/flag-reanalysis.ts [--dry-run]
 */
import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

const DRY_RUN = process.argv.includes('--dry-run');
const NEW_LIMIT = 1024 * 1024 * 1024; // 1 GB — matches the updated MAX_VIDEO_SIZE_BYTES

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (no changes will be made) ===' : '=== LIVE RUN ===');
  console.log();

  // Fetch all analyzed thumbnail videos in batches
  const thumbVideos: Array<{ id: string; size_bytes: number | null; name: string }> = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('videos')
      .select('id, size_bytes, name')
      .eq('status', 'analyzed')
      .eq('analysis_mode', 'thumbnail')
      .range(from, from + 999);
    if (error) { console.error('Query error:', error.message); break; }
    if (!data || data.length === 0) break;
    thumbVideos.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  console.log(`Total thumbnail-only analyzed videos: ${thumbVideos.length}`);

  // Group 1: under old 200MB limit (download/upload failures)
  const group1 = thumbVideos.filter(v =>
    v.size_bytes && v.size_bytes > 0 && v.size_bytes <= 200 * 1024 * 1024
  );
  // Group 2: 200MB–1GB (now within raised limit)
  const group2 = thumbVideos.filter(v =>
    v.size_bytes && v.size_bytes > 200 * 1024 * 1024 && v.size_bytes <= NEW_LIMIT
  );
  // Group 3: over 1GB (still too large, leave as-is)
  const group3 = thumbVideos.filter(v =>
    v.size_bytes && v.size_bytes > NEW_LIMIT
  );
  // Group 4: zero/null size (can't analyze)
  const group4 = thumbVideos.filter(v => !v.size_bytes || v.size_bytes === 0);

  console.log(`\nGroup 1 — under 200MB (download failures): ${group1.length}`);
  console.log(`Group 2 — 200MB–1GB (now within limit): ${group2.length}`);
  console.log(`Group 3 — over 1GB (still too large): ${group3.length}`);
  console.log(`Group 4 — zero/null size: ${group4.length}`);

  const toFlag = [...group1, ...group2];
  console.log(`\nTotal to flag for reanalysis: ${toFlag.length}`);

  if (DRY_RUN) {
    console.log('\nDry run complete. Run without --dry-run to apply changes.');
    return;
  }

  // Flag in batches of 100
  let flagged = 0;
  for (let i = 0; i < toFlag.length; i += 100) {
    const batch = toFlag.slice(i, i + 100);
    const ids = batch.map(v => v.id);
    const { error } = await supabase
      .from('videos')
      .update({
        status: 'reanalysis_needed',
        processing_error: 'Flagged for reanalysis: previously thumbnail-only due to download failure or size limit',
      })
      .in('id', ids);

    if (error) {
      console.error(`Batch ${i} error:`, error.message);
    } else {
      flagged += batch.length;
    }

    if ((i + 100) % 500 === 0 || i + 100 >= toFlag.length) {
      console.log(`  Flagged ${flagged}/${toFlag.length}...`);
    }
  }

  console.log(`\nDone. ${flagged} videos flagged as reanalysis_needed.`);
  console.log('To reprocess, run a scan with queueOnly: true.');
}

main().catch(console.error);
