import crypto from 'crypto';
import { supabase } from '../lib/supabase.js';
import { getWorkspaceCredentials } from '../lib/workspace.js';
import { listVideosInFolder, downloadVideoFile, type DriveVideoWithPath } from './googleDrive.js';
import { analyzeVideoFull, analyzeVideoThumbnail, getProductContextForWorkspace } from './geminiAnalyzer.js';
import type { VideoAnalysisResult, ProductCandidate } from './geminiAnalyzer.js';
import { updateScanJobProgress, completeScanJob, abortScanJob } from '../server/routers/admin.js';

// ============================================================
// Config
// ============================================================

const SYNC_BATCH_SIZE = 100; // Drive files to upsert per batch
const ANALYSIS_DELAY_MS = 1000; // Base delay between video analyses per worker (rate limiting)
const MAX_RETRIES = 2;
// Temporary stability: 200MB limit to reduce OOM risk on Render (was 1 GB)
const MAX_VIDEO_SIZE_BYTES = 200 * 1024 * 1024;

// Concurrent analysis workers. Start conservative — Gemini Flash allows 1000 RPM
// but each analysis involves upload + generate + cleanup = ~3 API calls.
// 3 workers × ~3 calls × 1/s rate = ~9 RPM, well within limits.
const DEFAULT_ANALYSIS_WORKERS = 3;

// Worker resilience settings
const WORKER_MAX_EMPTY_STREAK = 5;   // consecutive true-empty fetches before worker exits
const WORKER_MAX_ERROR_STREAK = 10;  // consecutive fetch errors before worker exits
const WORKER_STAGGER_MS = 200;       // startup stagger between workers
const WORKER_MAX_RESPAWNS = 3;       // max times supervisor will respawn a crashed worker
const WORKER_HEARTBEAT_INTERVAL = 60_000; // log worker summary every 60s

// Shared rate-limit backoff state across all workers
let rateLimitBackoffUntil = 0; // timestamp — workers sleep until this time if set

// Abort signal — allows graceful mid-scan shutdown
let scanAborted = false;
export function abortScan() { scanAborted = true; }

// Worker heartbeat tracking (in-memory, no schema changes)
interface WorkerHeartbeat {
  workerId: number;
  status: 'starting' | 'fetching' | 'processing' | 'idle' | 'exited' | 'crashed';
  lastActive: number; // timestamp
  videosProcessed: number;
  lastVideoName?: string;
  exitReason?: string;
}
const workerHeartbeats = new Map<number, WorkerHeartbeat>();

// ============================================================
// Utilities
// ============================================================

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeAspectRatio(width: number, height: number): string | null {
  if (!width || !height) return null;
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.05) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.05) return '9:16';
  if (Math.abs(ratio - 1) < 0.05) return '1:1';
  if (Math.abs(ratio - 4 / 3) < 0.05) return '4:3';
  if (Math.abs(ratio - 3 / 4) < 0.05) return '3:4';
  if (Math.abs(ratio - 4 / 5) < 0.05) return '4:5';
  return `${width}:${height}`;
}

// ============================================================
// Product matching — tightened logic
// ============================================================

// Category keywords for fallback matching
const CATEGORY_KEYWORDS: Record<string, string> = {
  'hooded towel': 'Hooded Towels',
  'beach towel': 'Beach Towels',
  'picnic blanket': 'Picnic Blankets',
  'puffy blanket': 'Puffy Blankets',
  'tote bag': 'Tote Bags',
  'protein bar': 'Protein Bars',
  hammock: 'Hammocks',
  towel: 'Beach Towels',
  blanket: 'Picnic Blankets',
  tote: 'Tote Bags',
};

interface RefProduct {
  id: string;
  name: string;
  base_product: string;
  category: string;
  colorway: string | null;
}

// Cache reference products per scan run, scoped by workspace
let refProductsCache: RefProduct[] | null = null;
let refProductsCacheWorkspaceId: string | null = null;

async function getRefProducts(workspaceId: string): Promise<RefProduct[]> {
  if (refProductsCache && refProductsCacheWorkspaceId === workspaceId) return refProductsCache;
  const { data } = await supabase
    .from('products')
    .select('id, name, base_product, category, colorway')
    .eq('workspace_id', workspaceId)
    .eq('active', true)
    .not('approved_at', 'is', null);
  refProductsCache = (data as RefProduct[]) ?? [];
  refProductsCacheWorkspaceId = workspaceId;
  return refProductsCache;
}

export function clearProductCache() {
  refProductsCache = null;
  refProductsCacheWorkspaceId = null;
}

/**
 * Match Gemini product candidates against the products reference table.
 * Implements the four-level tagging hierarchy:
 *   Level 1: exact product + exact colorway → amber (green requires Phase D image validation)
 *   Level 2: exact product only → amber
 *   Level 3: category only → amber
 *   Level 4: no tag → skip
 *
 * Green confidence is NEVER assigned automatically before Phase D.
 */
