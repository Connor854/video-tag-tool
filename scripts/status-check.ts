import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';

async function main() {
  const wid = getDefaultWorkspaceId();
  
  // Status counts
  for (const status of ['synced', 'triaged', 'reanalysis_needed', 'analyzing', 'analyzed', 'error']) {
    const { count } = await supabase.from('videos').select('*', { count: 'exact', head: true })
      .eq('workspace_id', wid).eq('status', status);
    console.log(`${status}: ${count}`);
  }
  
  // Mode counts for analyzed
  for (const mode of ['full_video', 'thumbnail', 'thumbnail_size_limit']) {
    const { count } = await supabase.from('videos').select('*', { count: 'exact', head: true })
      .eq('workspace_id', wid).eq('status', 'analyzed').eq('analysis_mode', mode);
    console.log(`  analyzed/${mode}: ${count}`);
  }
  
  // Recent completions (last hour)
  const { data: recent } = await supabase.from('videos')
    .select('name, status, analysis_mode, size_bytes, updated_at')
    .eq('workspace_id', wid)
    .eq('status', 'analyzed')
    .eq('analysis_mode', 'full_video')
    .gte('updated_at', new Date(Date.now() - 3600000).toISOString())
    .order('updated_at', { ascending: false })
    .limit(10);
  
  console.log('\n--- Recent full_video completions (last hour) ---');
  for (const v of recent ?? []) {
    const mb = v.size_bytes ? Math.round(v.size_bytes/1024/1024) : '?';
    console.log(`  [${mb}MB] ${v.name} at ${v.updated_at}`);
  }
  
  // Recent completions (last 24h count)
  const { count: last24h } = await supabase.from('videos').select('*', { count: 'exact', head: true })
    .eq('workspace_id', wid).eq('status', 'analyzed').eq('analysis_mode', 'full_video')
    .gte('updated_at', new Date(Date.now() - 86400000).toISOString());
  console.log(`\nFull video completions in last 24h: ${last24h}`);
  
  // Recent completions (last 4h count)
  const { count: last4h } = await supabase.from('videos').select('*', { count: 'exact', head: true })
    .eq('workspace_id', wid).eq('status', 'analyzed').eq('analysis_mode', 'full_video')
    .gte('updated_at', new Date(Date.now() - 4*3600000).toISOString());
  console.log(`Full video completions in last 4h: ${last4h}`);
  
  // Recent errors
  const { data: errors } = await supabase.from('videos')
    .select('name, processing_error, updated_at')
    .eq('workspace_id', wid).eq('status', 'error')
    .order('updated_at', { ascending: false })
    .limit(5);
  console.log('\n--- Recent errors ---');
  for (const e of errors ?? []) {
    console.log(`  ${e.name}: ${(e.processing_error ?? '').slice(0, 100)} at ${e.updated_at}`);
  }
}
main().catch(console.error);
