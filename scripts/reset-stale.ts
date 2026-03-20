import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';
async function main() {
  const wid = getDefaultWorkspaceId();
  const { data, error } = await supabase.from('videos')
    .update({ status: 'reanalysis_needed' })
    .eq('workspace_id', wid)
    .eq('status', 'analyzing')
    .select('id, name');
  if (error) { console.error('ERROR:', error.message); return; }
  console.log(`Reset ${data.length} rows:`);
  for (const v of data) console.log(`  ${v.name}`);
}
main().catch(console.error);
