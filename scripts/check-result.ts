import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  // First get column names
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('name', 'IMG_7556.MOV')
    .limit(1);

  if (error) {
    console.log('error:', error);
    return;
  }
  if (data && data[0]) {
    const keys = Object.keys(data[0]);
    console.log('Columns:', keys.join(', '));

    // Print all non-null values
    for (const k of keys) {
      const v = (data[0] as any)[k];
      if (v != null) {
        const s = typeof v === 'object' ? JSON.stringify(v).slice(0, 150) : String(v).slice(0, 150);
        console.log(`  ${k}: ${s}`);
      }
    }
  }
}

main().catch(console.error);
