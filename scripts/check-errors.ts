import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';
async function main() {
  const wid = getDefaultWorkspaceId();
  const { data } = await supabase.from('videos')
    .select('name, processing_error, updated_at, size_bytes')
    .eq('workspace_id', wid)
    .eq('status', 'error')
    .order('updated_at', { ascending: false })
    .limit(10);
  console.log(`Total errors: ${data?.length ?? 0}\n`);
  for (const e of data ?? []) {
    const sizeMB = e.size_bytes ? Math.round(e.size_bytes/1024/1024) : '?';
    console.log(`[${sizeMB}MB] ${e.name}`);
    console.log(`  error: ${(e.processing_error ?? 'unknown').slice(0, 200)}`);
    console.log(`  when: ${e.updated_at}\n`);
  }
}
main().catch(console.error);
