import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';

async function main() {
  const wid = getDefaultWorkspaceId();
  
  // 1. Confirm scan stopped
  const r = await fetch('http://localhost:3001/api/trpc/admin.scanStatus', {
    headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' }
  }).then(r => r.json());
  console.log('Scan status:', r.result?.data?.json?.isScanning ? 'STILL RUNNING' : 'STOPPED');
  
  // 2. Find and reset stale analyzing rows
  const { data: stale, error: staleErr } = await supabase.from('videos')
    .select('id, name, size_bytes, updated_at')
    .eq('workspace_id', wid)
    .eq('status', 'analyzing');
  
  if (staleErr) { console.error('Query error:', staleErr.message); return; }
  
  console.log(`\nStale analyzing rows found: ${stale?.length ?? 0}`);
  for (const v of stale ?? []) {
    const mb = v.size_bytes ? Math.round(v.size_bytes/1024/1024) : '?';
    console.log(`  [${mb}MB] ${v.name} updated=${v.updated_at}`);
  }
  
  if (stale && stale.length > 0) {
    const ids = stale.map(v => v.id);
    const { error: resetErr } = await supabase.from('videos')
      .update({ status: 'reanalysis_needed' })
      .in('id', ids);
    if (resetErr) {
      console.error('Reset error:', resetErr.message);
    } else {
      console.log(`Reset ${ids.length} stale analyzing rows to reanalysis_needed`);
    }
  }
  
  // 3. Baseline counts via pagination (avoids timeout)
  console.log('\n=== BASELINE COUNTS (paginated) ===');
  
  async function paginatedCount(filters: Record<string, string>): Promise<number> {
    let total = 0;
    let from = 0;
    const batchSize = 1000;
    while (true) {
      let q = supabase.from('videos').select('id').eq('workspace_id', wid);
      for (const [k, v] of Object.entries(filters)) {
        q = q.eq(k, v);
      }
      const { data, error } = await q.range(from, from + batchSize - 1);
      if (error) { console.error(`Count error for ${JSON.stringify(filters)}:`, error.message); return -1; }
      if (!data || data.length === 0) break;
      total += data.length;
      if (data.length < batchSize) break;
      from += batchSize;
    }
    return total;
  }
  
  const statuses = ['synced', 'triaged', 'analyzing', 'error', 'excluded', 'reanalysis_needed'];
  for (const s of statuses) {
    const c = await paginatedCount({ status: s });
    console.log(`  ${s}: ${c}`);
  }
  
  // analyzed by mode
  for (const mode of ['full_video', 'thumbnail', 'thumbnail_size_limit']) {
    const c = await paginatedCount({ status: 'analyzed', analysis_mode: mode });
    console.log(`  analyzed/${mode}: ${c}`);
  }
  
  // 4. Check recent completions by indexed_at (the field the scanner actually sets)
  console.log('\n=== RECENT COMPLETIONS (by indexed_at) ===');
  const { data: recent } = await supabase.from('videos')
    .select('name, status, analysis_mode, size_bytes, indexed_at')
    .eq('workspace_id', wid)
    .eq('status', 'analyzed')
    .eq('analysis_mode', 'full_video')
    .not('indexed_at', 'is', null)
    .order('indexed_at', { ascending: false })
    .limit(15);
  
  for (const v of recent ?? []) {
    const mb = v.size_bytes ? Math.round(v.size_bytes/1024/1024) : '?';
    const ago = Math.round((Date.now() - new Date(v.indexed_at).getTime()) / 60000);
    console.log(`  [${mb}MB] ${v.name} indexed ${ago}min ago (${v.indexed_at})`);
  }
  
  // 5. Count full_video completions in recent time windows
  console.log('\n=== COMPLETION WINDOWS ===');
  for (const hours of [1, 4, 12, 24, 48, 168]) {
    const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
    let count = 0;
    let from = 0;
    while (true) {
      const { data } = await supabase.from('videos')
        .select('id')
        .eq('workspace_id', wid)
        .eq('status', 'analyzed')
        .eq('analysis_mode', 'full_video')
        .gte('indexed_at', cutoff)
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      count += data.length;
      if (data.length < 1000) break;
      from += 1000;
    }
    console.log(`  Last ${hours}h: ${count} full_video completions`);
  }
  
  // 6. Error count
  const { data: errors } = await supabase.from('videos')
    .select('name, processing_error, indexed_at')
    .eq('workspace_id', wid)
    .eq('status', 'error');
  console.log(`\n=== ERRORS: ${errors?.length ?? 0} total ===`);
  for (const e of (errors ?? []).slice(0, 5)) {
    console.log(`  ${e.name}: ${(e.processing_error ?? '').slice(0, 100)}`);
  }
}
main().catch(console.error);
