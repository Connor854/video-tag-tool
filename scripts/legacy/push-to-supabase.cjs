const sqlite3 = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const SUPABASE_URL = 'https://juejixwrwtvmjqhxssvm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1ZWppeHdyd3R2bWpxaHhzc3ZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjY3NTEsImV4cCI6MjA4ODQ0Mjc1MX0.m7zUYlccqz-qN-99ZnH03-T0fbyUdXumKBuylywCtO8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const db = new sqlite3('./nakie.db');

function ensureUuid(val) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(String(val))) return val;
  const hash = crypto.createHash('md5').update(String(val)).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
}

function safeJson(val) {
  if (!val) return [];
  try {
    return JSON.parse(val);
  } catch { return []; }
}

console.log('Fetching videos from SQLite...');
const videos = db.prepare('SELECT * FROM videos').all();
console.log(`Found ${videos.length} videos in SQLite`);

const batchSize = 50;
let pushed = 0;
let failed = 0;

async function pushBatch(batch) {
  const records = batch.map(v => ({
    id: ensureUuid(v.id),
    drive_id: v.drive_file_id || null,
    name: v.file_name,
    drive_link: v.drive_url || '',
    thumbnail_url: v.thumbnail_url || '',
    size_bytes: Math.round(Number(v.size_bytes)) || 0,
    duration_seconds: Math.round(Number(v.duration) || 0),
    status: v.analyzed_at ? 'processed' : 'pending',
    summary: v.transcript_summary || v.description || '',
    action_intent: v.action_intent || 'Unknown',
    products: safeJson(v.products),
    best_use: safeJson(v.suggestions),
    scene: v.scene_background || 'Unknown',
    shot_type: v.shot_type || 'Unknown',
    motion: v.camera_motion || 'Unknown',
    lighting: v.lighting || 'Unknown',
    audio_type: v.audio_type || 'Unknown',
    people_count: Math.round(Number(v.group_count)) || 0,
    people_description: v.group_type || '',
    brand_logo_visible: v.has_logo === 1,
    brand_packaging_visible: v.has_packaging === 1,
    brand_colors: v.product_color_pattern || '',
    drive_path: v.folder_path || '',
    indexed_at: v.analyzed_at || null,
  }));

  const { error } = await supabase.from('videos').upsert(records, { onConflict: 'id' });
  
  if (error) {
    console.error(`Error: ${error.message}`);
    failed += batch.length;
  } else {
    pushed += batch.length;
    process.stdout.write(`\rPushed ${pushed}/${videos.length}`);
  }
}

async function main() {
  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);
    await pushBatch(batch);
  }
  
  console.log(`\n\nDone! Pushed ${pushed} videos, ${failed} failed`);
  db.close();
}

main().catch(console.error);