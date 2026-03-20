import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';
async function main() {
  const wid = getDefaultWorkspaceId();
  // Get the 10 most recent analyzed videos by indexed_at (not updated_at)
  const { data } = await supabase.from('videos')
    .select('name, size_bytes, analysis_mode, updated_at, indexed_at, status')
    .eq('workspace_id', wid).eq('status', 'analyzed')
    .order('indexed_at', { ascending: false }).limit(10);
  console.log('=== 10 Most Recent by indexed_at ===');
  for (const v of data ?? []) {
    const mb = v.size_bytes ? (v.size_bytes/1024/1024).toFixed(1) : '?';
    console.log(`  ${v.name} | ${mb}MB | mode=${v.analysis_mode} | indexed=${v.indexed_at} | updated=${v.updated_at}`);
  }
}
main().catch(console.error);
