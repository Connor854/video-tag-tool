/**
 * Diagnostic script to investigate worker activity patterns.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

async function main() {
  console.log('=== Worker Diagnostics ===\n');

  // 1. Count videos currently in 'analyzing' status
  const { count: analyzingCount } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'analyzing');
  console.log(`1. Videos currently in 'analyzing' status: ${analyzingCount}`);

  // 2. Count videos in 'triaged' status (queue size)
  const { count: triagedCount } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'triaged');
  console.log(`2. Videos in 'triaged' status (queue): ${triagedCount}`);

  // Also count reanalysis_needed and error (also in queue)
  const { count: reanalysisCount } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'reanalysis_needed');
  const { count: errorCount } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'error');
  console.log(`   Videos in 'reanalysis_needed': ${reanalysisCount}`);
  console.log(`   Videos in 'error': ${errorCount}`);

  // Count analyzed
  const { count: analyzedCount } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'analyzed');
  console.log(`   Videos in 'analyzed': ${analyzedCount}`);

  // 3. Last 50 completions with indexed_at timestamps
  console.log('\n3. Last 50 completions (indexed_at):');
  const { data: recentCompletions } = await supabase
    .from('videos')
    .select('name, indexed_at, status, analysis_mode')
    .not('indexed_at', 'is', null)
    .order('indexed_at', { ascending: false })
    .limit(50);

  if (recentCompletions && recentCompletions.length > 0) {
    let prevTime: Date | null = null;
    for (const v of recentCompletions.reverse()) {
      const t = new Date(v.indexed_at);
      const gap = prevTime ? ((t.getTime() - prevTime.getTime()) / 1000).toFixed(1) : '-';
      console.log(`   ${v.indexed_at}  gap=${gap}s  [${v.analysis_mode}] ${v.name?.substring(0, 60)}`);
      prevTime = t;
    }
  } else {
    console.log('   No completions found');
  }

  // 4. Stuck videos — analyzing for more than 10 minutes
  console.log('\n4. Stuck videos (analyzing for >10 min):');
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: stuckVideos } = await supabase
    .from('videos')
    .select('id, name, status, updated_at')
    .eq('status', 'analyzing')
    .lt('updated_at', tenMinAgo)
    .limit(20);

  if (stuckVideos && stuckVideos.length > 0) {
    for (const v of stuckVideos) {
      const stuckMin = ((Date.now() - new Date(v.updated_at).getTime()) / 60000).toFixed(1);
      console.log(`   STUCK ${stuckMin}min: ${v.name} (${v.id})`);
    }
  } else {
    console.log('   None found');
  }

  // 5. Completions per 5-minute bucket in last 30 minutes
  console.log('\n5. Completions per 5-minute bucket (last 30 min):');
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: recentAnalyzed } = await supabase
    .from('videos')
    .select('indexed_at')
    .not('indexed_at', 'is', null)
    .gte('indexed_at', thirtyMinAgo)
    .order('indexed_at', { ascending: true });

  if (recentAnalyzed && recentAnalyzed.length > 0) {
    const buckets = new Map<string, number>();
    for (const v of recentAnalyzed) {
      const t = new Date(v.indexed_at);
      const bucketStart = new Date(Math.floor(t.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000));
      const key = bucketStart.toISOString().substring(11, 16);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    for (const [bucket, count] of buckets) {
      const bar = '#'.repeat(count);
      console.log(`   ${bucket}: ${count.toString().padStart(3)} ${bar}`);
    }
    console.log(`   Total in last 30min: ${recentAnalyzed.length}`);
  } else {
    console.log('   No completions in last 30 minutes');
  }

  // 6. Overall status distribution
  console.log('\n6. Overall status distribution:');
  const { data: allStatuses } = await supabase
    .from('videos')
    .select('status')
    .limit(10000);

  if (allStatuses) {
    const dist = new Map<string, number>();
    for (const v of allStatuses) {
      dist.set(v.status, (dist.get(v.status) ?? 0) + 1);
    }
    for (const [status, count] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${status}: ${count}`);
    }
  }
}

main().catch(console.error);
