import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';

async function main() {
  const wid = getDefaultWorkspaceId();
  
  // Check with explicit error handling
  const { data, error } = await supabase.from('videos')
    .select('name, status, analysis_mode, size_bytes, updated_at')
    .eq('workspace_id', wid)
    .eq('status', 'analyzed')
    .order('updated_at', { ascending: false })
    .limit(5);
  
  console.log('Error:', error);
  console.log('Data length:', data?.length);
  console.log('Data:', JSON.stringify(data?.slice(0, 3), null, 2));
  
  // Try without order (maybe the index is the issue)
  const { data: d2, error: e2 } = await supabase.from('videos')
    .select('name, status, updated_at')
    .eq('workspace_id', wid)
    .eq('status', 'analyzed')
    .limit(3);
  
  console.log('\nWithout order - Error:', e2);
  console.log('Without order - Data:', JSON.stringify(d2, null, 2));
  
  // Check total videos
  const { data: d3 } = await supabase.from('videos')
    .select('status')
    .eq('workspace_id', wid)
    .limit(1);
  console.log('\nAny video:', JSON.stringify(d3, null, 2));
  
  // Check server process memory
  const { execSync } = await import('child_process');
  const mem = execSync('ps -o pid,rss,vsz,%mem,%cpu,command -p $(pgrep -f "server/index.ts" | head -1) 2>/dev/null || echo "No server process"').toString();
  console.log('\nServer process:', mem);
}
main().catch(console.error);
