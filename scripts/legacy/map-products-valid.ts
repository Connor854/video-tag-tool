import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'nakie.db');
const db = new Database(DB_PATH);

// VALID colour + product combinations from the website
// Only list colours that actually exist for each product
const VALID_COMBINATIONS: Record<string, string[]> = {
  'Recycled Hammock with Straps': [
    'River Blue', 'Forest Green', 'Mulberry Purple', 'Golden Mango', 'Kasey Rainbow',
    'Sky Blue', 'Olive Green', 'Merlot Red', 'Wild Fiesta', 'Charlotte Wensley',
    'Sunburnt Orange', 'Twilight Blue', 'Olive', 'Cricket Australia'
  ],
  'Ultra Light Recycled Hammock with Straps': [
    'Olive'
  ],
  'Recycled Sand Free Beach Towel': [
    'Retro Shores', 'Ocean Breeze', 'Underwater Magic', 'Sound of Summer', 
    'Holiday Dreams', 'Salty Waves', 'Rosy Tides', 'Kasey Rainbow',
    'Eucalyptus Green', 'Toucan Bay', 'Cricket Australia', 'Daintree Green'
  ],
  'Recycled Sand Free Beach Blanket': [
    'Sound of Summer', 'Holiday Dreams', 'Salty Waves', 'Rosy Tides', 'Kasey Rainbow', 'Eucalyptus Green'
  ],
  'Recycled Picnic Blanket': [
    'Sound of Summer', 'Kasey Rainbow', 'Happy Days', 'Holiday Dreams', 
    'Charlotte Wensley', 'Starry Nights', 'Floating Lotus', 
    'Autumn Leaves', 'Turkish Delight', 'Eucalyptus Green'
  ],
  'Recycled Puffy Blanket': [
    'River Blue', 'Forest Green', 'Mulberry Purple', 'Merlot Red', 
    'Wild Fiesta', 'Twilight Blue'
  ],
  'Hooded Towel Recycled Sand Free': [
    'Salty Waves', 'Sound of Summer', 'Rosy Tides', 'Kasey Rainbow', 'Retro Shores'
  ],
  'Kids Hooded Towel Recycled Sand Free': [
    'Rosy Tides', 'Salty Waves', 'Sound of Summer', 'Kasey Rainbow'
  ],
  'Tote Bag': [
    'Black'
  ],
  'Toiletry Bag': [
    'Black'
  ],
  'Hammock Straps': [
    'Black'
  ],
  'Carabiners': [
    'Silver'
  ],
  'Bug Net': [
    'Black'
  ],
  'Rain Tarp': [
    'Forest Green', 'Olive'
  ],
  'Recycled Gym Towel - Mystery Colour': [
    'Mystery Colour'
  ]
};

// All valid colours
const ALL_COLOURS = new Set(Object.values(VALID_COMBINATIONS).flat());

// Generic to Nakie colour mapping
const COLOR_MAP: Record<string, string> = {
  'purple': 'Mulberry Purple', 'violet': 'Mulberry Purple', 'mulberry': 'Mulberry Purple',
  'blue': null,  // Too generic - need context
  'light blue': 'Sky Blue', 'sky blue': 'Sky Blue',
  'green': null, // Too generic - need context
  'olive': 'Olive Green',
  'red': null,   // Too generic
  'burgundy': 'Merlot Red', 'maroon': 'Merlot Red',
  'orange': 'Sunburnt Orange', 'coral': 'Sunburnt Orange',
  'yellow': null, // Too generic
  'gold': 'Golden Mango', 'mustard': 'Golden Mango',
  'pink': 'Rosy Tides', 'rose': 'Rosy Tides',
  'rainbow': 'Kasey Rainbow', 'colorful': 'Kasey Rainbow', 'multi': 'Kasey Rainbow',
  'striped': 'Twilight Blue', 'black': 'Twilight Blue', 'grey': 'Twilight Blue', 'gray': 'Twilight Blue',
  'cricket': 'Cricket Australia',
  'river blue': 'River Blue',
  'forest green': 'Forest Green',
  'sky blue': 'Sky Blue',
  'merlot red': 'Merlot Red',
  'wild fiesta': 'Wild Fiesta',
  'charlotte wensley': 'Charlotte Wensley',
  'sunburnt orange': 'Sunburnt Orange',
  'twilight blue': 'Twilight Blue',
  'retro shores': 'Retro Shores',
  'ocean breeze': 'Ocean Breeze',
  'underwater magic': 'Underwater Magic',
  'sound of summer': 'Sound of Summer',
  'holiday dreams': 'Holiday Dreams',
  'salty waves': 'Salty Waves',
  'rosy tides': 'Rosy Tides',
  'toucan bay': 'Toucan Bay',
  'daintree green': 'Daintree Green',
  'happy days': 'Happy Days',
  'starry nights': 'Starry Nights',
  'floating lotus': 'Floating Lotus',
  'autumn leaves': 'Autumn Leaves',
  'turkish delight': 'Turkish Delight',
  'eucalyptus green': 'Eucalyptus Green',
  'kasey rainbow': 'Kasey Rainbow',
};

// Product name mapping
const PRODUCT_MAP: Record<string, string> = {
  'hammock': 'Recycled Hammock with Straps',
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

function findProduct(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [key, product] of Object.entries(PRODUCT_MAP)) {
    if (lower.includes(key)) return product;
  }
  return null;
}

function findColor(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  
  // First, check for exact Nakie colour name matches
  for (const colour of ALL_COLOURS) {
    if (lower.includes(colour.toLowerCase())) return colour;
  }
  
  // Then check generic mappings
  for (const [key, nakieColor] of Object.entries(COLOR_MAP)) {
    if (nakieColor && lower.includes(key)) return nakieColor;
  }
  
  return null;
}

// Get valid colours for a product
function getValidColours(product: string): string[] {
  return VALID_COMBINATIONS[product] || [];
}

// Check if a colour is valid for a product
function isValidCombination(product: string, color: string): boolean {
  const validColours = getValidColours(product);
  return validColours.includes(color);
}

function mapProducts(products: string[], description: string, actionIntent: string, colorPattern: string): string[] {
  const allText = [...products, description || '', actionIntent || ''].join(' ');
  const result: string[] = [];
  
  // Find product and colour from description
  const product = findProduct(allText);
  const color = findColor(colorPattern || allText);
  
  if (product && color) {
    // Check if this is a valid combination
    if (isValidCombination(product, color)) {
      result.push(`${color} - ${product}`);
    } else {
      // Invalid combination - find valid colours for this product
      const validColours = getValidColours(product);
      if (validColours.length > 0) {
        // Use first valid colour or default
        result.push(`${validColours[0]} - ${product}`);
      } else {
        result.push(product);
      }
    }
  } else if (product) {
    result.push(product);
  } else if (color && ALL_COLOURS.has(color)) {
    // Colour found but no product - assume hammock (most common)
    if (isValidCombination('Recycled Hammock with Straps', color)) {
      result.push(`${color} - Recycled Hammock with Straps`);
    } else {
      result.push('Recycled Hammock with Straps');
    }
  }
  
  return result;
}

function main() {
  console.log('🔄 Mapping with VALID colour + product combinations from website...\n');

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

  console.log(`\n✅ Updated ${updated} videos with valid product + colour combinations!`);
}

main();
