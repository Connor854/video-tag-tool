import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';

async function main() {
  const wid = getDefaultWorkspaceId();
  
  // Get the most recently updated analyzed videos (no time filter)
  const { data: recent } = await supabase.from('videos')
    .select('name, status, analysis_mode, size_bytes, updated_at, created_at')
    .eq('workspace_id', wid)
    .eq('status', 'analyzed')
    .order('updated_at', { ascending: false })
    .limit(10);
  
  console.log('--- 10 Most Recent Analyzed Videos ---');
  for (const v of recent ?? []) {
    const mb = v.size_bytes ? Math.round(v.size_bytes/1024/1024) : '?';
    console.log(`  [${mb}MB] mode=${v.analysis_mode} ${v.name}`);
    console.log(`    updated: ${v.updated_at}`);
  }
  
  // Check if scan has any worker heartbeat data
  // Look at videos that transitioned from reanalysis_needed recently
  const { data: recentAny } = await supabase.from('videos')
    .select('name, status, analysis_mode, size_bytes, updated_at')
    .eq('workspace_id', wid)
    .in('status', ['analyzed', 'error', 'analyzing'])
    .order('updated_at', { ascending: false })
    .limit(15);
  
  console.log('\n--- 15 Most Recent analyzed/error/analyzing ---');
  for (const v of recentAny ?? []) {
    const mb = v.size_bytes ? Math.round(v.size_bytes/1024/1024) : '?';
    const ago = Math.round((Date.now() - new Date(v.updated_at).getTime()) / 1000);
    console.log(`  [${mb}MB] ${v.status}/${v.analysis_mode ?? '-'} ${v.name} — ${ago}s ago`);
  }
  
  // Check if the worker count is correct
  console.log('\n--- Scan progress snapshot ---');
  const t1 = Date.now();
  // Wait 10 seconds and check progress delta
  const r1 = await fetch('http://localhost:3001/api/trpc/admin.scanStatus', {
    headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' }
  }).then(r => r.json());
  const p1 = r1.result?.data?.json?.progress ?? 0;
  console.log(`Progress at t=0: ${p1}`);
  
  await new Promise(r => setTimeout(r, 10000));
  
  const r2 = await fetch('http://localhost:3001/api/trpc/admin.scanStatus', {
    headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' }
  }).then(r => r.json());
  const p2 = r2.result?.data?.json?.progress ?? 0;
  const elapsed = (Date.now() - t1) / 1000;
  console.log(`Progress at t=${elapsed.toFixed(0)}s: ${p2}`);
  console.log(`Delta: ${p2 - p1} videos in ${elapsed.toFixed(0)}s`);
  if (p2 > p1) {
    const rate = (p2 - p1) / elapsed * 3600;
    console.log(`Throughput: ~${Math.round(rate)} videos/hour`);
  }
}
main().catch(console.error);
