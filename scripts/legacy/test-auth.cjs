const { google } = require('googleapis');
const fs = require('fs');

const keyPath = '/Users/openclaw/.openclaw/workspace/br-roll-finder/google-service-account.json';

async function main() {
  const credentials = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  
  // Get access token
  const accessToken = await auth.getAccessToken();
  console.log('Token type:', typeof accessToken);
  console.log('Token value:', accessToken.token ? 'has token' : 'NO TOKEN');
  console.log('Full object:', JSON.stringify(accessToken, null, 2));
  
  // Test if the token works
  const drive = google.drive({ version: 'v3', auth });
  
  try {
    const response = await drive.files.list({ pageSize: 3 });
    console.log('\nDrive API works! Files:', response.data.files?.length);
  } catch (e) {
    console.log('\nDrive API error:', e.message);
  }
}

main().catch(console.error);
