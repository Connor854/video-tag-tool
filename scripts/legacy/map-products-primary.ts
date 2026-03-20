import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'nakie.db');
const db = new Database(DB_PATH);

// Product types - map keywords to the correct product
const PRODUCT_MAP: Record<string, string> = {
  // Hammock variations
  'hammock': 'Recycled Hammock with Straps',
  'hanging': 'Recycled Hammock with Straps',
  
  // Beach Towel variations
  'beach towel': 'Recycled Sand Free Beach Towel',
  'sand free towel': 'Recycled Sand Free Beach Towel',
  'towel': 'Recycled Sand Free Beach Towel',
  
  // Picnic Blanket
  'picnic blanket': 'Recycled Picnic Blanket',
  'picnic': 'Recycled Picnic Blanket',
  
  // Puffy Blanket
  'puffy blanket': 'Recycled Puffy Blanket',
  'puffy': 'Recycled Puffy Blanket',
  'blanket': 'Recycled Puffy Blanket',
  
  // Hooded Towel
  'hooded towel': 'Hooded Towel Recycled Sand Free',
  'hooded': 'Hooded Towel Recycled Sand Free',
  
  // Tote Bag
  'tote bag': 'Tote Bag',
  'tote': 'Tote Bag',
  'gym bag': 'Tote Bag',
  
  // Other
  'straps': 'Hammock Straps',
  'carabiners': 'Carabiners',
  'bug net': 'Bug Net',
  'toiletry': 'Toiletry Bag',
};

// Primary colour mapping - map generic colours to Nakie colours
const COLOR_MAP: Record<string, string> = {
  'purple': 'Mulberry Purple',
  'violet': 'Mulberry Purple',
  'mulberry': 'Mulberry Purple',
  
  'blue': 'River Blue',
  'light blue': 'Sky Blue',
  'sky blue': 'Sky Blue',
  
  'green': 'Forest Green',
  'olive': 'Olive Green',
  'lime': 'Olive Green',
  
  'red': 'Merlot Red',
  'burgundy': 'Merlot Red',
  
  'orange': 'Sunburnt Orange',
  'coral': 'Sunburnt Orange',
  
  'yellow': 'Golden Mango',
  'gold': 'Golden Mango',
  'mustard': 'Golden Mango',
  
  'pink': 'Rosy Tides',
  'rose': 'Rosy Tides',
  
  'rainbow': 'Kasey Rainbow',
  'colorful': 'Kasey Rainbow',
  'multi': 'Kasey Rainbow',
  
  'striped': 'Twilight Blue',
  'black': 'Twilight Blue',
  'grey': 'Twilight Blue',
  'gray': 'Twilight Blue',
  
  'cricket': 'Cricket Australia',
};

// Find the PRIMARY product from text
function findPrimaryProduct(text: string): string | null {
  const textLower = text.toLowerCase();
  
  // Check for specific products first (more specific = higher priority)
  const specificProducts = ['hooded towel', 'picnic blanket', 'puffy blanket', 'beach towel', 'hammock', 'tote bag', 'gym bag'];
  
  for (const product of specificProducts) {
    if (textLower.includes(product)) {
      return PRODUCT_MAP[product];
    }
  }
  
  // Check for other products
  for (const [key, product] of Object.entries(PRODUCT_MAP)) {
    if (textLower.includes(key)) {
      return product;
    }
  }
  
  return null;
}

// Find the PRIMARY colour from color_pattern
function findPrimaryColor(colorPattern: string): string | null {
  if (!colorPattern) return null;
  
  const patternLower = colorPattern.toLowerCase();
  
  // Look for Nakie colour names first (most accurate)
  const nakieColors = ['River Blue', 'Forest Green', 'Mulberry Purple', 'Golden Mango', 'Kasey Rainbow',
    'Sky Blue', 'Olive Green', 'Merlot Red', 'Wild Fiesta', 'Charlotte Wensley',
    'Sunburnt Orange', 'Twilight Blue', 'Retro Shores', 'Ocean Breeze', 'Sound of Summer', 
    'Holiday Dreams', 'Salty Waves', 'Rosy Tides', 'Daintree Green', 'Happy Days'];
    
  for (const color of nakieColors) {
    if (patternLower.includes(color.toLowerCase())) {
      return color;
    }
  }
  
  // Map generic colours
  for (const [key, nakieColor] of Object.entries(COLOR_MAP)) {
    if (patternLower.includes(key)) {
      return nakieColor;
    }
  }
  
  return null;
}

function mapProducts(products: string[], description: string, actionIntent: string, colorPattern: string): string[] {
  // Combine all text for product detection
  const allText = [
    ...products,
    description || '',
    actionIntent || ''
  ].join(' ');
  
  // Find primary product
  const primaryProduct = findPrimaryProduct(allText);
  
  // Find primary color from color_pattern
  const primaryColor = findPrimaryColor(colorPattern);
  
  const result: string[] = [];
  
  if (primaryProduct && primaryColor) {
    // We have both - this is the ideal case
    result.push(`${primaryColor} - ${primaryProduct}`);
  } else if (primaryProduct) {
    // Just product, no colour
    result.push(primaryProduct);
  } else if (primaryColor) {
    // Just colour - assume hammock as default
    result.push(`${primaryColor} - Recycled Hammock with Straps`);
  }
  
  return result;
}

function main() {
  console.log('🔄 Mapping to ONLY the PRIMARY product + colour...\n');

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

    const colorPattern = video.product_color_pattern || '';
    const mappedProducts = mapProducts(products, video.description || '', video.action_intent || '', colorPattern);

    if (mappedProducts.length > 0) {
      updateStmt.run(JSON.stringify(mappedProducts), video.id);
      updated++;

      if (updated <= 10) {
        console.log(`Video ${video.id}:`);
        console.log(`  Color: ${colorPattern}`);
        console.log(`  → ${mappedProducts.join(', ')}`);
        console.log();
      }
    }
  }

  console.log(`\n✅ Updated ${updated} videos with ONLY the primary product + colour!`);
}

main();
