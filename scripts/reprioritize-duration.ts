/**
 * Reprioritize the analysis queue so shorter videos are processed first.
 * Priority = 100 - floor(duration_seconds / 10), clamped to 0–100.
 * Only touches videos in the queue (triaged / reanalysis_needed / error).
 */
import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  // Supabase doesn't have a default limit — but the JS client caps at 1000.
  // Paginate to get all queued videos.
  const allQueued: Array<{ id: string; duration_seconds: number | null; priority: number | null }> = [];
  let from = 0;
  const PAGE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('videos')
      .select('id, duration_seconds, priority')
      .in('status', ['triaged', 'reanalysis_needed', 'error'])
      .not('duration_seconds', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1);

    if (error) {
      console.error('Fetch error:', error);
      return;
    }
    if (!data || data.length === 0) break;
    allQueued.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`Reprioritizing ${allQueued.length} queued videos by duration...`);

  // Group videos by their new priority value
  const byNewPriority = new Map<number, string[]>();
  let needsUpdate = 0;

  for (const v of allQueued) {
    const dur = v.duration_seconds ?? 0;
    const newPriority = Math.max(0, Math.min(100, 100 - Math.floor(dur / 10)));
    if (newPriority !== v.priority) {
      needsUpdate++;
      const ids = byNewPriority.get(newPriority) ?? [];
      ids.push(v.id);
      byNewPriority.set(newPriority, ids);
    }
  }

  console.log(`${needsUpdate} videos need priority updates across ${byNewPriority.size} priority levels`);

  // Batch update: one UPDATE per priority level, chunked by 500 IDs
  let changed = 0;
  for (const [priority, ids] of byNewPriority.entries()) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { error: upErr } = await supabase
        .from('videos')
        .update({ priority })
        .in('id', chunk);

      if (upErr) {
        console.error(`Update error for priority=${priority}, chunk at ${i}:`, upErr);
      } else {
        changed += chunk.length;
      }
    }
  }

  // Show distribution
  const dist: Array<{ priority: number | null }> = [];
  from = 0;
  while (true) {
    const { data } = await supabase
      .from('videos')
      .select('priority')
      .in('status', ['triaged', 'reanalysis_needed', 'error'])
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    dist.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const buckets: Record<string, number> = {};
  for (const v of dist) {
    const p = v.priority ?? 0;
    const label = p >= 99 ? '99-100 (0-19s)' :
                  p >= 95 ? '95-98 (20-59s)' :
                  p >= 90 ? '90-94 (1-2min)' :
                  p >= 70 ? '70-89 (2-5min)' :
                            '<70 (5min+)';
    buckets[label] = (buckets[label] ?? 0) + 1;
  }
  console.log('\nQueue priority distribution:');
  for (const [label, count] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${label}: ${count}`);
  }

  console.log(`\nDone. Updated ${changed} priorities.`);
}

main().catch(console.error);
