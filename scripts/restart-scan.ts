import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';

async function main() {
  const wid = getDefaultWorkspaceId();
  
  // Reset any stale analyzing rows from killed scan
  const { data: stale } = await supabase.from('videos')
    .select('id, name')
    .eq('workspace_id', wid)
    .eq('status', 'analyzing');
  
  if (stale && stale.length > 0) {
    await supabase.from('videos').update({ status: 'reanalysis_needed' }).in('id', stale.map(v => v.id));
    console.log(`Reset ${stale.length} analyzing rows from killed scan`);
  }
  
  // Get baseline from the now-fixed endpoint
  const r = await fetch('http://localhost:3001/api/trpc/admin.pipelineStats', {
    headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' }
  }).then(r => r.json());
  const d = r.result?.data?.json;
  console.log('\n=== POST-FIX BASELINE ===');
  console.log(`analyzed: ${d.counts.analyzed} (fv=${d.modes.full_video})`);
  console.log(`reanalysis_needed: ${d.counts.reanalysis_needed}`);
  console.log(`error: ${d.counts.error}`);
  console.log(`analyzing: ${d.counts.analyzing}`);
  console.log(`throughput: ${d.throughputPerHour}/hr`);
  console.log(`timestamp: ${new Date().toISOString()}`);
  
  // Start 4-worker scan
  const start = await fetch('http://localhost:3001/api/trpc/admin.startScan', {
    method: 'POST',
    headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: { workers: 4, queueOnly: true } }),
  }).then(r => r.json());
  console.log('\nScan start:', start.result?.data?.json);
  
  // Wait 10s and confirm
  await new Promise(r => setTimeout(r, 10000));
  const status = await fetch('http://localhost:3001/api/trpc/admin.scanStatus', {
    headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' }
  }).then(r => r.json());
  const s = status.result?.data?.json;
  console.log(`Scan confirmed: scanning=${s.isScanning} progress=${s.progress}/${s.total} file=${s.currentFile}`);
}
main().catch(console.error);