async function matchProducts(
  workspaceId: string,
  videoId: string,
  candidates: ProductCandidate[],
): Promise<void> {
  if (candidates.length === 0) return;

  const refProducts = await getRefProducts(workspaceId);
  if (refProducts.length === 0) return;

  const junctionRows: Array<{
    video_id: string;
    workspace_id: string;
    product_id: string | null;
    category: string;
    confidence: 'green' | 'amber';
    source: string;
  }> = [];

  // Track categories already matched at product level to avoid duplicate category-only rows
  const matchedCategories = new Set<string>();

  for (const candidate of candidates) {
    const candidateName = candidate.name.trim();
    if (!candidateName) continue;

    const candidateLower = candidateName.toLowerCase();

    // --- Tier 1: Exact full name match ---
    const exactMatch = refProducts.find((p) => p.name.toLowerCase() === candidateLower);
    if (exactMatch) {
      junctionRows.push({
        video_id: videoId,
        workspace_id: workspaceId,
        product_id: exactMatch.id,
        category: exactMatch.category,
        confidence: 'amber', // Always amber before Phase D image validation
        source: 'gemini',
      });
      matchedCategories.add(exactMatch.category);
      continue;
    }

    // --- Tier 2: Base product match (require base product name to appear in candidate) ---
    const baseMatch = refProducts.find((p) => {
      const baseLower = p.base_product.toLowerCase();
      return baseLower.length >= 10 && candidateLower.includes(baseLower);
    });

    if (baseMatch) {
      // If Gemini also specified a colorway, try to find the specific variant
      const candidateColorway = candidate.colorway?.trim().toLowerCase();
      if (candidateColorway && candidateColorway.length > 0) {
        const variantMatch = refProducts.find(
          (p) =>
            p.base_product.toLowerCase() === baseMatch.base_product.toLowerCase() &&
            p.colorway?.toLowerCase() === candidateColorway,
        );
        if (variantMatch) {
          junctionRows.push({
            video_id: videoId,
            workspace_id: workspaceId,
            product_id: variantMatch.id,
            category: variantMatch.category,
            confidence: 'amber',
            source: 'gemini',
          });
          matchedCategories.add(variantMatch.category);
          continue;
        }
      }

      // Matched base product but not specific variant
      junctionRows.push({
        video_id: videoId,
        workspace_id: workspaceId,
        product_id: baseMatch.id,
        category: baseMatch.category,
        confidence: 'amber',
        source: 'gemini',
      });
      matchedCategories.add(baseMatch.category);
      continue;
    }

    // --- Tier 3: Category keyword match ---
    const categoryFromGemini = candidate.category?.trim();
    let matchedCategory: string | null = null;

    // First try Gemini's own category label
    if (categoryFromGemini) {
      const catLower = categoryFromGemini.toLowerCase();
      const knownCategories = [...new Set(refProducts.map((p) => p.category))];
      const catMatch = knownCategories.find((c) => c.toLowerCase() === catLower);
      if (catMatch) {
        matchedCategory = catMatch;
      }
    }

    // Fallback: keyword search in candidate name
    if (!matchedCategory) {
      const sortedKeywords = Object.entries(CATEGORY_KEYWORDS).sort(
        ([a], [b]) => b.length - a.length,
      );
      for (const [keyword, category] of sortedKeywords) {
        if (candidateLower.includes(keyword)) {
          matchedCategory = category;
          break;
        }
      }
    }

    if (matchedCategory && !matchedCategories.has(matchedCategory)) {
      junctionRows.push({
        video_id: videoId,
        workspace_id: workspaceId,
        product_id: null,
        category: matchedCategory,
        confidence: 'amber',
        source: 'gemini',
      });
      matchedCategories.add(matchedCategory);
    }
    // Level 4: no match — skip silently. Don't force a tag.
  }

  if (junctionRows.length > 0) {
    for (const row of junctionRows) {
      const { error } = await supabase.from('video_products').upsert(row, {
        onConflict: row.product_id ? 'video_id,product_id' : undefined,
        ignoreDuplicates: true,
      });
      if (error) {
        if (!error.message.includes('duplicate')) {
          console.error(`Failed to insert video_product for ${videoId}:`, error.message);
        }
      }
    }
  }
}

// ============================================================
// Phase 1: Sync — list Drive files and upsert metadata to Supabase
// ============================================================

export interface SyncResult {
  totalInDrive: number;
  newFiles: number;
  alreadySynced: number;
}

/**
 * Sync Google Drive file listing to Supabase.
 * Only writes file metadata (name, size, duration, aspect ratio, etc.)
 * Does NOT run AI analysis. Sets status = 'synced'.
 */
