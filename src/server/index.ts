import 'dotenv/config';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { google } from 'googleapis';
import { spawn } from 'child_process';
import { appRouter } from './router.js';
import { createContext } from './trpc.js';
import { resolveWorkspaceFromRequest } from './resolveWorkspace.js';
import { supabase } from '../lib/supabase.js';
import { saveWorkspaceConnection } from '../lib/workspace.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, '..', 'client');

const app = express();
const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

app.use(cors());

// tRPC API
app.use(
  '/api/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

// Shopify OAuth callback — verify HMAC, exchange code for token, save to workspace_connections
app.get('/auth/shopify/callback', async (req, res) => {
  const appUrl = process.env['APP_URL'] ?? `http://localhost:${PORT}`;
  const clientId = process.env['SHOPIFY_CLIENT_ID'];
  const clientSecret = process.env['SHOPIFY_CLIENT_SECRET'];

  if (!clientId || !clientSecret) {
    console.error('Shopify OAuth: SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET not configured');
    return res.redirect(`${appUrl}/?shopify_oauth=error&reason=config`);
  }

  const { shop, code, hmac, state } = req.query as Record<string, string | undefined>;
  if (!shop || !code || !hmac || !state) {
    return res.redirect(`${appUrl}/?shopify_oauth=error&reason=missing_params`);
  }

  // Verify HMAC: remove hmac, sort params alphabetically, hash with client secret
  const queryString = req.originalUrl?.includes('?') ? req.originalUrl.split('?')[1] ?? '' : '';
  const params = new URLSearchParams(queryString);
  params.delete('hmac');
  const sorted = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const computed = crypto.createHmac('sha256', clientSecret).update(sorted).digest('hex');
  const hmacBuf = Buffer.from(hmac, 'hex');
  const computedBuf = Buffer.from(computed, 'hex');
  if (hmacBuf.length !== computedBuf.length || !crypto.timingSafeEqual(hmacBuf, computedBuf)) {
    return res.redirect(`${appUrl}/?shopify_oauth=error&reason=hmac_invalid`);
  }

  // Validate shop hostname (e.g. store.myshopify.com)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shop)) {
    return res.redirect(`${appUrl}/?shopify_oauth=error&reason=invalid_shop`);
  }

  const workspaceId = state;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(workspaceId)) {
    return res.redirect(`${appUrl}/?shopify_oauth=error&reason=invalid_state`);
  }

  try {
    const tokenUrl = `https://${shop}/admin/oauth/access_token`;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    });
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Shopify token exchange failed:', response.status, text);
      return res.redirect(`${appUrl}/?shopify_oauth=error&reason=token_exchange`);
    }

    const data = (await response.json()) as { access_token?: string };
    if (!data.access_token) {
      return res.redirect(`${appUrl}/?shopify_oauth=error&reason=no_token`);
    }

    await saveWorkspaceConnection(workspaceId, 'shopify', {
      access_token: data.access_token,
    }, {
      store_url: shop,
      connected_via: 'oauth',
    });

    return res.redirect(`${appUrl}/?shopify_oauth=success`);
  } catch (err) {
    console.error('Shopify OAuth callback error:', err);
    return res.redirect(`${appUrl}/?shopify_oauth=error&reason=server`);
  }
});

// Initialize Google Drive auth
let driveAuth: any = null;
let drive: any = null;

async function initDriveAuth() {
  const key = process.env['GOOGLE_SERVICE_ACCOUNT_KEY'];
  if (!key) return;

  let credentials: Record<string, unknown>;
  try {
    // Support inline JSON (hosted env) or file path (local dev)
    if (key.trim().startsWith('{')) {
      credentials = JSON.parse(key) as Record<string, unknown>;
    } else {
      const fs = await import('fs');
      credentials = JSON.parse(fs.readFileSync(key, 'utf-8')) as Record<string, unknown>;
    }
    driveAuth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    drive = google.drive({ version: 'v3', auth: driveAuth });
    console.log('Google Drive auth initialized');
  } catch (err) {
    console.error('Failed to load service account:', err);
  }
}

