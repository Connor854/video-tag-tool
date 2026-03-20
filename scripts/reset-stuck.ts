import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';
import { getWorkspaceCredentials } from '../src/lib/workspace.js';
import { analyzeOneVideo } from '../src/services/scanner.js';

async function main() {
  const mode = process.argv[2];

  if (mode === 'test-one') {
    // Test a single video analysis
    const wid = getDefaultWorkspaceId();
    const creds = await getWorkspaceCredentials(wid);
    console.log('Workspace:', wid);
    console.log('Has Google key:', !!creds.googleServiceAccountKey);
    console.log('Has Gemini key:', !!creds.geminiApiKey);

    // Get a small reanalysis_needed video
    const { data: videos } = await supabase
      .from('videos')
      .select('id, drive_id, name, size_bytes')
      .eq('workspace_id', wid)
      .eq('status', 'reanalysis_needed')
      .not('drive_id', 'is', null)
      .order('size_bytes', { ascending: true })
      .limit(1);

    if (!videos?.length) { console.log('No eligible videos'); return; }
    const v = videos[0];
    console.log(`\nTest video: ${v.name} (${Math.round(v.size_bytes/1024/1024)}MB) drive=${v.drive_id}`);

    const start = Date.now();
    try {
      const ok = await analyzeOneVideo(wid, v.id, v.drive_id, v.name, v.size_bytes, creds.googleServiceAccountKey!, creds.geminiApiKey!);
      console.log(`\nResult: ${ok ? 'SUCCESS' : 'FAILED'} in ${((Date.now()-start)/1000).toFixed(1)}s`);
    } catch (err) {
      console.error(`\nCRASHED in ${((Date.now()-start)/1000).toFixed(1)}s:`, err);
    }

    // Check final state
    const { data: final } = await supabase.from('videos').select('status, analysis_mode, products, processing_error').eq('id', v.id).single();
    console.log('Final state:', JSON.stringify(final, null, 2));
    return;
  }

  // Default: reset stuck analyzing videos
  const wid = getDefaultWorkspaceId();
  const { data, error } = await supabase
    .from('videos')
    .update({ status: 'reanalysis_needed' })
    .eq('workspace_id', wid)
    .eq('status', 'analyzing')
    .select('id, name');
  if (error) { console.error(error); return; }
  console.log(`Reset ${data?.length ?? 0} stuck analyzing videos:`);
  for (const v of data ?? []) console.log(`  ${v.name}`);
}
main().catch(console.error);