export async function syncDriveFiles(workspaceId: string): Promise<SyncResult> {
  const creds = await getWorkspaceCredentials(workspaceId);

  if (!creds.googleDriveFolderId) {
    throw new Error('Google Drive folder ID not configured');
  }
  if (!creds.googleServiceAccountKey) {
    throw new Error('Google service account key not configured');
  }

  console.log('Syncing Google Drive folder:', creds.googleDriveFolderId);
  const driveFiles = await listVideosInFolder(creds.googleDriveFolderId, creds.googleServiceAccountKey);
  if (driveFiles.length === 0) {
    console.log(`[Drive] WARNING: Discovery returned 0 videos for folder_id=${creds.googleDriveFolderId}. Check folder ID and sharing with service account.`);
  }
  console.log(`Found ${driveFiles.length} videos in Drive`);

  // Check existing drive_ids GLOBALLY — drive_id is unique across all workspaces.
  // Using workspace-scoped check + upsert caused FK violations when the same Drive
  // folder was synced by another workspace: upsert overwrote videos.id, orphaning
  // video_products rows that reference it.
  const { data: existing, error: fetchError } = await supabase
    .from('videos')
    .select('drive_id, workspace_id');

  if (fetchError) {
    throw new Error(`Failed to fetch existing videos: ${fetchError.message}`);
  }

  const existingDriveIds = new Set((existing ?? []).map((r) => r.drive_id).filter(Boolean));
  const newEntries = driveFiles.filter((entry) => !existingDriveIds.has(entry.file.id));
  const alreadyInTable = driveFiles.length - newEntries.length;
  const alreadyInWorkspace = (existing ?? []).filter((r) => r.workspace_id === workspaceId).length;

  if (alreadyInTable > 0 && alreadyInTable !== alreadyInWorkspace) {
    console.log(
      `[Drive] ${alreadyInTable} videos already in DB (from this or another workspace); skipping to avoid FK conflict`,
    );
  }
  console.log(`${newEntries.length} new videos to sync`);

  // INSERT only — never update existing rows (avoids overwriting id and orphaning video_products)
  for (let i = 0; i < newEntries.length; i += SYNC_BATCH_SIZE) {
    const batch = newEntries.slice(i, i + SYNC_BATCH_SIZE);
    const rows = batch.map(({ file, folderPath }) => {
      const durationSec = file.videoMediaMetadata
        ? parseInt(file.videoMediaMetadata.durationMillis) / 1000
        : 0;
      const width = file.videoMediaMetadata?.width ?? 0;
      const height = file.videoMediaMetadata?.height ?? 0;

      return {
        id: crypto.randomUUID(),
        workspace_id: workspaceId,
        drive_id: file.id,
        name: file.name,
        mime_type: file.mimeType,
        size_bytes: parseInt(file.size ?? '0'),
        duration_seconds: durationSec,
        aspect_ratio: computeAspectRatio(width, height),
        thumbnail_url: file.thumbnailLink ?? `https://drive.google.com/thumbnail?id=${file.id}&sz=w640`,
        drive_link: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
        drive_path: folderPath || null,
        status: 'synced',
      };
    });

    const { error } = await supabase.from('videos').insert(rows);
    if (error) {
      console.error(`Sync batch error:`, error);
    }
  }

  return {
    totalInDrive: driveFiles.length,
    newFiles: newEntries.length,
    alreadySynced: alreadyInWorkspace,
  };
}

// ============================================================
// Phase 1b: Triage — assign priority and route videos
// ============================================================

// Junk filename patterns — auto-exclude
const JUNK_FILENAME_PATTERNS = [
  /^\.DS_Store$/i,
  /^Thumbs\.db$/i,
  /^desktop\.ini$/i,
  /\.tmp$/i,
  /\.part$/i,
];

// Camera-generated filenames — low priority signal
const CAMERA_FILENAME_PATTERN = /^(DSC_|IMG_|MVI_|GOPR|DJI_|GH\d|GP\d|VID_\d)/i;

// Folder signal words
const HIGH_PRIORITY_FOLDER_WORDS = ['final', 'export', 'approved', 'delivered', 'edit', 'edited', 'hero'];
const LOW_PRIORITY_FOLDER_WORDS = ['raw', 'archive', 'old', 'drafts', 'unused', 'broll', 'b-roll', 'backup'];

interface TriageResult {
  filename_tokens: string[];
  folder_tokens: string[];
  product_candidates: Array<{
    product_id: string;
    product_name: string;
    match_source: 'filename' | 'folder';
    similarity: number;
  }>;
  folder_signals: string[];
  priority_breakdown: Record<string, number>;
  excluded_reason?: string;
}

export interface TriageSummary {
  total: number;
  triaged: number;
  excluded: number;
}

/**
 * Tokenize a filename or folder segment into lowercase words.
 * Strips file extensions, splits on common delimiters.
 */
function tokenize(input: string): string[] {
  // Remove file extension
  const noExt = input.replace(/\.[^.]+$/, '');
  // Split on non-alphanumeric (hyphens, underscores, spaces, dots, camelCase boundaries)
  return noExt
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.,()[\]{}]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
}

/**
 * Check if a set of tokens contains a product name or colorway.
 * Requires substantial overlap to avoid false positives from short generic words.
 * Returns similarity 0-1.
 */
function matchTokensToProduct(
  tokens: string[],
  productName: string,
  baseProduct: string,
  colorway: string | null,
): number {
  const joined = tokens.join(' ');

  // Try exact substring match of base_product (most reliable)
  const baseLower = baseProduct.toLowerCase();
  if (baseLower.length >= 10 && joined.includes(baseLower)) {
    return 0.9;
  }

  // Try colorway + partial base product match
  // Require colorway to be multi-word or ≥5 chars to avoid false positives on "Red", "Blue"
  if (colorway) {
    const colorLower = colorway.toLowerCase();
    const colorTokens = colorLower.split(/\s+/);
    const hasColor = colorTokens.length > 1
      ? colorTokens.every((ct) => tokens.includes(ct))
      : colorLower.length >= 5 && tokens.includes(colorLower);

    if (hasColor) {
      // Also check for at least one substantial base product word
      const baseTokens = baseLower.split(/\s+/).filter((t) => t.length >= 5);
      const hasBaseWord = baseTokens.some((bt) => tokens.includes(bt));
      if (hasBaseWord) {
        return 0.8;
      }
      // Color match alone with a long colorway name is a weaker signal
      if (colorLower.length >= 8) {
        return 0.5;
      }
    }
  }

  // Try full product name as substring
  const nameLower = productName.toLowerCase();
  if (nameLower.length >= 12 && joined.includes(nameLower)) {
    return 0.85;
  }

  return 0;
}

