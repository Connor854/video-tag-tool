import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  // Get all active products with colorways
  const { data: products } = await supabase
    .from('products')
    .select('name, base_product, colorway, category')
    .eq('active', true)
    .not('colorway', 'is', null)
    .order('base_product')
    .order('colorway');

  const grouped: Record<string, Set<string>> = {};
  for (const r of products ?? []) {
    const base = r.base_product ?? r.category ?? 'Unknown';
    if (!grouped[base]) grouped[base] = new Set();
    grouped[base].add(r.colorway);
  }

  console.log('=== PRODUCTS & COLORWAYS ===');
  for (const [base, colors] of Object.entries(grouped).sort()) {
    console.log(base + ':');
    for (const c of [...colors].sort()) {
      console.log('  - ' + c);
    }
  }

  // Get distinct filter values from analyzed videos
  const [scenes, shots, audio, lighting, motion, people, tags] = await Promise.all([
    supabase.from('videos').select('scene').eq('status', 'analyzed').not('scene', 'is', null).limit(1000),
    supabase.from('videos').select('shot_type').eq('status', 'analyzed').not('shot_type', 'is', null).limit(1000),
    supabase.from('videos').select('audio_type').eq('status', 'analyzed').not('audio_type', 'is', null).limit(1000),
    supabase.from('videos').select('lighting').eq('status', 'analyzed').not('lighting', 'is', null).limit(1000),
    supabase.from('videos').select('motion').eq('status', 'analyzed').not('motion', 'is', null).limit(1000),
    supabase.from('videos').select('people_description').eq('status', 'analyzed').not('people_description', 'is', null).limit(1000),
    supabase.from('videos').select('content_tags').eq('status', 'analyzed').not('content_tags', 'is', null).limit(1000),
  ]);

  const distinct = (rows: any[], key: string) => [...new Set(rows.map(r => r[key] as string))].sort();
  const flatTags = [...new Set((tags.data ?? []).flatMap(r => (r.content_tags as string[]) ?? []))].sort();

  console.log('\n=== SCENES ===');
  distinct(scenes.data ?? [], 'scene').forEach(v => console.log('  - ' + v));

  console.log('\n=== SHOT TYPES ===');
  distinct(shots.data ?? [], 'shot_type').forEach(v => console.log('  - ' + v));

  console.log('\n=== AUDIO TYPES ===');
  distinct(audio.data ?? [], 'audio_type').forEach(v => console.log('  - ' + v));

  console.log('\n=== LIGHTING ===');
  distinct(lighting.data ?? [], 'lighting').forEach(v => console.log('  - ' + v));

  console.log('\n=== CAMERA MOTION ===');
  distinct(motion.data ?? [], 'motion').forEach(v => console.log('  - ' + v));

  console.log('\n=== PEOPLE ===');
  distinct(people.data ?? [], 'people_description').forEach(v => console.log('  - ' + v));

  console.log('\n=== CONTENT TAGS ===');
  flatTags.forEach(v => console.log('  - ' + v));
}

main().catch(console.error);
