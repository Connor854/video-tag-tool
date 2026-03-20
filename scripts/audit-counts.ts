import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';

async function main() {
  const wid = getDefaultWorkspaceId();
  const cq = async (filter: (q: any) => any) => {
    const q = supabase.from('videos').select('*', { count: 'exact', head: true }).eq('workspace_id', wid);
    const { count, error } = await filter(q);
    if (error) return `ERROR: ${error.message}`;
    return count;
  };

  for (const s of ['synced','triaged','reanalysis_needed','analyzing','analyzed','error','excluded']) {
    const c = await cq(q => q.eq('status', s));
    console.log(`status/${s}: ${c}`);
  }
  const total = await cq(q => q);
  console.log(`total: ${total}`);

  for (const m of ['full_video','thumbnail','thumbnail_size_limit']) {
    const c = await cq(q => q.eq('status', 'analyzed').eq('analysis_mode', m));
    console.log(`analyzed/${m}: ${c}`);
  }
  const nullMode = await cq(q => q.eq('status', 'analyzed').is('analysis_mode', null));
  console.log(`analyzed/null_mode: ${nullMode}`);

  for (const [label, ms] of [['1h', 3600000], ['4h', 4*3600000], ['24h', 86400000]] as const) {
    const since = new Date(Date.now() - ms).toISOString();
    const c = await cq(q => q.eq('status', 'analyzed').eq('analysis_mode', 'full_video').gte('updated_at', since));
    console.log(`full_video_last_${label}: ${c}`);
  }
  for (const [label, ms] of [['1h', 3600000], ['4h', 4*3600000], ['24h', 86400000]] as const) {
    const since = new Date(Date.now() - ms).toISOString();
    const c = await cq(q => q.eq('status', 'error').gte('updated_at', since));
    console.log(`errors_last_${label}: ${c}`);
  }
}
main().catch(console.error);