/**
 * Triage all videos with status='synced'.
 * Assigns priority scores and transitions to 'triaged' or 'excluded'.
 * No API calls — pure metadata analysis against the products table.
 */
export async function triageVideos(workspaceId: string): Promise<TriageSummary> {
  // Load products for matching
  const refProducts = await getRefProducts(workspaceId);

  // Fetch all synced videos (paginated — Supabase caps at 1000 per query)
  const PAGE_SIZE = 1000;
  const syncedVideos: Array<{ id: string; name: string; drive_path: string | null; duration_seconds: number | null; size_bytes: number | null }> = [];
  let offset = 0;

  while (true) {
    const { data: page, error } = await supabase
      .from('videos')
      .select('id, name, drive_path, duration_seconds, size_bytes')
      .eq('workspace_id', workspaceId)
      .eq('status', 'synced')
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to fetch synced videos for triage: ${error.message}`);
    }

    if (!page || page.length === 0) break;
    syncedVideos.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (syncedVideos.length === 0) {
    return { total: 0, triaged: 0, excluded: 0 };
  }

  console.log(`Triaging ${syncedVideos.length} synced videos...`);

  let triaged = 0;
  let excluded = 0;

  for (const video of syncedVideos) {
    const fileName = video.name ?? '';
    const folderPath = video.drive_path ?? '';
    const duration = video.duration_seconds ?? 0;
    const sizeBytes = video.size_bytes ?? 0;

    // --- Check for junk filenames ---
    const isJunkFile = JUNK_FILENAME_PATTERNS.some((p) => p.test(fileName));
    if (isJunkFile) {
      await supabase.from('videos').update({
        status: 'excluded',
        priority: 0,
        processing_error: `Auto-excluded: junk filename "${fileName}"`,
        triage_result: { excluded_reason: 'junk_filename', filename_tokens: [], folder_tokens: [], product_candidates: [], folder_signals: [], priority_breakdown: {} },
      }).eq('id', video.id);
      excluded++;
      continue;
    }

    // --- Check for auto-exclude by duration/size ---
    if (duration > 0 && duration < 2) {
      await supabase.from('videos').update({
        status: 'excluded',
        priority: 0,
        processing_error: 'Auto-excluded: duration under 2 seconds',
        triage_result: { excluded_reason: 'too_short', filename_tokens: [], folder_tokens: [], product_candidates: [], folder_signals: [], priority_breakdown: {} },
      }).eq('id', video.id);
      excluded++;
      continue;
    }

    if (sizeBytes === 0) {
      await supabase.from('videos').update({
        status: 'excluded',
        priority: 0,
        processing_error: 'Auto-excluded: zero-byte file',
        triage_result: { excluded_reason: 'zero_bytes', filename_tokens: [], folder_tokens: [], product_candidates: [], folder_signals: [], priority_breakdown: {} },
      }).eq('id', video.id);
      excluded++;
      continue;
    }

    // --- Tokenize filename and folder path ---
    const filenameTokens = tokenize(fileName);
    const folderSegments = folderPath.split('/').filter(Boolean);
    const folderTokens = folderSegments.flatMap((seg: string) => tokenize(seg));

    // --- Match against products ---
    const productCandidates: TriageResult['product_candidates'] = [];

    for (const product of refProducts) {
      // Check filename
      const filenameSim = matchTokensToProduct(filenameTokens, product.name, product.base_product, product.colorway);
      if (filenameSim >= 0.5) {
        productCandidates.push({
          product_id: product.id,
          product_name: product.name,
          match_source: 'filename',
          similarity: filenameSim,
        });
      }

      // Check folder path
      const folderSim = matchTokensToProduct(folderTokens, product.name, product.base_product, product.colorway);
      if (folderSim >= 0.5) {
        // Avoid duplicate if filename already matched this product with higher similarity
        const existing = productCandidates.find((c) => c.product_id === product.id);
        if (!existing || folderSim > existing.similarity) {
          if (existing) {
            existing.match_source = 'folder';
            existing.similarity = folderSim;
          } else {
            productCandidates.push({
              product_id: product.id,
              product_name: product.name,
              match_source: 'folder',
              similarity: folderSim,
            });
          }
        }
      }
    }

    // --- Detect folder signals ---
    const folderLower = folderPath.toLowerCase();
    const folderSignals: string[] = [];
    for (const word of HIGH_PRIORITY_FOLDER_WORDS) {
      if (folderLower.includes(word)) folderSignals.push(`+${word}`);
    }
    for (const word of LOW_PRIORITY_FOLDER_WORDS) {
      if (folderLower.includes(word)) folderSignals.push(`-${word}`);
    }

    // --- Compute priority score ---
    const breakdown: Record<string, number> = {};
    let score = 50; // Base score

    // Product match signal (strongest)
    const bestSimilarity = productCandidates.reduce((max, c) => Math.max(max, c.similarity), 0);
    if (bestSimilarity >= 0.8) {
      breakdown['product_match_strong'] = 30;
      score += 30;
    } else if (bestSimilarity >= 0.5) {
      breakdown['product_match_weak'] = 15;
      score += 15;
    }

    // Duration signals
    if (duration >= 5 && duration <= 300) {
      breakdown['duration_ideal'] = 15;
      score += 15;
    } else if (duration > 1800) {
      breakdown['duration_very_long'] = -20;
      score -= 20;
    } else if (duration > 600) {
      breakdown['duration_long'] = -5;
      score -= 5;
    }

    // Size signal (can do full video upload)
    if (sizeBytes > 0 && sizeBytes <= MAX_VIDEO_SIZE_BYTES) {
      breakdown['size_uploadable'] = 10;
      score += 10;
    }

    // Folder signals
    const hasHighFolder = folderSignals.some((s) => s.startsWith('+'));
    const hasLowFolder = folderSignals.some((s) => s.startsWith('-'));
    if (hasHighFolder) {
      breakdown['folder_high'] = 15;
      score += 15;
    }
    if (hasLowFolder) {
      breakdown['folder_low'] = -15;
      score -= 15;
    }

    // Camera-generated filename
    if (CAMERA_FILENAME_PATTERN.test(fileName)) {
      breakdown['camera_filename'] = -10;
      score -= 10;
    }

    // Clamp to 0-100
    score = Math.max(0, Math.min(100, score));

    const triageResult: TriageResult = {
      filename_tokens: filenameTokens,
      folder_tokens: folderTokens,
      product_candidates: productCandidates,
      folder_signals: folderSignals,
      priority_breakdown: breakdown,
    };

    await supabase.from('videos').update({
      status: 'triaged',
      priority: score,
      triage_result: triageResult,
    }).eq('id', video.id);

    triaged++;
  }

  console.log(`Triage complete: ${triaged} triaged, ${excluded} excluded (of ${syncedVideos.length} total)`);

  return { total: syncedVideos.length, triaged, excluded };
}

// ============================================================
// Phase 2: Analyze — process one video with Gemini
// ============================================================

/**
 * Analyze a single video. Designed to be called per-video, stateless,
 * and compatible with future queue/concurrency architecture.
 *
 * Returns true if analysis succeeded, false otherwise.
 */
export async function analyzeOneVideo(
  workspaceId: string,
  videoId: string,
  driveFileId: string,
  fileName: string,
  sizeBytes: number,
  serviceAccountKey: string,
  geminiApiKey: string,
): Promise<boolean> {
  // Mark as analyzing (prevents double-processing)
  await supabase.from('videos').update({ status: 'analyzing' }).eq('id', videoId);

  let analysis: VideoAnalysisResult;
  let usedFullVideo = false;
  let analysisMode: string = 'unknown';

  const productContext = await getProductContextForWorkspace(workspaceId);

  try {
    if (sizeBytes > 0 && sizeBytes <= MAX_VIDEO_SIZE_BYTES) {
      // Full video path — NO silent fallback to thumbnail.
      // If download or Gemini upload fails, the error propagates to the
      // outer catch which sets status='error'. The worker retry loop
      // will re-attempt the full video analysis.
      const { buffer, mimeType } = await downloadVideoFile(driveFileId, serviceAccountKey);
      analysis = await analyzeVideoFull(buffer, mimeType, fileName, geminiApiKey, productContext);
      usedFullVideo = true;
      analysisMode = 'full_video';
    } else {
      // File exceeds memory-safety threshold — use thumbnail analysis to avoid OOM
      const sizeMB = Math.round(sizeBytes / 1024 / 1024);
      const limitMB = Math.round(MAX_VIDEO_SIZE_BYTES / 1024 / 1024);
      console.log(`${fileName} is ${sizeMB}MB (limit ${limitMB}MB, memory-safety), using thumbnail analysis`);
      const thumbnailUrl = `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w640`;
      const thumbResponse = await fetch(thumbnailUrl);
      const thumbBuffer = Buffer.from(await thumbResponse.arrayBuffer());
      const thumbBase64 = thumbBuffer.toString('base64');
      analysis = await analyzeVideoThumbnail(thumbBase64, fileName, geminiApiKey, productContext);
      analysisMode = 'thumbnail_size_limit';
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // Detect Gemini rate limit (429) — signal all workers to back off
    if (errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit') || errMsg.toLowerCase().includes('quota')) {
      const backoffMs = 60_000; // Back off for 60 seconds on rate limit
      rateLimitBackoffUntil = Math.max(rateLimitBackoffUntil, Date.now() + backoffMs);
      console.warn(`Rate limited on ${fileName}, all workers backing off for ${backoffMs / 1000}s`);
      // Set back to triaged so it re-enters the queue (not counted as error)
      await supabase.from('videos').update({ status: 'triaged' }).eq('id', videoId);
      return false;
    }

    console.error(`Analysis failed for ${fileName}:`, err);
    await supabase.from('videos').update({
      status: 'error',
      processing_error: errMsg,
    }).eq('id', videoId);
    return false;
  }

  // Handle junk detection
  if (analysis.is_junk) {
    await supabase.from('videos').update({
      status: 'excluded',
      processing_error: `Junk: ${analysis.junk_reason}`,
      summary: analysis.description,
      indexed_at: new Date().toISOString(),
    }).eq('id', videoId);
    console.log(`Excluded junk: ${fileName} (${analysis.junk_reason})`);
    return true;
  }

  // Flatten product names for the legacy products[] array column
  const productNames = analysis.products.map((p) => p.name).filter(Boolean);

  // Write analysis results to Supabase
  const { error: updateError } = await supabase.from('videos').update({
    summary: analysis.description,
    action_intent: analysis.action_intent,
    transcript: analysis.transcript || null,
    products: productNames,
    content_tags: analysis.content_tags,
    scene: analysis.scene,
    lighting: analysis.lighting,
    audio_type: analysis.audio_type,
    people_count: analysis.people_count,
    people_description: analysis.people_description,
    brand_logo_visible: analysis.has_logo,
    brand_packaging_visible: analysis.has_packaging,
    analysis_mode: analysisMode,
    status: 'analyzed',
    indexed_at: new Date().toISOString(),
  }).eq('id', videoId);

  if (updateError) {
    console.error(`Failed to update video ${fileName}:`, updateError);
    await supabase.from('videos').update({ status: 'error', processing_error: updateError.message }).eq('id', videoId);
    return false;
  }

  // Write product junction rows and moments — wrap in try/catch so a single file
  // never crashes the worker or fails the whole job
  try {
    await matchProducts(workspaceId, videoId, analysis.products);

    if (analysis.moments.length > 0) {
      const momentRows = analysis.moments
        .filter((m) => m.label && m.start_seconds >= 0)
        .map((m) => ({
          video_id: videoId,
          workspace_id: workspaceId,
          start_seconds: m.start_seconds,
          end_seconds: m.end_seconds || null,
          label: m.label,
          description: m.description || null,
          products_visible: m.products_visible?.length ? m.products_visible : null,
        }));

      if (momentRows.length > 0) {
        const { error: momentError } = await supabase.from('video_moments').insert(momentRows);
        if (momentError) {
          console.error(`Failed to insert moments for ${fileName}:`, momentError);
        }
      }
    }
  } catch (postErr) {
    console.error(`Post-analysis write failed for ${fileName}:`, postErr);
    await supabase.from('videos').update({
      status: 'error',
      processing_error: postErr instanceof Error ? postErr.message : String(postErr),
    }).eq('id', videoId);
    return false;
  }

  const tagsStr = (analysis.content_tags ?? []).join(',');
  console.log(
    `Analyzed: ${fileName} [${usedFullVideo ? 'video' : 'thumbnail'}] ` +
    `products=${productNames.length} moments=${analysis.moments.length} tags=${tagsStr}`,
  );
  return true;
}

// ============================================================
// Orchestrator: sync + analyze with retry
// ============================================================

export interface ScanResult {
  syncResult: SyncResult;
  triageSummary: TriageSummary;
  analyzed: number;
  errors: number;
  skipped: number;
}

/** Options for startScan — all optional except jobId. */
export interface ScanOptions {
  /** Max videos to analyze in this run. 0 = unlimited. Default: 0. */
  maxVideos?: number;
  /** Number of concurrent analysis workers. Default: 3. */
  workers?: number;
  /** Skip sync+triage and just process the existing queue. Default: false. */
  queueOnly?: boolean;
  /** Required: scan_jobs row id for durable progress tracking. */
  jobId: string;
}

/**
 * Atomically claim a video for analysis.
 * Uses conditional update: only succeeds if the video is still in a claimable status.
 * Returns true if this worker successfully claimed the video.
 */
async function claimVideo(videoId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('videos')
    .update({ status: 'analyzing' })
    .eq('id', videoId)
    .in('status', ['triaged', 'reanalysis_needed'])
    .select('id');

  if (error) {
    console.error(`Claim error for ${videoId}:`, error.message);
    return false;
  }

  // If the update matched and returned a row, we claimed it
  return (data?.length ?? 0) > 0;
}

type QueueVideo = { id: string; drive_id: string; name: string; size_bytes: number | null; priority: number | null };
type FetchResult = { ok: true; videos: QueueVideo[] } | { ok: false; error: string };

/**
 * Fetch the next batch of videos from the priority queue.
 * Returns a tagged result so callers can distinguish query errors from a truly empty queue.
 */
async function fetchQueueBatch(
  workspaceId: string,
  batchSize: number,
): Promise<FetchResult> {
  // Note: 'error' status excluded — failed videos need investigation, not blind retry
  const { data, error } = await supabase
    .from('videos')
    .select('id, drive_id, name, size_bytes, priority')
    .eq('workspace_id', workspaceId)
    .in('status', ['triaged', 'reanalysis_needed'])
    .not('drive_id', 'is', null)
    .order('priority', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(batchSize);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, videos: data ?? [] };
}

/**
 * Full scan: sync Drive files → triage → analyze by priority with concurrent workers.
 * This is the function called by the admin "Start Scan" button.
 *
 * Pipeline:
 *   1. Sync: crawl Drive, write metadata, status='synced'
 *   2. Triage: assign priority, status='triaged' or 'excluded'
 *   3. Analyze: N concurrent workers pull from priority queue
 *
 * Options:
 *   maxVideos: cap analysis to N videos (for test batches)
 *   workers: number of concurrent workers (default 3)
 *   queueOnly: skip sync+triage, just process existing queue
 */
export async function startScan(
  workspaceId: string,
  options: ScanOptions,
): Promise<ScanResult> {
  const {
    maxVideos = 0,
    workers = DEFAULT_ANALYSIS_WORKERS,
    queueOnly = false,
    jobId,
  } = options;

  if (!jobId) throw new Error('jobId is required');

  clearProductCache();
  rateLimitBackoffUntil = 0;
  scanAborted = false;

  const creds = await getWorkspaceCredentials(workspaceId);

  if (!creds.googleServiceAccountKey) {
    throw new Error('Google service account key not configured');
  }
  if (!creds.geminiApiKey) {
    throw new Error('Gemini API key not configured');
  }

  let syncResult: SyncResult = { totalInDrive: 0, newFiles: 0, alreadySynced: 0 };
  let triageSummary: TriageSummary = { total: 0, triaged: 0, excluded: 0 };
  let analyzed = 0;
  let errors = 0;
  const startMs = Date.now();

  try {
    if (!queueOnly) {
      // Phase 1: Sync
      syncResult = await syncDriveFiles(workspaceId);

      // Phase 1b: Triage
      triageSummary = await triageVideos(workspaceId);
    }

    // Phase 2: Count total queue size for progress tracking
  const { count: totalQueued } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .in('status', ['triaged', 'reanalysis_needed']);

  const totalToProcess = maxVideos > 0
    ? Math.min(maxVideos, totalQueued ?? 0)
    : (totalQueued ?? 0);

  console.log(`Analysis queue: ${totalQueued} videos, processing ${totalToProcess} with ${workers} workers`);
  await updateScanJobProgress(jobId, { progress: 0, total: totalToProcess });

  // Shared counters (safe with cooperative async — no true parallelism in Node)
  let claimed = 0;

  /**
   * Worker exit reasons — used by supervisor to decide whether to respawn.
   */
  type WorkerExitReason = 'queue_empty' | 'batch_limit' | 'fetch_errors' | 'crashed';

  /**
   * Resilient worker function.
   * - Distinguishes fetch errors from truly empty queue
   * - Requires multiple consecutive empties before exiting
   * - Logs all state transitions for observability
   * - Wrapped in try/catch so unhandled errors don't silently kill the worker
   */
  async function worker(workerId: number): Promise<WorkerExitReason> {
    const hb: WorkerHeartbeat = {
      workerId,
      status: 'starting',
      lastActive: Date.now(),
      videosProcessed: 0,
    };
    workerHeartbeats.set(workerId, hb);

    // Stagger startup to avoid thundering herd on first fetch
    if (workerId > 1) {
      await delay(WORKER_STAGGER_MS * (workerId - 1));
    }

    let emptyStreak = 0;  // consecutive true-empty fetches (no error, 0 results)
    let errorStreak = 0;  // consecutive fetch errors

    try {
      while (true) {
        // Check abort signal
        if (scanAborted) {
          hb.status = 'exited';
          hb.exitReason = 'aborted';
          console.log(`Worker ${workerId}: scan aborted, exiting gracefully`);
          return 'batch_limit'; // reuse batch_limit so supervisor doesn't respawn
        }

        // Check batch limit
        if (maxVideos > 0 && claimed >= maxVideos) {
          hb.status = 'exited';
          hb.exitReason = 'batch_limit';
          console.log(`Worker ${workerId}: batch limit reached (${claimed}/${maxVideos}), exiting`);
          return 'batch_limit';
        }

        // Respect rate-limit backoff
        if (rateLimitBackoffUntil > Date.now()) {
          const waitMs = rateLimitBackoffUntil - Date.now();
          hb.status = 'idle';
          console.log(`Worker ${workerId}: rate-limit backoff, waiting ${Math.ceil(waitMs / 1000)}s`);
          await delay(waitMs);
        }

        // Fetch a batch of candidates
        hb.status = 'fetching';
        hb.lastActive = Date.now();
        const fetchResult = await fetchQueueBatch(workspaceId, 5);

        // Handle fetch error — retry with backoff, do NOT exit
        if (!fetchResult.ok) {
          errorStreak++;
          const backoffMs = Math.min(1000 * errorStreak, 10_000);
          console.warn(
            `Worker ${workerId}: fetch error (streak ${errorStreak}/${WORKER_MAX_ERROR_STREAK}): ${fetchResult.error} — retrying in ${backoffMs}ms`,
          );
          if (errorStreak >= WORKER_MAX_ERROR_STREAK) {
            hb.status = 'exited';
            hb.exitReason = `fetch_errors (${errorStreak} consecutive)`;
            console.error(`Worker ${workerId}: too many consecutive fetch errors (${errorStreak}), exiting`);
            return 'fetch_errors';
          }
          hb.status = 'idle';
          await delay(backoffMs);
          continue;
        }

        // Successful fetch — reset error streak
        errorStreak = 0;
        const batch = fetchResult.videos;

        // Handle truly empty queue — require consecutive empties before exiting
        if (batch.length === 0) {
          emptyStreak++;
          const backoffMs = 2000 * emptyStreak;
          console.log(
            `Worker ${workerId}: empty queue (streak ${emptyStreak}/${WORKER_MAX_EMPTY_STREAK}) — retrying in ${backoffMs}ms`,
          );
          if (emptyStreak >= WORKER_MAX_EMPTY_STREAK) {
            hb.status = 'exited';
            hb.exitReason = 'queue_empty';
            console.log(`Worker ${workerId}: queue confirmed empty after ${emptyStreak} consecutive checks, exiting`);
            return 'queue_empty';
          }
          hb.status = 'idle';
          await delay(backoffMs);
          continue;
        }

        // Got videos — reset empty streak
        emptyStreak = 0;

        let processedAny = false;

        for (const video of batch) {
          // Re-check batch limit
          if (maxVideos > 0 && claimed >= maxVideos) break;

          // Atomic claim
          const didClaim = await claimVideo(video.id);
          if (!didClaim) continue;

          claimed++;
          processedAny = true;
          hb.status = 'processing';
          hb.lastActive = Date.now();
          hb.lastVideoName = video.name;
          await updateScanJobProgress(jobId, {
            progress: analyzed + errors + 1,
            currentFile: video.name,
          });

          let success = false;

          // Retry loop for analysis
          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            if (attempt > 0) {
              console.log(`Worker ${workerId}: retry ${attempt}/${MAX_RETRIES} for ${video.name}`);
              await delay(ANALYSIS_DELAY_MS * (attempt + 1));
            }

            success = await analyzeOneVideo(
              workspaceId,
              video.id,
              video.drive_id,
              video.name,
              video.size_bytes ?? 0,
              creds.googleServiceAccountKey!,
              creds.geminiApiKey!,
            );

            if (success) break;
            if (rateLimitBackoffUntil > Date.now()) break;
          }

          if (success) {
            analyzed++;
            hb.videosProcessed++;
          } else {
            errors++;
          }

          await delay(ANALYSIS_DELAY_MS);
        }

        // If we couldn't claim any, brief pause before re-fetching
        if (!processedAny) {
          hb.status = 'idle';
          await delay(500);
        }
      }
    } catch (err) {
      hb.status = 'crashed';
      hb.exitReason = `unhandled: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`Worker ${workerId}: CRASHED — ${hb.exitReason}`);
      return 'crashed';
    }
  }

  // ── Supervisor: launch workers with stagger, monitor heartbeats, respawn crashes ──

  const numWorkers = Math.min(workers, totalToProcess || 1);
  const respawnCounts = new Map<number, number>(); // workerId → respawn count

  // Heartbeat logger — prints worker summary every WORKER_HEARTBEAT_INTERVAL ms
  const heartbeatTimer = setInterval(() => {
    const now = Date.now();
    const lines: string[] = [];
    for (const [id, hb] of workerHeartbeats.entries()) {
      const ageSec = Math.round((now - hb.lastActive) / 1000);
      lines.push(
        `  W${id}: ${hb.status} | ${hb.videosProcessed} done | last active ${ageSec}s ago` +
        (hb.lastVideoName ? ` | ${hb.lastVideoName}` : '') +
        (hb.exitReason ? ` | exit: ${hb.exitReason}` : ''),
      );
    }
    const activeCount = [...workerHeartbeats.values()].filter(
      (h) => h.status !== 'exited' && h.status !== 'crashed',
    ).length;
    console.log(
      `\n[Heartbeat] ${activeCount}/${numWorkers} workers active | ` +
      `analyzed=${analyzed} errors=${errors} claimed=${claimed}\n${lines.join('\n')}`,
    );
  }, WORKER_HEARTBEAT_INTERVAL);

  /**
   * Run a single worker and handle respawn if it crashes or exits from fetch errors.
   * Workers that exit because the queue is empty or batch limit is reached are NOT respawned.
   */
  async function supervisedWorker(workerId: number): Promise<void> {
    let currentId = workerId;
    while (true) {
      const reason = await worker(currentId);

      // Normal exits — do not respawn
      if (reason === 'queue_empty' || reason === 'batch_limit') {
        return;
      }

      // Abnormal exit (crashed or fetch_errors) — respawn with limit
      const respawns = respawnCounts.get(workerId) ?? 0;
      if (respawns >= WORKER_MAX_RESPAWNS) {
        console.error(
          `Worker ${currentId}: NOT respawning — reached max respawns (${WORKER_MAX_RESPAWNS})`,
        );
        return;
      }

      respawnCounts.set(workerId, respawns + 1);
      const respawnDelay = reason === 'crashed' ? 5000 : 10_000;
      console.log(
        `Worker ${currentId}: respawning in ${respawnDelay / 1000}s (attempt ${respawns + 1}/${WORKER_MAX_RESPAWNS})`,
      );
      await delay(respawnDelay);

      // Keep the same workerId for tracking
      console.log(`Worker ${currentId}: respawned`);
    }
  }

  // Launch all supervised workers
  const supervisorPromises = Array.from(
    { length: numWorkers },
    (_, i) => supervisedWorker(i + 1),
  );
  await Promise.all(supervisorPromises);

  clearInterval(heartbeatTimer);

    if (scanAborted) {
      await abortScanJob(jobId, analyzed + errors);
    } else {
      await completeScanJob(jobId, analyzed + errors);
    }
  } catch (err) {
    console.error('Scan error (completing with partial progress):', err);
    try {
      await completeScanJob(jobId, analyzed + errors);
    } catch (completeErr) {
      console.error('Failed to complete scan job (job may remain running):', completeErr);
    }
  }
  clearProductCache();

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(
    `Scan complete in ${elapsedSec}s. Workers: ${workers}, Analyzed: ${analyzed}, ` +
    `Errors: ${errors}, Excluded by triage: ${triageSummary.excluded}`,
  );

  return { syncResult, triageSummary, analyzed, errors, skipped: triageSummary.excluded };
}
