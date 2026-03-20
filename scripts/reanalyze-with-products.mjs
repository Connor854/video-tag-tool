/**
 * Re-analyze videos with new product context for specific colorways
 * Usage: node --input-type=module scripts/reanalyze-with-products.cjs [limit]
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const supabase = createClient(
  'https://juejixwrwtvmjqhxssvm.supabase.co',
  'sb_publishable_aWKOwjsqsEHyftAlbRiFQw_0KB5uzUX'
);

// Load product data
const productData = JSON.parse(readFileSync(join(__dirname, '../data/nakie-products.json'), 'utf-8'));

function getProductContext() {
  const lines = ['NAKIE PRODUCT REFERENCE:'];
  lines.push('\nAvailable Colors/Designs:');
  lines.push(productData.colorPalette.join(', '));
  lines.push('\nNRL Teams:');
  lines.push(productData.nrlTeams.join(', '));
  lines.push('\nProduct Categories:');
  for (const [key, cat] of Object.entries(productData.categories)) {
    lines.push(`\n${cat.name}:`);
    for (const p of cat.products) {
      lines.push(`- ${p.name}`);
    }
  }
  return lines.join('\n');
}

const productContext = getProductContext();

async function getThumbnail(driveId) {
  // Use Google Drive thumbnail API (doesn't expire)
  const url = `https://drive.google.com/thumbnail?sz=w640&id=${driveId}`;
  try {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return base64;
  } catch (e) {
    console.error('Failed to fetch thumbnail:', e.message);
    return null;
  }
}

async function analyzeWithGemini(thumbnailBase64, fileName) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  
  // Use known API key
  const apiKey = 'AIzaSyDVVvZk_vK5Kmq5vzj1c9wINwsN8kKnjbE';
  
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `Analyze this video thumbnail from a Nakie brand (Australian eco-outdoor brand) video library. The file name is: "${fileName}"

${productContext}

Based on the thumbnail and filename, provide a JSON analysis with these fields:
- products: array of specific Nakie product names visible or likely featured (use EXACT product names from the reference above, e.g., "River Blue - Recycled Hammock with Straps", "Kasey Rainbow - Recycled Sand Free Beach Towel", "Deep Ocean Blue - Sustainable Down Puffy Blanket", "Peanut Butter Caramel - Protein Bar")
- sceneBackground: the location/scene
- shotType: the style of video
- groupType: who appears
- groupCount: number of people

IMPORTANT: When identifying products, be SPECIFIC with colorways:
- For hammocks: "River Blue - Recycled Hammock with Straps", "Olive Green - Recycled Hammock with Straps", etc.
- For beach towels: "Kasey Rainbow - Recycled Sand Free Beach Towel", "Rosy Tides - Recycled Sand Free Beach Towel", etc.
- For puffy blankets: "Deep Ocean Blue - Sustainable Down Puffy Blanket", "Kasey Rainbow - Sustainable Down Puffy Blanket", etc.
- For NRL products: "Broncos - NRL Recycled Hammock with Straps", "Dragons - NRL Recycled Sand Free Beach Towel", etc.

Respond with ONLY valid JSON, no markdown fences.`;

  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: thumbnailBase64,
        },
      },
    ]);

    let text = result.response.text().trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    
    return JSON.parse(text);
  } catch (e) {
    console.error('Analysis failed:', e.message);
    return null;
  }
}

async function main() {
  const limit = parseInt(process.argv[2] || '100');
  
  console.log(`Re-analyzing up to ${limit} videos with product colorways...`);
  
  // Get videos with drive_id
  const { data: videos } = await supabase
    .from('videos')
    .select('id, name, drive_id')
    .not('drive_id', 'is', null)
    .limit(limit);
  
  console.log(`Found ${videos?.length || 0} videos with thumbnails`);
  
  let processed = 0;
  let updated = 0;
  
  for (const video of videos) {
    try {
      console.log(`\n[${processed + 1}/${videos.length}] Analyzing: ${video.name}`);
      
      const thumbBase64 = await getThumbnail(video.drive_id);
      if (!thumbBase64) {
        console.log('  ⚠️ No thumbnail, skipping');
        processed++;
        continue;
      }
      
      const analysis = await analyzeWithGemini(thumbBase64, video.name);
      
      if (analysis) {
        // Update database with new analysis
        await supabase.from('videos').update({
          products: analysis.products || [],
          scene_background: analysis.sceneBackground || analysis.scene_background || null,
          shot_type: analysis.shotType || analysis.shot_type || null,
          group_type: analysis.groupType || analysis.group_type || null,
          group_count: analysis.groupCount || analysis.group_count || 0,
          description: analysis.description || null,
          analyzed_at: new Date().toISOString()
        }).eq('id', video.id);
        
        console.log(`  ✅ Products: ${analysis.products?.join(', ') || '(none)'}`);
        updated++;
      } else {
        console.log(`  ❌ Analysis failed`);
      }
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
    }
    
    processed++;
    
    // Rate limit - small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`\n=== Done ===`);
  console.log(`Processed: ${processed}`);
  console.log(`Updated: ${updated}`);
}

main().catch(console.error);