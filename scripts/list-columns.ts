import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('status', 'analyzed')
    .limit(1);
  if (error) { console.error(error); return; }
  if (data && data[0]) {
    const cols = Object.keys(data[0]).sort();
    console.log(`${cols.length} columns:`);
    for (const c of cols) {
      const val = data[0][c];
      const type = val === null ? 'null' : Array.isArray(val) ? 'array' : typeof val;
      const preview = val === null ? 'null' :
        Array.isArray(val) ? `[${val.length}]` :
        typeof val === 'string' ? `"${val.slice(0, 80)}"` :
        String(val);
      console.log(`  ${c} (${type}): ${preview}`);
    }
  }
}

main().catch(console.error);
