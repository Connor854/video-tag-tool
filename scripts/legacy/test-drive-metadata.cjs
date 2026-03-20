const { google } = require('googleapis');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const keyPath = '/Users/openclaw/.openclaw/workspace/br-roll-finder/google-service-account.json';

const supabase = createClient(
  'https://juejixwrwtvmjqhxssvm.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBsYmFzZSIsInJlZiI6Imp1ZWppeHdyd3R2bWpxaHhzc3ZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjY3NTEsImV4cCI6MjA4ODQ0Mjc1MX0.m7zUYlccqz-qN-99ZnH03-T0fbyUdXumKBuylywCtO8'
);

async function main() {
  const credentials = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });
  
  // Get some videos with drive IDs
  const result = await supabase.from('videos').select('drive_id').limit(5);
  console.log('Videos result:', result);
  
  const videos = result.data || [];
  
  for (const v of videos) {
    if (!v.drive_id) continue;
    console.log('\nChecking:', v.drive_id);
    
    try {
      const response = await drive.files.get({
        fileId: v.drive_id,
        fields: 'id, name, videoMediaMetadata, size',
      });
      
      console.log('Has metadata?', !!response.data.videoMediaMetadata);
      console.log('Duration millis:', response.data.videoMediaMetadata?.durationMillis);
      console.log('Full metadata:', JSON.stringify(response.data.videoMediaMetadata, null, 2));
    } catch (e) {
      console.log('Error:', e.message);
    }
  }
}

main().catch(console.error);
