import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';

async function main() {
  const wid = getDefaultWorkspaceId();
  
  // Use approximate counts from size band data and small-partition exact counts
  const small = await Promise.all([
    supabase.from('videos').select('*', { count: 'exact', head: true }).eq('workspace_id', wid).eq('status', 'synced'),
    supabase.from('videos').select('*', { count: 'exact', head: true }).eq('workspace_id', wid).eq('status', 'triaged'),
    supabase.from('videos').select('*', { count: 'exact', head: true }).eq('workspace_id', wid).eq('status', 'analyzing'),
    supabase.from('videos').select('*', { count: 'exact', head: true }).eq('workspace_id', wid).eq('status', 'error'),
    supabase.from('videos').select('*', { count: 'exact', head: true }).eq('workspace_id', wid).eq('status', 'excluded'),
  ]);
  
  console.log(`synced: ${small[0].count}`);
  console.log(`triaged: ${small[1].count}`);
  console.log(`analyzing: ${small[2].count}`);
  console.log(`error: ${small[3].count}`);
  console.log(`excluded: ${small[4].count}`);
  
  // For large partitions, use mode sums
  const modes = await Promise.all([
    supabase.from('videos').select('*', { count: 'exact', head: true }).eq('workspace_id', wid).eq('analysis_mode', 'full_video'),
    supabase.from('videos').select('*', { count: 'exact', head: true }).eq('workspace_id', wid).eq('analysis_mode', 'thumbnail'),
    supabase.from('videos').select('*', { count: 'exact', head: true }).eq('workspace_id', wid).eq('analysis_mode', 'thumbnail_size_limit'),
  ]);
  
  console.log(`\nfull_video (any status): ${modes[0].count}`);
  console.log(`thumbnail (any status): ${modes[1].count}`);
  console.log(`thumbnail_size_limit (any status): ${modes[2].count}`);
  
  // Recent full_video completions by time window
  const windows = [1, 4, 12, 24];
  for (const h of windows) {
    const { count } = await supabase.from('videos').select('*', { count: 'exact', head: true })
      .eq('workspace_id', wid).eq('analysis_mode', 'full_video').eq('status', 'analyzed')
      .gte('updated_at', new Date(Date.now() - h*3600000).toISOString());
    console.log(`full_video analyzed in last ${h}h: ${count}`);
  }
  
  // Reanalysis_needed estimate via range query
  const { data: raSample } = await supabase.from('videos')
    .select('id')
    .eq('workspace_id', wid)
    .eq('status', 'reanalysis_needed')
    .limit(1000);
  const raCount = raSample?.length ?? 0;
  console.log(`\nreanalysis_needed (sampled up to 1000): ${raCount}${raCount === 1000 ? '+' : ''}`);
  
  // Check if more than 1000
  if (raCount === 1000) {
    const { data: raSample2 } = await supabase.from('videos')
      .select('id')
      .eq('workspace_id', wid)
      .eq('status', 'reanalysis_needed')
      .range(1000, 9999)
      .limit(9000);
    console.log(`reanalysis_needed (1000+): ${1000 + (raSample2?.length ?? 0)}`);
  }
  
  // Recent completions
  const { data: recent } = await supabase.from('videos')
    .select('name, size_bytes, updated_at')
    .eq('workspace_id', wid).eq('status', 'analyzed').eq('analysis_mode', 'full_video')
    .order('updated_at', { ascending: false })
    .limit(10);
  
  console.log('\n--- Last 10 full_video completions ---');
  for (const v of recent ?? []) {
    const mb = v.size_bytes ? Math.round(v.size_bytes/1024/1024) : '?';
    const ago = Math.round((Date.now() - new Date(v.updated_at).getTime()) / 60000);
    console.log(`  [${mb}MB] ${v.name} — ${ago}min ago`);
  }
  
  // New errors since scan started
  const { data: newErrors } = await supabase.from('videos')
    .select('name, processing_error, updated_at, size_bytes')
    .eq('workspace_id', wid).eq('status', 'error')
    .gte('updated_at', new Date(Date.now() - 4*3600000).toISOString())
    .order('updated_at', { ascending: false })
    .limit(10);
  
  console.log(`\n--- Errors in last 4h: ${newErrors?.length ?? 0} ---`);
  for (const e of newErrors ?? []) {
    const mb = e.size_bytes ? Math.round(e.size_bytes/1024/1024) : '?';
    console.log(`  [${mb}MB] ${e.name}: ${(e.processing_error ?? '').slice(0, 120)}`);
  }
}
main().catch(console.error);
