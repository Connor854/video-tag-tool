import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';

async function main() {
  const wid = getDefaultWorkspaceId();

  const { data: recent } = await supabase.from('videos')
    .select('name, size_bytes, analysis_mode, updated_at, indexed_at, status')
    .eq('workspace_id', wid).eq('status', 'analyzed').eq('analysis_mode', 'full_video')
    .order('updated_at', { ascending: false }).limit(10);

  console.log('=== 10 Most Recent full_video Completions ===');
  for (const v of recent ?? []) {
    const mb = v.size_bytes ? (v.size_bytes / 1024 / 1024).toFixed(1) : '?';
    console.log(`  ${v.name} | ${mb}MB | updated=${v.updated_at} | indexed=${v.indexed_at}`);
  }

  const { data: stale, count: staleCount } = await supabase.from('videos')
    .select('name, size_bytes, updated_at, status, analysis_mode', { count: 'exact' })
    .eq('workspace_id', wid).eq('status', 'analyzing')
    .order('updated_at', { ascending: true }).limit(10);

  console.log(`\n=== Stuck in 'analyzing' (total: ${staleCount}) ===`);
  for (const v of stale ?? []) {
    const mb = v.size_bytes ? (v.size_bytes / 1024 / 1024).toFixed(1) : '?';
    const age = Math.round((Date.now() - new Date(v.updated_at).getTime()) / 60000);
    console.log(`  ${v.name} | ${mb}MB | updated=${v.updated_at} | age=${age}min`);
  }

  const { data: errors } = await supabase.from('videos')
    .select('name, size_bytes, processing_error, updated_at')
    .eq('workspace_id', wid).eq('status', 'error')
    .order('updated_at', { ascending: false }).limit(5);

  console.log('\n=== Recent Errors (sample of 5) ===');
  for (const e of errors ?? []) {
    const mb = e.size_bytes ? (e.size_bytes / 1024 / 1024).toFixed(1) : '?';
    console.log(`  ${e.name} | ${mb}MB | ${(e.processing_error ?? '').slice(0, 120)} | ${e.updated_at}`);
  }
}
main().catch(console.error);
