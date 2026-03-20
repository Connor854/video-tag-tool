const fs = require('fs');
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'nakie.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    drive_file_id TEXT UNIQUE NOT NULL,
    file_name TEXT NOT NULL,
    description TEXT DEFAULT '',
    action_intent TEXT DEFAULT '',
    transcript_summary TEXT DEFAULT '',
    products TEXT DEFAULT '[]',
    suggestions TEXT DEFAULT '[]',
    scene_background TEXT DEFAULT '',
    shot_type TEXT DEFAULT '',
    camera_motion TEXT DEFAULT '',
    lighting TEXT DEFAULT '',
    audio_type TEXT DEFAULT '',
    group_type TEXT DEFAULT '',
    group_count INTEGER DEFAULT 1,
    has_logo INTEGER DEFAULT 0,
    has_packaging INTEGER DEFAULT 0,
    product_color_pattern TEXT DEFAULT '',
    confidence_products REAL DEFAULT 0,
    confidence_scene REAL DEFAULT 0,
    confidence_action REAL DEFAULT 0,
    confidence_people REAL DEFAULT 0,
    model_version TEXT DEFAULT '',
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    duration REAL DEFAULT 0,
    size_bytes INTEGER DEFAULT 0,
    thumbnail_url TEXT DEFAULT '',
    drive_url TEXT DEFAULT '',
    folder_path TEXT DEFAULT '',
    analyzed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );
`);

// Read the export
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'manus-export.json'), 'utf8'));
console.log(`Loaded ${data.length} videos from manus-export.json`);

// Clear existing
db.exec('DELETE FROM videos');
console.log('Cleared existing data');

// Prepare insert
const insert = db.prepare(`
  INSERT OR IGNORE INTO videos (
    id, drive_file_id, file_name, description, action_intent, transcript_summary, products, suggestions,
    scene_background, shot_type, camera_motion, lighting, audio_type, group_type, group_count,
    has_logo, has_packaging, product_color_pattern, confidence_products, confidence_scene, 
    confidence_action, confidence_people, model_version, input_tokens, output_tokens,
    duration, size_bytes, thumbnail_url, drive_url, folder_path, analyzed_at, created_at
  ) VALUES (
    @id, @drive_file_id, @file_name, @description, @action_intent, @transcript_summary, @products, @suggestions,
    @scene_background, @shot_type, @camera_motion, @lighting, @audio_type, @group_type, @group_count,
    @has_logo, @has_packaging, @product_color_pattern, @confidence_products, @confidence_scene, 
    @confidence_action, @confidence_people, @model_version, @input_tokens, @output_tokens,
    @duration, @size_bytes, @thumbnail_url, @drive_url, @folder_path, @analyzed_at, @created_at
  )
`);

const insertMany = db.transaction((videos) => {
  let count = 0;
  for (const item of videos) {
    const v = item.video;
    const a = item.analysis || {};
    const products = item.products || [];
    const suggestions = item.suggestions || [];
    
    try {
      insert.run({
        id: String(v.id),
        drive_file_id: v.driveFileId || '',
        file_name: v.fileName || '',
        description: a.summary || '',
        action_intent: a.actionIntent || '',
        transcript_summary: a.transcriptSummary || '',
        products: JSON.stringify(products),
        suggestions: JSON.stringify(suggestions),
        scene_background: a.sceneBackground || '',
        shot_type: a.shotType || '',
        camera_motion: a.cameraMotion || '',
        lighting: a.lighting || '',
        audio_type: a.audioType || '',
        group_type: a.groupType || '',
        group_count: a.peopleCount || 1,
        has_logo: a.logoVisible ? 1 : 0,
        has_packaging: a.packagingVisible ? 1 : 0,
        product_color_pattern: a.productColorPattern || '',
        confidence_products: a.confidenceProducts || 0,
        confidence_scene: a.confidenceScene || 0,
        confidence_action: a.confidenceAction || 0,
        confidence_people: a.confidencePeople || 0,
        model_version: a.modelVersion || '',
        input_tokens: a.inputTokens || 0,
        output_tokens: a.outputTokens || 0,
        duration: v.durationSec || 0,
        size_bytes: (v.sizeMb || 0) * 1024 * 1024,
        thumbnail_url: '',
        drive_url: v.driveFileId ? `https://drive.google.com/file/d/${v.driveFileId}/view` : '',
        folder_path: v.folderPath || '',
        analyzed_at: a.processedAt || v.createdAt || new Date().toISOString(),
        created_at: v.createdAt || new Date().toISOString()
      });
      count++;
    } catch (err) {
      console.error(`Failed to insert video ${v.id}: ${err.message}`);
    }
  }
  return count;
});

const imported = insertMany(data);
console.log(`Successfully imported ${imported} videos`);

const total = db.prepare('SELECT COUNT(*) as count FROM videos').get();
console.log(`Total videos in database: ${total.count}`);

// Show sample with suggestions
const sample = db.prepare('SELECT file_name, suggestions, transcript_summary, product_color_pattern FROM videos LIMIT 2').all();
console.log('\nSample with new fields:');
sample.forEach(v => {
  console.log(`  ${v.file_name}`);
  console.log(`    Suggestions: ${v.suggestions}`);
  console.log(`    Color: ${v.product_color_pattern}`);
});

db.close();
