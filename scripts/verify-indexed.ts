import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';
async function main() {
  const wid = getDefaultWorkspaceId();
  const since = new Date(Date.now() - 3600000).toISOString();
  
  const { data } = await supabase.from('videos')
    .select('name, size_bytes, analysis_mode, indexed_at')
    .eq('workspace_id', wid).eq('status', 'analyzed').eq('analysis_mode', 'full_video')
    .gte('indexed_at', since)
    .order('indexed_at', { ascending: false }).limit(15);

  console.log(`=== Completions in last 1h (by indexed_at) ===`);
  console.log(`Count: ${data?.length ?? 0}`);
  for (const v of data ?? []) {
    const mb = v.size_bytes ? (v.size_bytes/1024/1024).toFixed(1) : '?';
    console.log(`  ${v.name} | ${mb}MB | indexed=${v.indexed_at}`);
  }
}
main().catch(console.error);
