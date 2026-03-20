import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'nakie.db');
const db = new Database(DB_PATH);

// Product types to look for
const PRODUCT_TYPES: Record<string, string[]> = {
  'hammock': ['Recycled Hammock with Straps'],
  'beach towel': ['Recycled Sand Free Beach Towel'],
  'towel': ['Recycled Sand Free Beach Towel'],
  'picnic blanket': ['Recycled Picnic Blanket'],
  'blanket': ['Recycled Puffy Blanket', 'Recycled Picnic Blanket'],
  'puffy': ['Recycled Puffy Blanket'],
  'hooded towel': ['Hooded Towel Recycled Sand Free'],
  'tote bag': ['Tote Bag'],
  'tote': ['Tote Bag'],
  'gym bag': ['Tote Bag'],
  'toiletry bag': ['Toiletry Bag'],
  'straps': ['Hammock Straps'],
};

// Map generic colours to Nakie colour names
const COLOR_MAP: Record<string, string> = {
  // Purple
  'purple': 'Mulberry Purple',
  'violet': 'Mulberry Purple',
  'lavender': 'Mulberry Purple',
  
  // Blue
  'blue': 'River Blue',
  'light blue': 'Sky Blue',
  'dark blue': 'River Blue',
  'sky blue': 'Sky Blue',
  'teal': 'River Blue',
  
  // Green  
  'green': 'Forest Green',
  'dark green': 'Daintree Green',
  'olive': 'Olive Green',
  'lime': 'Olive Green',
  
  // Red
  'red': 'Merlot Red',
  'burgundy': 'Merlot Red',
  'maroon': 'Merlot Red',
  
  // Orange
  'orange': 'Sunburnt Orange',
  'coral': 'Sunburnt Orange',
  'peach': 'Golden Mango',
  
  // Yellow/Gold
  'yellow': 'Golden Mango',
  'gold': 'Golden Mango',
  'mustard': 'Golden Mango',
  
  // Pink/Red
  'pink': 'Rosy Tides',
  'rose': 'Rosy Tides',
  
  // Multi/Pattern
  'rainbow': 'Kasey Rainbow',
  'colorful': 'Kasey Rainbow',
  'multi-colored': 'Kasey Rainbow',
  'multi colored': 'Kasey Rainbow',
  'striped': 'Twilight Blue',
  'plaid': 'Twilight Blue',
  'pattern': 'Kasey Rainbow',
  'abstract': 'Wild Fiesta',
  
  // Black/White
  'black': 'Twilight Blue',
  'white': 'Twilight Blue',
  'grey': 'Twilight Blue',
  'gray': 'Twilight Blue',
  'black and white': 'Twilight Blue',
  
  // Special
  'cricket': 'Cricket Australia Recycled Hammock with Straps',
};

function extractNakieColors(colorPattern: string): string[] {
  if (!colorPattern) return [];
  
  const colors: string[] = [];
  const patternLower = colorPattern.toLowerCase();
  
  // Check for exact matches in the color map
  for (const [key, nakieColor] of Object.entries(COLOR_MAP)) {
    if (patternLower.includes(key)) {
      colors.push(nakieColor);
    }
  }
  
  // Also check for direct Nakie color name matches
  const nakieColors = ['River Blue', 'Forest Green', 'Mulberry Purple', 'Golden Mango', 'Kasey Rainbow',
    'Sky Blue', 'Olive Green', 'Merlot Red', 'Wild Fiesta', 'Charlotte Wensley',
    'Sunburnt Orange', 'Twilight Blue', 'Retro Shores', 'Ocean Breeze', 'Sound of Summer', 
    'Holiday Dreams', 'Salty Waves', 'Rosy Tides', 'Toucan Bay', 'Daintree Green',
    'Happy Days', 'Starry Nights', 'Floating Lotus', 'Autumn Leaves', 'Turkish Delight'];
    
  for (const color of nakieColors) {
    if (patternLower.includes(color.toLowerCase())) {
      colors.push(color);
    }
  }
  
  return [...new Set(colors)];
}

function findProductTypes(text: string): string[] {
  const textLower = text.toLowerCase();
  const foundProducts: string[] = [];
  
  for (const [typeKey, productNames] of Object.entries(PRODUCT_TYPES)) {
    if (textLower.includes(typeKey)) {
      foundProducts.push(...productNames);
    }
  }
  
  return [...new Set(foundProducts)];
}

function mapProductsToNakie(products: string[], description: string, actionIntent: string, colorPattern: string): string[] {
  const allText = [
    ...products,
    description || '',
    actionIntent || ''
  ].join(' ');

  const foundColors = extractNakieColors(colorPattern);
  const foundProducts = findProductTypes(allText);
  
  const result: string[] = [];
  
  // If we have colors from product_color_pattern AND products, combine them
  if (foundColors.length > 0 && foundProducts.length > 0) {
    for (const color of foundColors) {
      for (const product of foundProducts) {
        result.push(`${color} - ${product}`);
      }
    }
  } else if (foundProducts.length > 0) {
    // Just products without colors
    result.push(...foundProducts);
  } else if (foundColors.length > 0) {
    // Just colors - assume it's a hammock
    for (const color of foundColors) {
      result.push(`${color} - Recycled Hammock with Straps`);
    }
  }
  
  return [...new Set(result)];
}

function main() {
  console.log('🔄 Mapping video tags with COLOURS from product_color_pattern field...\n');

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
    const mappedProducts = mapProductsToNakie(products, video.description || '', video.action_intent || '', colorPattern);

    if (mappedProducts.length > 0) {
      updateStmt.run(JSON.stringify(mappedProducts), video.id);
      updated++;

      if (updated <= 10) {
        console.log(`Video ${video.id}:`);
        console.log(`  Colors: ${colorPattern}`);
        console.log(`  → ${mappedProducts.join(', ')}`);
        console.log();
      }
    }
  }

  console.log(`\n✅ Updated ${updated} videos with product names and colours!`);
}

main();
