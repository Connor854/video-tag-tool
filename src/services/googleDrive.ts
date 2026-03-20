import { google } from 'googleapis';

export interface DriveVideoFile {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  videoMediaMetadata?: {
    durationMillis: string;
    width: number;
    height: number;
  };
  thumbnailLink?: string;
  webViewLink?: string;
}

/**
 * Create a GoogleAuth instance from a service account key.
 * Accepts the key as a JSON string (inline credentials) or a file path.
 */
export async function createDriveAuth(serviceAccountKey: string) {
  let credentials: Record<string, string>;
  try {
    credentials = JSON.parse(serviceAccountKey);
  } catch {
    // Treat as file path
    const fs = await import('fs');
    credentials = JSON.parse(fs.readFileSync(serviceAccountKey, 'utf-8'));
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  return auth;
}

/** A video file paired with the folder path it was found in. */
export interface DriveVideoWithPath {
  file: DriveVideoFile;
  folderPath: string;
}

export interface DriveListStats {
  foldersTraversed: number;
  videosFound: number;
}

// Concurrency limit for parallel subfolder crawling.
// Reduced from 10 to 5 for stability under local network load (ETIMEDOUT).
// Google Drive API quota is 12,000 queries/min for service accounts.
const CRAWL_CONCURRENCY = 5;

export async function listVideosInFolder(
  folderId: string,
  serviceAccountKey: string,
): Promise<DriveVideoWithPath[]> {
  const auth = await createDriveAuth(serviceAccountKey);
  const drive = google.drive({ version: 'v3', auth });

  const stats: DriveListStats = { foldersTraversed: 0, videosFound: 0 };
  const startMs = Date.now();
  const videos = await listVideosRecursive(drive, folderId, '', stats);
  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);

  console.log(
    `Drive crawl complete: ${stats.foldersTraversed} folders traversed, ` +
    `${stats.videosFound} videos found in ${elapsedSec}s`,
  );

  return videos;
}

/**
 * Run async tasks with bounded concurrency.
 * Executes up to `limit` tasks in parallel, collecting all results.
 */
function isRetryableDriveError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  const msg = String((err as Error)?.message ?? '');
  return code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND' || msg.includes('timeout');
}

async function withDriveRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries || !isRetryableDriveError(err)) throw err;
      const delayMs = Math.min(1000 * 2 ** attempt + Math.random() * 500, 15000);
      console.warn(`Drive API retry ${attempt + 1}/${maxRetries} after ${(err as NodeJS.ErrnoException)?.code ?? 'error'}: waiting ${Math.round(delayMs)}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

async function parallelMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function listVideosRecursive(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
  currentPath: string,
  stats: DriveListStats,
): Promise<DriveVideoWithPath[]> {
  stats.foldersTraversed++;
  const videos: DriveVideoWithPath[] = [];

  // Fetch videos and subfolders in parallel (two independent queries)
  const [videosList, subfolders] = await Promise.all([
    listAllVideos(drive, folderId),
    listAllSubfolders(drive, folderId),
  ]);

  for (const file of videosList) {
    videos.push({ file, folderPath: currentPath });
  }
  stats.videosFound += videosList.length;

  // Crawl subfolders with bounded concurrency
  if (subfolders.length > 0) {
    const subResults = await parallelMap(
      subfolders,
      CRAWL_CONCURRENCY,
      (subfolder) => {
        const childPath = currentPath ? `${currentPath}/${subfolder.name}` : subfolder.name;
        return listVideosRecursive(drive, subfolder.id, childPath, stats);
      },
    );
    for (const subVideos of subResults) {
      videos.push(...subVideos);
    }
  }

  return videos;
}

async function listAllVideos(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
): Promise<DriveVideoFile[]> {
  const videos: DriveVideoFile[] = [];
  let pageToken: string | undefined;

  do {
    const response = await withDriveRetry(() =>
      drive.files.list({
        q: `'${folderId}' in parents and mimeType contains 'video/' and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, size, videoMediaMetadata, thumbnailLink, webViewLink)',
        pageSize: 1000,
        pageToken,
      }),
    );

    if (response.data.files) {
      videos.push(...(response.data.files as DriveVideoFile[]));
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return videos;
}

async function listAllSubfolders(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
): Promise<Array<{ id: string; name: string }>> {
  const folders: Array<{ id: string; name: string }> = [];
  let pageToken: string | undefined;

  do {
    const response = await withDriveRetry(() =>
      drive.files.list({
        q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'nextPageToken, files(id, name)',
        pageSize: 1000,
        pageToken,
      }),
    );

    if (response.data.files) {
      for (const f of response.data.files) {
        if (f.id) folders.push({ id: f.id, name: f.name ?? f.id });
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return folders;
}

/**
 * Download a video file from Google Drive as a Buffer.
 * Used for uploading to Gemini Files API for analysis.
 */
export async function downloadVideoFile(
  driveFileId: string,
  serviceAccountKey: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const auth = await createDriveAuth(serviceAccountKey);
  const drive = google.drive({ version: 'v3', auth });

  // Get file metadata for MIME type
  const meta = await drive.files.get({
    fileId: driveFileId,
    fields: 'mimeType',
  });

  const mimeType = meta.data.mimeType ?? 'video/mp4';

  // Download file content
  const response = await drive.files.get(
    { fileId: driveFileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );

  return {
    buffer: Buffer.from(response.data as ArrayBuffer),
    mimeType,
  };
}
