import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';

async function main() {
  const wid = getDefaultWorkspaceId();
  
  // Test 1: simple query
  const { data: d1, error: e1 } = await supabase.from('videos')
    .select('id')
    .eq('workspace_id', wid)
    .eq('status', 'error')
    .range(0, 999);
  console.log('error status - data:', d1?.length, 'error:', e1?.message);
  
  // Test 2: reanalysis_needed
  const { data: d2, error: e2 } = await supabase.from('videos')
    .select('id')
    .eq('workspace_id', wid)
    .eq('status', 'reanalysis_needed')
    .range(0, 999);
  console.log('reanalysis_needed - data:', d2?.length, 'error:', e2?.message);
  
  // Test 3: analyzed full_video
  const { data: d3, error: e3 } = await supabase.from('videos')
    .select('id')
    .eq('workspace_id', wid)
    .eq('status', 'analyzed')
    .eq('analysis_mode', 'full_video')
    .range(0, 999);
  console.log('analyzed/full_video first 1000 - data:', d3?.length, 'error:', e3?.message);
}
main().catch(console.error);
