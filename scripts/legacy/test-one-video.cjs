const { google } = require('googleapis');
const fs = require('fs');

const keyPath = '/Users/openclaw/.openclaw/workspace/br-roll-finder/google-service-account.json';
const credentials = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });

async function test() {
  const driveId = '0b58d156-bfe5-0c59-496a-40343b3040b1';
  
  try {
    const response = await drive.files.get({
      fileId: driveId,
      fields: 'id, name, videoMediaMetadata',
    });
    
    console.log('File:', response.data.name);
    console.log('Duration (ms):', response.data.videoMediaMetadata?.durationMillis);
  } catch (e) {
    console.log('Error:', e.message);
  }
}

test().catch(console.error);
