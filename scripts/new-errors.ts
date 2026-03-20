import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';

async function main() {
  const wid = getDefaultWorkspaceId();
  
  // Get ALL error videos (should be small count)
  const { data, error } = await supabase.from('videos')
    .select('name, processing_error, updated_at, size_bytes')
    .eq('workspace_id', wid)
    .eq('status', 'error');
  
  if (error) { console.error('Query error:', error.message); return; }
  console.log(`Total error videos: ${data?.length ?? 0}`);
  
  // Sort by updated_at descending
  const sorted = (data ?? []).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  
  for (const v of sorted) {
    const mb = v.size_bytes ? Math.round(v.size_bytes/1024/1024) : '?';
    const when = new Date(v.updated_at);
    console.log(`  [${mb}MB] ${v.name} at ${v.updated_at}`);
    console.log(`    ${(v.processing_error ?? '').slice(0, 150)}`);
  }
}
main().catch(console.error);
