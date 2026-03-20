import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'nakie.db');
const db = new Database(DB_PATH);

// Product name mapping
const PRODUCT_MAP: Record<string, string> = {
  'hammock': 'Recycled Hammock with Straps',
  'hanging': 'Recycled Hammock with Straps',
  'beach towel': 'Recycled Sand Free Beach Towel',
  'sand free towel': 'Recycled Sand Free Beach Towel',
  'towel': 'Recycled Sand Free Beach Towel',
  'picnic blanket': 'Recycled Picnic Blanket',
  'picnic': 'Recycled Picnic Blanket',
  'puffy blanket': 'Recycled Puffy Blanket',
  'puffy': 'Recycled Puffy Blanket',
  'blanket': 'Recycled Puffy Blanket',
  'hooded towel': 'Hooded Towel Recycled Sand Free',
  'hooded': 'Hooded Towel Recycled Sand Free',
  'tote bag': 'Tote Bag',
  'tote': 'Tote Bag',
  'gym bag': 'Tote Bag',
  'straps': 'Hammock Straps',
  'carabiners': 'Carabiners',
  'bug net': 'Bug Net',
  'toiletry': 'Toiletry Bag',
};

// Colour mapping
const COLOR_MAP: Record<string, string> = {
  'purple': 'Mulberry Purple', 'violet': 'Mulberry Purple', 'mulberry': 'Mulberry Purple',
  'blue': 'River Blue', 'light blue': 'Sky Blue', 'sky blue': 'Sky Blue',
  'green': 'Forest Green', 'olive': 'Olive Green', 'lime': 'Olive Green',
  'red': 'Merlot Red', 'burgundy': 'Merlot Red',
  'orange': 'Sunburnt Orange', 'coral': 'Sunburnt Orange',
  'yellow': 'Golden Mango', 'gold': 'Golden Mango', 'mustard': 'Golden Mango',
  'pink': 'Rosy Tides', 'rose': 'Rosy Tides',
  'rainbow': 'Kasey Rainbow', 'colorful': 'Kasey Rainbow', 'multi': 'Kasey Rainbow',
  'striped': 'Twilight Blue', 'black': 'Twilight Blue', 'grey': 'Twilight Blue', 'gray': 'Twilight Blue',
  'cricket': 'Cricket Australia',
};

// Nakie colours
const NAKIE_COLORS = ['River Blue', 'Forest Green', 'Mulberry Purple', 'Golden Mango', 'Kasey Rainbow',
  'Sky Blue', 'Olive Green', 'Merlot Red', 'Wild Fiesta', 'Charlotte Wensley',
  'Sunburnt Orange', 'Twilight Blue', 'Retro Shores', 'Ocean Breeze', 'Sound of Summer', 
  'Holiday Dreams', 'Salty Waves', 'Rosy Tides', 'Daintree Green', 'Happy Days'];

function findColor(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  
  for (const color of NAKIE_COLORS) {
    if (lower.includes(color.toLowerCase())) return color;
  }
  for (const [key, nakieColor] of Object.entries(COLOR_MAP)) {
    if (lower.includes(key)) return nakieColor;
  }
  return null;
}

function findProduct(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [key, product] of Object.entries(PRODUCT_MAP)) {
    if (lower.includes(key)) return product;
  }
  return null;
}

// Parse color pattern like "Hammock: purple; Picnic Blanket: blue, white, and orange..."
function parseColorPattern(colorPattern: string): { product: string; color: string }[] {
  if (!colorPattern) return [];
  
  const results: { product: string; color: string }[] = [];
  
  // Split by semicolon to get each product:color pair
  const parts = colorPattern.split(';');
  
  for (const part of parts) {
    const product = findProduct(part);
    const color = findColor(part);
    
    if (product && color) {
      results.push({ product, color });
    }
  }
  
  return results;
}

function mapProducts(products: string[], description: string, actionIntent: string, colorPattern: string): string[] {
  const allText = [...products, description || '', actionIntent || ''].join(' ');
  const result: string[] = [];
  
  // First, try to parse color pattern for specific product:colour pairs
  const parsedProducts = parseColorPattern(colorPattern);
  
  if (parsedProducts.length > 0) {
    // Use the parsed product:colour pairs
    for (const { product, color } of parsedProducts) {
      result.push(`${color} - ${product}`);
    }
  } else {
    // Fallback: just find primary product and colour
    const product = findProduct(allText);
    const color = findColor(colorPattern || allText);
    
    if (product && color) {
      result.push(`${color} - ${product}`);
    } else if (product) {
      result.push(product);
    } else if (color) {
      result.push(`${color} - Recycled Hammock with Straps`);
    }
  }
  
  return result;
}

function main() {
  console.log('🔄 Mapping to ACTUAL products in each video...\n');

  const videos = db.prepare('SELECT id, products, description, action_intent, product_color_pattern FROM videos').all() as any[];
  
  let updated = 0;
  const updateStmt = db.prepare('UPDATE videos SET products = ? WHERE id = ?');

  for (const video of videos) {
    let products: string[] = [];
    try {
      products = video.products ? JSON.parse(video.products) : [];
    } catch {
      products = [];
    }

    const mappedProducts = mapProducts(
      products, 
      video.description || '', 
      video.action_intent || '', 
      video.product_color_pattern || ''
    );

    if (mappedProducts.length > 0) {
      updateStmt.run(JSON.stringify(mappedProducts), video.id);
      updated++;

      if (updated <= 10) {
        console.log(`Video ${video.id}:`);
        console.log(`  Pattern: ${video.product_color_pattern}`);
        console.log(`  → ${mappedProducts.join(', ')}`);
        console.log();
      }
    }
  }

  console.log(`\n✅ Updated ${updated} videos!`);
}

main();
