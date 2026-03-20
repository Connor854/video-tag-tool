import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';

async function main() {
  const wid = getDefaultWorkspaceId();
  
  // Check for videos updated recently regardless of status (no ORDER BY on big partitions)
  // Use a time filter to keep the query small
  const cutoff = new Date(Date.now() - 2*3600000).toISOString();
  
  const { data, error } = await supabase.from('videos')
    .select('name, status, analysis_mode, size_bytes, updated_at, processing_error')
    .eq('workspace_id', wid)
    .gte('updated_at', cutoff)
    .limit(20);
  
  console.log('Error:', error?.message ?? 'none');
  console.log(`Videos updated in last 2h: ${data?.length ?? 0}`);
  for (const v of data ?? []) {
    const mb = v.size_bytes ? Math.round(v.size_bytes/1024/1024) : '?';
    const ago = Math.round((Date.now() - new Date(v.updated_at).getTime()) / 60000);
    console.log(`  [${mb}MB] ${v.status}/${v.analysis_mode ?? '-'} ${v.name} — ${ago}min ago`);
    if (v.processing_error) console.log(`    error: ${v.processing_error.slice(0, 150)}`);
  }
  
  // Also check last 24h
  const cutoff24 = new Date(Date.now() - 24*3600000).toISOString();
  const { data: d24, error: e24 } = await supabase.from('videos')
    .select('name, status, analysis_mode, updated_at')
    .eq('workspace_id', wid)
    .gte('updated_at', cutoff24)
    .limit(50);
  
  console.log(`\nVideos updated in last 24h: ${d24?.length ?? 0}`);
  // Group by status
  const byStatus: Record<string, number> = {};
  for (const v of d24 ?? []) {
    byStatus[v.status] = (byStatus[v.status] ?? 0) + 1;
  }
  console.log('By status:', byStatus);
  
  // Check what the 5 analyzing videos look like  
  const { data: aing } = await supabase.from('videos')
    .select('id, name, status, size_bytes, updated_at, drive_id')
    .eq('workspace_id', wid)
    .eq('status', 'analyzing')
    .limit(10);
  
  console.log(`\nAnalyzing videos: ${aing?.length ?? 0}`);
  for (const v of aing ?? []) {
    const mb = v.size_bytes ? Math.round(v.size_bytes/1024/1024) : '?';
    console.log(`  [${mb}MB] ${v.name} id=${v.id} drive=${v.drive_id ? 'yes' : 'NO'} updated=${v.updated_at}`);
  }
}
main().catch(console.error);
