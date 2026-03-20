import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';

async function main() {
  const wid = getDefaultWorkspaceId();
  console.log('workspace_id:', wid);

  for (const status of ['synced','triaged','analyzing','analyzed','excluded','error','reanalysis_needed']) {
    const { count, error } = await supabase.from('videos')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', wid)
      .eq('status', status);
    console.log(`  ${status}: ${count ?? 'ERROR: ' + error?.message}`);
  }

  console.log('\nModes (analyzed only):');
  for (const mode of ['full_video','thumbnail','thumbnail_size_limit']) {
    const { count } = await supabase.from('videos')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', wid)
      .eq('status', 'analyzed')
      .eq('analysis_mode', mode);
    console.log(`  ${mode}: ${count}`);
  }
}
main().catch(console.error);
