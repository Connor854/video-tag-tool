import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  const { data: analyzing, count: analyzingCount } = await supabase
    .from('videos')
    .select('id, name, duration_seconds, size_bytes', { count: 'exact' })
    .eq('status', 'analyzing');

  const { count: analyzedCount } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'analyzed');

  const { count: triagedCount } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .in('status', ['triaged', 'reanalysis_needed', 'error']);

  console.log('=== Current State ===');
  console.log('Analyzing (in-flight):', analyzingCount);
  if (analyzing?.length) {
    for (const v of analyzing) {
      console.log('  -', v.name, '|', Math.round((v.size_bytes ?? 0) / 1048576) + 'MB', '|', (v.duration_seconds ?? 0) + 's');
    }
  }
  console.log('Analyzed (complete):', analyzedCount);
  console.log('Queued (triaged/error):', triagedCount);
}

main().catch(console.error);
