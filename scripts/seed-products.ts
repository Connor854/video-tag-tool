/**
 * Seed the Supabase `products` table from data/nakie-products.json.
 *
 * Usage:
 *   npx tsx scripts/seed-products.ts
 *
 * Requires SUPABASE_URL and SUPABASE_ANON_KEY in .env
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const supabaseUrl = process.env['SUPABASE_URL'];
const supabaseKey = process.env['SUPABASE_ANON_KEY'];

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface ProductEntry {
  name: string;
  price: string;
  tags: string[];
}

interface CategoryEntry {
  name: string;
  products: ProductEntry[];
}

interface ProductData {
  categories: Record<string, CategoryEntry>;
  colorPalette: string[];
  nrlTeams: string[];
}

// Parse "Forest Green - Recycled Hammock with Straps" into colorway + base product
function parseProductName(fullName: string): { baseProduct: string; colorway: string | null } {
  const dashIndex = fullName.indexOf(' - ');
  if (dashIndex === -1) {
    return { baseProduct: fullName, colorway: null };
  }
  return {
    colorway: fullName.substring(0, dashIndex),
    baseProduct: fullName.substring(dashIndex + 3),
  };
}

async function main() {
  const dataPath = join(__dirname, '..', 'data', 'nakie-products.json');
  const data: ProductData = JSON.parse(readFileSync(dataPath, 'utf-8'));

  const rows: Array<{
    name: string;
    base_product: string;
    category: string;
    colorway: string | null;
    price: string;
    tags: string[];
  }> = [];

  for (const [, cat] of Object.entries(data.categories)) {
    for (const product of cat.products) {
      const { baseProduct, colorway } = parseProductName(product.name);
      rows.push({
        name: product.name,
        base_product: baseProduct,
        category: cat.name,
        colorway,
        price: product.price,
        tags: product.tags,
      });
    }
  }

  console.log(`Seeding ${rows.length} products into Supabase...`);

  // Upsert in batches of 50
  const BATCH_SIZE = 50;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('products').upsert(batch, {
      onConflict: 'name',
    });

    if (error) {
      console.error(`Batch ${i / BATCH_SIZE + 1} error:`, error);
      errors += batch.length;
    } else {
      inserted += batch.length;
    }
  }

  console.log(`Done. Inserted/updated: ${inserted}, Errors: ${errors}`);

  // Verify
  const { count } = await supabase.from('products').select('*', { count: 'exact', head: true });
  console.log(`Total products in table: ${count}`);
}

main().catch(console.error);
