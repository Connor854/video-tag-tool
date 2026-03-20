const { google } = require('googleapis');
const fs = require('fs');

const keyPath = '/Users/openclaw/.openclaw/workspace/br-roll-finder/google-service-account.json';

async function main() {
  const credentials = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });
  
  // Try a few known Google Drive video IDs (these are common test IDs)
  const testIds = [
    '1a2b3c4d5e6f7g8h9i0j',  // placeholder
  ];
  
  // Try to find any video in the local DB that has a drive_id
  // For now, let's just check the Google Drive API is working
  const response = await drive.about.get({ fields: 'user, storageQuota' });
  console.log('Drive API connected! User:', response.data.user?.emailAddress);
  
  // Let's try to list some files to find a video
  const files = await drive.files.list({
    q: "mimeType contains 'video/'",
    pageSize: 5,
    fields: 'files(id, name, videoMediaMetadata)',
  });
  
  console.log('\nFound', files.data.files?.length, 'videos');
  for (const f of files.data.files || []) {
    console.log('\nVideo:', f.name);
    console.log('ID:', f.id);
    console.log('Duration (ms):', f.videoMediaMetadata?.durationMillis);
    console.log('Full metadata:', JSON.stringify(f.videoMediaMetadata, null, 2));
  }
}

main().catch(console.error);
