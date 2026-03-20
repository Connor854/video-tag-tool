import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';
async function main() {
  const wid = getDefaultWorkspaceId();
  // Try ordering by updated_at desc, just get top 10
  const { data: d1 } = await supabase.from('videos')
    .select('name, size_bytes, analysis_mode, updated_at, status')
    .eq('workspace_id', wid).eq('status', 'analyzed').eq('analysis_mode', 'full_video')
    .order('updated_at', { ascending: false }).limit(10);
  console.log('=== By updated_at DESC ===');
  for (const v of d1 ?? []) {
    const mb = v.size_bytes ? (v.size_bytes/1024/1024).toFixed(1) : '?';
    console.log(`  ${v.name} | ${mb}MB | updated=${v.updated_at}`);
  }

  // Check if any have updated_at in the last hour
  const since = new Date(Date.now() - 3600000).toISOString();
  const { count } = await supabase.from('videos').select('*', { count: 'exact', head: true })
    .eq('workspace_id', wid).eq('status', 'analyzed').gte('updated_at', since);
  console.log(`\nAnalyzed with updated_at in last 1h: ${count}`);

  // Check analyzing rows (currently being worked on)
  const { data: d2 } = await supabase.from('videos')
    .select('name, size_bytes, updated_at')
    .eq('workspace_id', wid).eq('status', 'analyzing')
    .order('updated_at', { ascending: false }).limit(10);
  console.log('\n=== Currently analyzing ===');
  for (const v of d2 ?? []) {
    const mb = v.size_bytes ? (v.size_bytes/1024/1024).toFixed(1) : '?';
    const age = Math.round((Date.now() - new Date(v.updated_at).getTime()) / 60000);
    console.log(`  ${v.name} | ${mb}MB | updated=${v.updated_at} | age=${age}min`);
  }
}
main().catch(console.error);
