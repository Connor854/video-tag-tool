import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'nakie.db');
const db = new Database(DB_PATH);

// Product mapping: AI tag -> Nakie product name
const PRODUCT_MAPPING: Record<string, string[]> = {
  'hammock': ['Recycled Hammock with Straps'],
  'hammocks': ['Recycled Hammock with Straps'],
  'beach towel': ['Recycled Sand Free Beach Towel'],
  'beach towels': ['Recycled Sand Free Beach Towel'],
  'towel': ['Recycled Sand Free Beach Towel'],
  'towels': ['Recycled Sand Free Beach Towel'],
  'sand free towel': ['Recycled Sand Free Beach Towel'],
  'picnic blanket': ['Recycled Picnic Blanket'],
  'picnic': ['Recycled Picnic Blanket'],
  'blanket': ['Recycled Puffy Blanket', 'Recycled Picnic Blanket'],
  'puffy blanket': ['Recycled Puffy Blanket'],
  'puffy': ['Recycled Puffy Blanket'],
  'hooded towel': ['Hooded Towel Recycled Sand Free'],
  'tote bag': ['Tote Bag'],
  'tote': ['Tote Bag'],
  'gym bag': ['Tote Bag'],
  'gym towel': ['Recycled Gym Towel - Mystery Colour'],
  'toiletry bag': ['Toiletry Bag'],
  'hammock straps': ['Hammock Straps'],
  'straps': ['Hammock Straps'],
  'carabiners': ['Carabiners'],
  'bug net': ['Bug Net'],
  'rain tarp': ['Rain Tarp'],
};

// Colors to look for
const COLORS = [
  'River Blue', 'Forest Green', 'Mulberry Purple', 'Golden Mango', 'Kasey Rainbow',
  'Sky Blue', 'Olive Green', 'Merlot Red', 'Wild Fiesta', 'Charlotte Wensley',
  'Sunburnt Orange', 'Twilight Blue', 'Retro Shores', 'Ocean Breeze',
  'Underwater Magic', 'Sound of Summer', 'Holiday Dreams', 'Salty Waves', 'Rosy Tides',
  'Toucan Bay', 'Daintree Green', 'Happy Days', 'Starry Nights', 'Floating Lotus',
  'Autumn Leaves', 'Turkish Delight'
];

function mapProductsToNakie(products: string[], description: string, actionIntent: string): string[] {
  const allText = [
    ...products,
    description || '',
    actionIntent || ''
  ].join(' ').toLowerCase();

  const foundProducts: string[] = [];

  // Map from product mapping
  for (const [key, nakieProducts] of Object.entries(PRODUCT_MAPPING)) {
    if (allText.includes(key)) {
      foundProducts.push(...nakieProducts);
    }
  }

  // Check for colors + product type combinations
  for (const color of COLORS) {
    if (allText.includes(color.toLowerCase())) {
      if (allText.includes('hammock')) {
        foundProducts.push(`${color} - Recycled Hammock with Straps`);
      } else if (allText.includes('towel')) {
        foundProducts.push(`${color} - Recycled Sand Free Beach Towel`);
      } else if (allText.includes('picnic') || allText.includes('blanket')) {
        foundProducts.push(`${color} - Recycled Picnic Blanket`);
      }
    }
  }

  // If we found products with colors, use those. Otherwise use mapped products
  const colorProducts = foundProducts.filter(p => COLORS.some(c => p.startsWith(c)));
  
  if (colorProducts.length > 0) {
    return [...new Set(colorProducts)];
  }
  
  return [...new Set(foundProducts)];
}

function main() {
  console.log('🔄 Mapping video tags to Nakie product names...\n');

  const videos = db.prepare('SELECT id, products, description, action_intent FROM videos').all() as any[];
  
  let updated = 0;
  const updateStmt = db.prepare('UPDATE videos SET products = ? WHERE id = ?');

  for (const video of videos) {
    let products: string[] = [];
    
    try {
      products = video.products ? JSON.parse(video.products) : [];
    } catch {
      products = [];
    }

    const mappedProducts = mapProductsToNakie(products, video.description, video.action_intent);

    if (mappedProducts.length > 0) {
      updateStmt.run(JSON.stringify(mappedProducts), video.id);
      updated++;

      if (updated <= 5) {
        console.log(`Video ${video.id}: ${mappedProducts.join(', ')}`);
      }
    }
  }

  console.log(`\n✅ Updated ${updated} videos with proper product names!`);
}

main();
