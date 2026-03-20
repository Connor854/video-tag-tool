const sqlite3 = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://juejixwrwtvmjqhxssvm.supabase.co';
// Use service role key to bypass RLS
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBsYmFzZSIsInJlZiI6Imp1ZWppeHdyd3R2bWpxaHhzc3ZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjg2Njc1MSwiZXhwIjoyMDg4NDQyNzUxfQ.v-6Nj72PQrvk2cQmDOqhAEhSTeX5t38ONjnSDE9sqzk';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const db = new sqlite3('./nakie.db');

function getThumbnailUrl(driveId) {
  if (!driveId) return null;
  return `https://drive.google.com/thumbnail?sz=w640&id=${driveId}`;
}

console.log('Fetching videos from SQLite (with Drive IDs)...');
const videos = db.prepare("SELECT id, file_name, drive_file_id, duration FROM videos WHERE drive_file_id IS NOT NULL AND length(drive_file_id) > 0").all();
console.log(`Found ${videos.length} videos with Drive IDs in SQLite`);

const batchSize = 50;
let updated = 0;
let failed = 0;
let skipped = 0;
let notFound = 0;

async function updateBatch(batch) {
  for (const v of batch) {
    const driveId = v.drive_file_id;
    const fileName = v.file_name;
    
    // Find the record in Supabase by name
    const { data: existing, error: findError } = await supabase
      .from('videos')
      .select('id, drive_id')
      .ilike('name', fileName)
      .limit(1);
    
    if (findError) {
      console.error(`Error finding ${fileName}: ${findError.message}`);
      failed++;
      continue;
    }
    
    if (!existing || existing.length === 0) {
      notFound++;
      continue;
    }
    
    const existingId = existing[0].id;
    
    // If drive_id is already set and different, skip
    if (existing[0].drive_id && existing[0].drive_id !== driveId) {
      skipped++;
      continue;
    }
    
    // Update drive_id and thumbnail_url
    const { error: updateError } = await supabase
      .from('videos')
      .update({
        drive_id: driveId,
        thumbnail_url: getThumbnailUrl(driveId),
      })
      .eq('id', existingId);
    
    if (updateError) {
      console.error(`Error updating ${fileName}: ${updateError.message}`);
      failed++;
    } else {
      updated++;
    }
  }
  process.stdout.write(`\rUpdated ${updated}, Failed ${failed}, Skipped ${skipped}, NotFound ${notFound}`);
}

async function main() {
  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);
    await updateBatch(batch);
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 50));
  }
  
  console.log(`\n\nDone! Updated ${updated} videos, ${failed} failed, ${skipped} skipped, ${notFound} not found`);
  db.close();
}

main().catch(console.error);