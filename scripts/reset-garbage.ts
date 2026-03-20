/**
 * Reset garbage "analyzed" rows from the failed overnight batch back to "triaged".
 *
 * Criteria for garbage rows:
 *   - status = 'analyzed' AND analysis_mode = 'thumbnail' AND summary = 'Video from the Nakie collection.'
 *   - These are DEFAULT_RESULT writes from the silently-failing thumbnail fallback
 *
 * Also resets any rows stuck in 'analyzing' (orphaned when batch was killed).
 *
 * Clears: status → triaged, summary, all analysis fields, indexed_at, analysis_mode
 * Preserves: triage_result, priority, drive_path (triage data is still valid)
 */
import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

const PAGE_SIZE = 500;

async function main() {
  // 1. Reset garbage "analyzed" rows in batches (Supabase update affects max 1000 rows)
  let totalReset = 0;

  while (true) {
    // Find a batch of garbage rows
    const { data: batch, error: fetchErr } = await supabase
      .from('videos')
      .select('id')
      .eq('status', 'analyzed')
      .eq('analysis_mode', 'thumbnail')
      .eq('summary', 'Video from the Nakie collection.')
      .limit(PAGE_SIZE);

    if (fetchErr) {
      console.error('Fetch error:', fetchErr);
      break;
    }

    if (!batch || batch.length === 0) break;

    const ids = batch.map(v => v.id);

    const { error: updateErr } = await supabase
      .from('videos')
      .update({
        status: 'triaged',
        summary: null,
        action_intent: null,
        key_moments: null,
        products: null,
        best_use: null,
        scene: null,
        shot_type: null,
        motion: null,
        lighting: null,
        audio_type: null,
        people_count: null,
        people_description: null,
        brand_logo_visible: null,
        brand_packaging_visible: null,
        brand_colors: null,
        colors: null,
        mood: null,
        confidence_products: null,
        confidence_scene: null,
        confidence_action: null,
        confidence_people: null,
        input_tokens: null,
        output_tokens: null,
        indexed_at: null,
        content_tags: null,
        transcript: null,
        analysis_mode: null,
      })
      .in('id', ids);

    if (updateErr) {
      console.error('Update error:', updateErr);
      break;
    }

    totalReset += ids.length;
    console.log(`  Reset ${totalReset} garbage rows so far...`);
  }

  console.log(`\nTotal garbage "analyzed" → "triaged": ${totalReset}`);

  // 2. Reset stuck "analyzing" rows (orphaned by killed batch)
  const { data: stuck } = await supabase
    .from('videos')
    .select('id')
    .eq('status', 'analyzing');

  if (stuck && stuck.length > 0) {
    const { error: stuckErr } = await supabase
      .from('videos')
      .update({
        status: 'triaged',
        summary: null,
        analysis_mode: null,
        indexed_at: null,
      })
      .in('id', stuck.map(v => v.id));

    if (stuckErr) {
      console.error('Stuck reset error:', stuckErr);
    } else {
      console.log(`Reset ${stuck.length} stuck "analyzing" → "triaged"`);
    }
  }

  // 3. Verify final counts
  console.log('\n=== Post-Reset Status Counts ===');
  for (const s of ['analyzed', 'analyzing', 'triaged', 'error', 'excluded', 'synced']) {
    const r = await supabase.from('videos').select('id', { count: 'exact', head: true }).eq('status', s);
    console.log(`  ${s}: ${r.count ?? 0}`);
  }
}

main().catch(console.error);
