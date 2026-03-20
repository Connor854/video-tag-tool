import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';

async function main() {
  const wid = getDefaultWorkspaceId();
  
  // Reset any remaining analyzing rows
  const { data: stale } = await supabase.from('videos')
    .select('id, name')
    .eq('workspace_id', wid)
    .eq('status', 'analyzing');
  
  if (stale && stale.length > 0) {
    const ids = stale.map(v => v.id);
    await supabase.from('videos').update({ status: 'reanalysis_needed' }).in('id', ids);
    console.log(`Reset ${ids.length} remaining analyzing rows: ${stale.map(v => v.name).join(', ')}`);
  } else {
    console.log('No stale analyzing rows — clean state');
  }
  
  // Record precise baseline
  console.log('\n=== PRE-VALIDATION BASELINE ===');
  const r = await fetch('http://localhost:3001/api/trpc/admin.pipelineStats', {
    headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' }
  }).then(r => r.json());
  const d = r.result?.data?.json;
  console.log(`analyzed: ${d.counts.analyzed}`);
  console.log(`  full_video: ${d.modes.full_video}`);
  console.log(`reanalysis_needed: ${d.counts.reanalysis_needed}`);
  console.log(`error: ${d.counts.error}`);
  console.log(`analyzing: ${d.counts.analyzing}`);
  console.log(`timestamp: ${new Date().toISOString()}`);
}
main().catch(console.error);
