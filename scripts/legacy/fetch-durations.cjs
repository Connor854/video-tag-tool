const { google } = require('googleapis');
const fs = require('fs');

const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://juejixwrwtvmjqhxssvm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_aWKOwjsqsEHyftAlbRiFQw_0KB5uzUX';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const keyPath = '/Users/openclaw/.openclaw/workspace/br-roll-finder/google-service-account.json';
const credentials = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });

async function fetchDurations() {
  console.log('Starting duration fetch with proper pagination...\n');
  
  const batchSize = 100;
  let offset = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  
  while (true) {
    // Get batch of videos ordered by ID for proper pagination
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, drive_id, duration_seconds')
      .not('drive_id', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + batchSize - 1);
    
    if (error) {
      console.error('Error:', error);
      break;
    }
    
    if (!videos || videos.length === 0) {
      console.log('\nNo more videos to process');
      break;
    }
    
    console.log(`Processing batch ${offset} - ${offset + videos.length}...`);
    
    let batchUpdated = 0;
    let batchFailed = 0;
    
    await Promise.all(videos.map(async (video) => {
      if (!video.drive_id) {
        totalSkipped++;
        return;
      }
      
      if (video.duration_seconds && video.duration_seconds > 0) {
        totalSkipped++;
        return;
      }
      
      try {
        const response = await drive.files.get({
          fileId: video.drive_id,
          fields: 'id, videoMediaMetadata',
        });
        
        const durationMs = response.data.videoMediaMetadata?.durationMillis;
        
        if (durationMs) {
          const durationSec = parseInt(durationMs) / 1000;
          
          await supabase
            .from('videos')
            .update({ duration_seconds: durationSec })
            .eq('id', video.id);
          
          batchUpdated++;
        } else {
          batchFailed++;
        }
      } catch (e) {
        batchFailed++;
      }
    }));
    
    totalUpdated += batchUpdated;
    totalFailed += batchFailed;
    
    console.log(`  Updated: ${batchUpdated}, Failed: ${batchFailed}, Skipped: ${videos.length - batchUpdated - batchFailed}`);
    
    offset += batchSize;
    
    // Rate limit
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`\n✅ Done! Total Updated: ${totalUpdated} | Failed: ${totalFailed} | Skipped: ${totalSkipped}`);
}

fetchDurations().catch(console.error);
