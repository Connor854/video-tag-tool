import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  // Get 5 full_video analyzed videos with empty products
  const { data: all } = await supabase
    .from('videos')
    .select('id, products, analysis_mode')
    .eq('status', 'analyzed')
    .limit(200);

  const fullNoProduct = (all ?? []).filter(v => {
    const mode = String(v.analysis_mode ?? '');
    const hasProd = v.products && Array.isArray(v.products) && v.products.length > 0;
    return mode.includes('full_video') && !hasProd;
  });

  console.log(`Full_video no-product in first 200: ${fullNoProduct.length}`);

  if (fullNoProduct.length === 0) return;

  // Fetch description for first 3 using .eq('id', ...)
  for (const v of fullNoProduct.slice(0, 5)) {
    const { data, error } = await supabase
      .from('videos')
      .select('id, name, description, scene, content_tags, products, analysis_mode')
      .eq('id', v.id)
      .single();
    if (error) {
      console.log(`Error for ${v.id}: ${error.message}`);
      continue;
    }
    console.log(`\nID: ${data.id}`);
    console.log(`Name: ${data.name}`);
    console.log(`Mode: ${data.analysis_mode}`);
    console.log(`Products: ${JSON.stringify(data.products)}`);
    console.log(`Description: ${(data.description ?? '(null)').slice(0, 300)}`);
    console.log(`Scene: ${data.scene}`);
    console.log(`Tags: ${JSON.stringify(data.content_tags)}`);
  }

  // Also try the .in() query with a small set
  const ids = fullNoProduct.slice(0, 3).map(v => v.id);
  console.log(`\n--- Testing .in() with ${ids.length} IDs ---`);
  const { data: inData, error: inErr } = await supabase
    .from('videos')
    .select('id, name, description')
    .in('id', ids);
  console.log(`Result: ${inData?.length ?? 0} rows, error: ${inErr?.message ?? 'none'}`);
  if (inData) {
    for (const r of inData) {
      console.log(`  ${r.id}: "${(r.description ?? '').slice(0, 100)}"`);
    }
  }
}

main().catch(console.error);
