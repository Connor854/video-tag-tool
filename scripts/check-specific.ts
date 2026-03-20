import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';

async function main() {
  const wid = getDefaultWorkspaceId();
  
  // Get first few reanalysis_needed videos 
  const { data: queue } = await supabase.from('videos')
    .select('id, name, status, size_bytes')
    .eq('workspace_id', wid)
    .eq('status', 'reanalysis_needed')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(5);
  
  console.log('Front of queue (reanalysis_needed):');
  for (const v of queue ?? []) {
    console.log(`  ${v.name} [${Math.round((v.size_bytes??0)/1024/1024)}MB] id=${v.id}`);
  }
  
  // Check videos by name that were shown in scan progress
  const names = ['IMG_4481.MOV', 'IMG_4483.MOV', 'IMG_4241.MOV', 'IMG_4435.MOV', 'IMG_4525.MOV', 'IMG_4448.MOV', 'IMG_4450.MOV', 'IMG_4482.MOV'];
  console.log('\n--- Status of videos seen in scan progress ---');
  for (const name of names) {
    const { data } = await supabase.from('videos')
      .select('name, status, analysis_mode, updated_at, processing_error')
      .eq('workspace_id', wid)
      .eq('name', name);
    for (const v of data ?? []) {
      console.log(`  ${v.name}: status=${v.status} mode=${v.analysis_mode ?? '-'} updated=${v.updated_at}`);
      if (v.processing_error) console.log(`    error: ${v.processing_error.slice(0, 150)}`);
    }
  }
}
main().catch(console.error);