// Extract thumbnail using ffmpeg from video stream
async function extractThumbnailFromVideo(driveFileId: string, outputSize: number): Promise<Buffer | null> {
  return new Promise(async (resolve) => {
    try {
      if (!drive) {
        resolve(null);
        return;
      }

      // Get download URL from Drive
      const fileMeta = await drive.files.get({
        fileId: driveFileId,
        fields: 'id, name, mimeType',
      });

      // Create a read stream from Drive
      const accessToken = await driveAuth.getAccessToken();
      
      // Use Drive's export/content endpoint
      const downloadUrl = `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`;
      
      const response = await fetch(downloadUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken.token}`,
        },
      });

      if (!response.ok || !response.body) {
        console.log('Failed to download video from Drive');
        resolve(null);
        return;
      }

      // Pipe video through ffmpeg to extract frame
      const ffmpeg = spawn('ffmpeg', [
        '-i', 'pipe:0',           // Input from stdin
        '-ss', '00:00:01',        // Seek to 1 second
        '-vframes', '1',          // Extract 1 frame
        '-vf', `scale=${outputSize}:-1`,  // Scale to desired width
        '-f', 'image2pipe',       // Output format
        '-vcodec', 'png',         // PNG format
        'pipe:1',                 // Output to stdout
      ]);

      const chunks: Buffer[] = [];

      ffmpeg.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      ffmpeg.stderr.on('close', () => {
        if (chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          resolve(null);
        }
      });

      ffmpeg.stderr.on('error', () => {
        resolve(null);
      });

      // Pipe the response body to ffmpeg
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!ffmpeg.stdin.destroyed) {
            ffmpeg.stdin.write(Buffer.from(value));
          }
        }
      } finally {
        if (!ffmpeg.stdin.destroyed) {
          ffmpeg.stdin.end();
        }
      }

    } catch (err) {
      console.log('FFmpeg extraction failed:', err);
      resolve(null);
    }
  });
}

// Thumbnail proxy for Google Drive
app.get('/thumbnail/:driveFileId', async (req, res) => {
  const { driveFileId } = req.params;
  const size = parseInt(req.query['size'] as string ?? '640', 10);

  const resolved = await resolveWorkspaceFromRequest(req);
  if (!resolved) {
    return res.status(401).send('Unauthorized');
  }

  const { data: video, error } = await supabase
    .from('videos')
    .select('workspace_id')
    .eq('drive_id', driveFileId)
    .maybeSingle();

  if (error || !video) {
    return res.status(404).send('Not found');
  }
  if (video.workspace_id !== resolved.workspaceId) {
    return res.status(403).send('Forbidden');
  }

  // For seed data, return a placeholder
  if (driveFileId.startsWith('seed_')) {
    // Generate a deterministic placeholder based on the ID
    const hash = Array.from(driveFileId).reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const hue = hash % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${Math.round(Number(size) * 0.5625)}" viewBox="0 0 640 360">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:hsl(${hue},40%,65%)" />
          <stop offset="100%" style="stop-color:hsl(${(hue + 40) % 360},45%,55%)" />
        </linearGradient>
      </defs>
      <rect width="640" height="360" fill="url(#g)" />
      <circle cx="320" cy="180" r="40" fill="rgba(255,255,255,0.3)" />
      <polygon points="308,155 308,205 350,180" fill="rgba(255,255,255,0.8)" />
    </svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(svg);
  }

  // Real Google Drive thumbnail proxy with service account
  try {
    if (drive) {
      // Use Drive API to get file metadata with thumbnail
      const response = await drive.files.get({
        fileId: driveFileId,
        fields: 'id, name, thumbnailLink',
      });
      
      // If Drive has a thumbnail, fetch it
      if (response.data.thumbnailLink) {
        const thumbResp = await fetch(response.data.thumbnailLink);
        if (thumbResp.ok) {
          const contentType = thumbResp.headers.get('content-type') ?? 'image/jpeg';
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'public, max-age=3600');
          const buffer = Buffer.from(await thumbResp.arrayBuffer());
          return res.send(buffer);
        }
      }
      
      // No thumbnail from Drive - try to extract using ffmpeg
      console.log(`No Drive thumbnail for ${driveFileId}, trying ffmpeg...`);
      const frameBuffer = await extractThumbnailFromVideo(driveFileId, size);
      
      if (frameBuffer && frameBuffer.length > 0) {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache longer since we generated it
        return res.send(frameBuffer);
      }
      
      // All attempts failed - generate a premium placeholder
      const hash = Array.from(driveFileId).reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const hue = hash % 360;
      
      // Premium gradient placeholder with play icon
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${Math.round(Number(size) * 1.25)}" viewBox="0 0 ${size} ${Math.round(Number(size) * 1.25)}">
        <defs>
          <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:hsl(${hue},35%,55%)" />
            <stop offset="100%" style="stop-color:hsl(${(hue + 30) % 360},40%,45%)" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)" />
        <circle cx="50%" cy="50%" r="${size * 0.08}" fill="rgba(255,255,255,0.25)" />
        <polygon points="${size * 0.44},${size * 0.38} ${size * 0.44},${size * 0.62} ${size * 0.6},${size * 0.5}" fill="rgba(255,255,255,0.7)" />
      </svg>`;
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(svg);
    }
    
    // Fallback: try public thumbnail URL (won't work without auth)
    const url = `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w${size}`;
    const fetchResp = await fetch(url);
    
    if (!fetchResp.ok) {
      return res.status(404).send('Thumbnail not found');
    }
    const contentType = fetchResp.headers.get('content-type') ?? 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const buffer = Buffer.from(await fetchResp.arrayBuffer());
    return res.send(buffer);
  } catch (err: any) {
    console.error('Thumbnail error:', err.message);
    return res.status(500).send('Failed to fetch thumbnail');
  }
});

