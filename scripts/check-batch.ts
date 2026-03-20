import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  const statuses = ['analyzed', 'analyzing', 'triaged', 'error', 'excluded', 'synced'];
  console.log('=== Video Status Counts ===');
  for (const s of statuses) {
    const r = await supabase.from('videos').select('id', { count: 'exact', head: true }).eq('status', s);
    console.log(`  ${s}: ${r.count ?? 0}`);
  }

  // Get a sample analysis_result to check quality
  console.log('\n=== Sample Analyzed Videos ===');
  const { data: sample } = await supabase
    .from('videos')
    .select('name, analysis_result, analysis_mode')
    .eq('status', 'analyzed')
    .limit(5);

  for (const v of sample ?? []) {
    const r = v.analysis_result as any;
    const prods = r?.products?.length ?? 0;
    const moments = r?.moments?.length ?? 0;
    const desc = (r?.description ?? '').slice(0, 80);
    console.log(`  ${v.name} [${v.analysis_mode}] products=${prods} moments=${moments} desc="${desc}"`);
  }

  // Check 4 still analyzing
  console.log('\n=== Still Analyzing ===');
  const { data: stuck } = await supabase
    .from('videos')
    .select('name, status')
    .eq('status', 'analyzing')
    .limit(10);
  for (const v of stuck ?? []) {
    console.log(`  ${v.name}`);
  }
}

main().catch(console.error);
