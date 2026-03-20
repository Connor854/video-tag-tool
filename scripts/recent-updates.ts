import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';

async function main() {
  const wid = getDefaultWorkspaceId();
  
  // Most recently updated videos regardless of status/mode
  const { data: recent } = await supabase.from('videos')
    .select('name, status, analysis_mode, size_bytes, updated_at')
    .eq('workspace_id', wid)
    .order('updated_at', { ascending: false })
    .limit(20);
  
  console.log('--- 20 Most Recently Updated Videos ---');
  for (const v of recent ?? []) {
    const mb = v.size_bytes ? Math.round(v.size_bytes/1024/1024) : '?';
    const ago = Math.round((Date.now() - new Date(v.updated_at).getTime()) / 60000);
    console.log(`  [${mb}MB] ${v.status}/${v.analysis_mode ?? 'null'} ${v.name} — ${ago}min ago`);
  }
  
  // Count reanalysis_needed by paginating
  let raTotal = 0;
  let from = 0;
  while (true) {
    const { data } = await supabase.from('videos')
      .select('id')
      .eq('workspace_id', wid)
      .eq('status', 'reanalysis_needed')
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    raTotal += data.length;
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`\nTotal reanalysis_needed: ${raTotal}`);
  
  // Count recently completed reanalysis (analyzed videos updated in last 2h)
  const { data: recentAnalyzed } = await supabase.from('videos')
    .select('id')
    .eq('workspace_id', wid)
    .eq('status', 'analyzed')
    .gte('updated_at', new Date(Date.now() - 2*3600000).toISOString())
    .limit(1000);
  console.log(`Videos analyzed in last 2h: ${recentAnalyzed?.length ?? 0}`);
  
  // Worker heartbeats from scan status
  const { data: analyzing } = await supabase.from('videos')
    .select('name, size_bytes, updated_at')
    .eq('workspace_id', wid)
    .eq('status', 'analyzing')
    .order('updated_at', { ascending: false });
  console.log(`\n--- Currently analyzing: ${analyzing?.length ?? 0} ---`);
  for (const v of analyzing ?? []) {
    const mb = v.size_bytes ? Math.round(v.size_bytes/1024/1024) : '?';
    const ago = Math.round((Date.now() - new Date(v.updated_at).getTime()) / 1000);
    console.log(`  [${mb}MB] ${v.name} — claimed ${ago}s ago`);
  }
}
main().catch(console.error);