// Video streaming proxy for Google Drive - streams video to the browser so they can watch on-site
app.get('/video/:driveFileId', async (req, res) => {
  const { driveFileId } = req.params;

  const resolved = await resolveWorkspaceFromRequest(req);
  if (!resolved) {
    return res.status(401).send('Unauthorized');
  }

  const { data: video, error } = await supabase
    .from('videos')
    .select('workspace_id')
    .eq('drive_id', driveFileId)
    .maybeSingle();

  if (error || !video) {
    return res.status(404).send('Not found');
  }
  if (video.workspace_id !== resolved.workspaceId) {
    return res.status(403).send('Forbidden');
  }

  // For seed data, return 404
  if (driveFileId.startsWith('seed_')) {
    return res.status(404).send('Video not available');
  }

  if (!drive) {
    return res.status(500).send('Google Drive not configured');
  }

  try {
    // Get file metadata first
    const fileMeta = await drive.files.get({
      fileId: driveFileId,
      fields: 'id, name, mimeType, size',
    });

    const mimeType = fileMeta.data.mimeType;
    const fileSize = parseInt(fileMeta.data.size ?? '0', 10);
    const fileName = fileMeta.data.name ?? 'video';

    // Set content type
    let contentType = mimeType ?? 'video/mp4';
    
    // For Google Docs video type, we need to export as MP4
    let alt = 'media';
    if (mimeType === 'application/vnd.google-apps.video') {
      // Direct video file - can stream directly
      alt = 'media';
    } else if (mimeType?.includes('google-apps')) {
      // Google Docs format - export as MP4
      alt = 'media';
      contentType = 'video/mp4';
    }

    // Get a fresh access token (returns string directly, not object)
    const accessToken = await driveAuth.getAccessToken();
    const token = typeof accessToken === 'string' ? accessToken : accessToken.token;

    // Build the download URL
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=${alt}`;

    // Set up headers with fresh token
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
    };

    // Handle Range requests for seeking
    const range = req.headers.range;
    if (range && fileSize > 0) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      headers['Range'] = `bytes=${start}-${end}`;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
      });
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': fileSize,
        'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
        'Accept-Ranges': 'bytes',
      });
    }

    // Stream the video from Google Drive to the client
    const response = await fetch(downloadUrl, { headers });

    if (!response.ok) {
      console.error('Drive fetch error:', response.status, await response.text());
      if (!res.headersSent) {
        return res.status(500).send('Failed to fetch video from Google Drive');
      }
      return;
    }

    // Pipe the response body directly to the client
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      } finally {
        res.end();
      }
    }

  } catch (err: any) {
    console.error('Video stream error:', err.message);
    if (!res.headersSent) {
      return res.status(500).send('Failed to stream video: ' + err.message);
    }
  }
});

// Static client + SPA fallback (after API/media routes)
app.use(express.static(clientDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

async function recoverStaleScans(): Promise<void> {
  const { data: affectedJobs } = await supabase
    .from('scan_jobs')
    .update({
      status: 'aborted',
      error_message: 'Server restart — process interrupted; videos reset to reanalysis_needed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'running')
    .select('id');

  if (affectedJobs?.length) {
    console.log(`Recovery: marked ${affectedJobs.length} running scan job(s) as aborted (server restart)`);
  }

  const { data: staleVideos } = await supabase
    .from('videos')
    .update({ status: 'reanalysis_needed' })
    .eq('status', 'analyzing')
    .select('id');

  if (staleVideos?.length) {
    console.log(`Recovery: reset ${staleVideos.length} stale analyzing videos to reanalysis_needed`);
  }
}
app.listen(PORT, async () => {
  await initDriveAuth();
  await recoverStaleScans();
  console.log(`Server running on http://localhost:${PORT}`);
});
