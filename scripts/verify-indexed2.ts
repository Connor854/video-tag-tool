import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';
async function main() {
  const wid = getDefaultWorkspaceId();
  
  // Just get latest indexed_at values
  const { data } = await supabase.from('videos')
    .select('name, size_bytes, indexed_at, status, analysis_mode')
    .eq('workspace_id', wid).eq('status', 'analyzed')
    .not('indexed_at', 'is', null)
    .order('indexed_at', { ascending: false }).limit(10);

  console.log(`=== Latest indexed_at values ===`);
  for (const v of data ?? []) {
    const mb = v.size_bytes ? (v.size_bytes/1024/1024).toFixed(1) : '?';
    console.log(`  ${v.name} | ${mb}MB | mode=${v.analysis_mode} | indexed=${v.indexed_at}`);
  }

  // What time is it from the DB perspective
  console.log(`\nLocal now: ${new Date().toISOString()}`);
}
main().catch(console.error);
