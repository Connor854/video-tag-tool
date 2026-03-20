import 'dotenv/config';
import { supabase } from './src/lib/supabase.js';
import { getDefaultWorkspaceId } from './src/lib/workspace.js';
async function main() {
  const wid = getDefaultWorkspaceId();
  const { data } = await supabase.from('videos')
    .select('name, size_bytes, updated_at, processing_error')
    .eq('workspace_id', wid)
    .eq('status', 'analyzing')
    .order('updated_at', { ascending: false });
  console.log(`Videos in analyzing: ${data?.length ?? 0}`);
  for (const v of data ?? []) {
    const sizeMB = v.size_bytes ? Math.round(v.size_bytes/1024/1024) : '?';
    const ago = Math.round((Date.now() - new Date(v.updated_at!).getTime()) / 1000);
    console.log(`  [${sizeMB}MB] ${v.name} — started ${ago}s ago ${v.processing_error ? '(error: ' + v.processing_error.slice(0,80) + ')' : ''}`);
  }
  
  // Also check recent errors
  const { data: errors } = await supabase.from('videos')
    .select('name, size_bytes, processing_error, updated_at')
    .eq('workspace_id', wid)
    .eq('status', 'error')
    .order('updated_at', { ascending: false })
    .limit(5);
  console.log(`\nRecent errors:`);
  for (const e of errors ?? []) {
    const ago = Math.round((Date.now() - new Date(e.updated_at!).getTime()) / 1000);
    console.log(`  [${e.size_bytes ? Math.round(e.size_bytes/1024/1024) : '?'}MB] ${e.name} — ${ago}s ago — ${(e.processing_error ?? 'unknown').slice(0,120)}`);
  }
}
main().catch(console.error);
