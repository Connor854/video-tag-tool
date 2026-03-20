const sqlite3 = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const SUPABASE_URL = 'https://juejixwrwtvmjqhxssvm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBsYmFzZSIsInJlZiI6Imp1ZWppeHdyd3R2bWpxaHhzc3ZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjY3NTEsImV4cCI6MjA4ODQ0Mjc1MX0.m7zUYlccqz-qN-99ZnH03-T0fbyUdXumKBuylywCtO8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const db = new sqlite3('./nakie.db');

const DURATION_THRESHOLD = 0.5;

function ensureUuid(val) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(String(val))) return val;
  const hash = crypto.createHash('md5').update(String(val)).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
}

function getThumbnailUrl(driveId) {
  if (!driveId) return null;
  return `https://drive.google.com/thumbnail?sz=w640&id=${driveId}`;
}

console.log('Fetching videos from SQLite...');
const videos = db.prepare('SELECT * FROM videos').all();
console.log(`Found ${videos.length} videos in SQLite`);

const batchSize = 50;
let updated = 0;
let failed = 0;
let skipped = 0;

async function updateBatch(batch) {
  for (const v of batch) {
    const driveId = v.drive_file_id || null;
    const duration = Number(v.duration) || 0;
    const shouldExclude = duration > 0 && duration < DURATION_THRESHOLD;
    const id = ensureUuid(v.id);
    
    // Update just thumbnail_url and status - NOT drive_id (to avoid unique constraint)
    const updateData = {
      id: id,
      name: v.file_name || 'Unknown',
      thumbnail_url: getThumbnailUrl(driveId),
      duration_seconds: duration,
      status: shouldExclude ? 'excluded' : (v.analyzed_at ? 'processed' : 'pending'),
    };

    const { error } = await supabase.from('videos').upsert(updateData, { onConflict: 'id' });
    
    if (error) {
      if (error.message.includes('duplicate key')) {
        skipped++;
      } else {
        console.error(`Error: ${error.message}`);
        failed++;
      }
    } else {
      updated++;
    }
  }
  process.stdout.write(`\rUpdated ${updated}, Failed ${failed}, Skipped ${skipped}`);
}

async function main() {
  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);
    await updateBatch(batch);
  }
  
  console.log(`\n\nDone! Updated ${updated} videos, ${failed} failed, ${skipped} skipped (unique constraint)`);
  db.close();
}

main().catch(console.error);