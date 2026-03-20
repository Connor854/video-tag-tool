import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  const { data } = await supabase
    .from('products')
    .select('base_product, category, colorway, active')
    .not('colorway', 'is', null);

  const bases = new Map<string, { active: number; inactive: number; colorways: Set<string> }>();
  for (const r of data ?? []) {
    const key = `${r.base_product} | ${r.category}`;
    if (!bases.has(key)) bases.set(key, { active: 0, inactive: 0, colorways: new Set() });
    const entry = bases.get(key)!;
    if (r.active) entry.active++; else entry.inactive++;
    entry.colorways.add(r.colorway);
  }

  for (const [k, v] of [...bases.entries()].sort()) {
    const cws = [...v.colorways].sort();
    console.log(`${k}: ${v.active} active, ${v.inactive} inactive`);
    console.log(`  Colorways: ${cws.join(', ')}`);
  }
}

main().catch(console.error);
