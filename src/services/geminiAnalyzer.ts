import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';
import { supabase } from '../lib/supabase.js';

// ============================================================
// Types
// ============================================================

export interface ProductCandidate {
  name: string;         // What Gemini thinks the product is (exact catalog name if possible)
  category: string;     // Product category: "Hammocks", "Beach Towels", etc.
  colorway: string;     // Colorway guess: "Forest Green", or "" if uncertain
  confidence: string;   // "high" = strong visual evidence, "medium" = likely but not certain, "low" = guess
}

export interface MomentDetection {
  start_seconds: number;
  end_seconds: number;
  label: string;        // Short tag from V1 taxonomy
  description: string;  // One sentence describing what happens
  products_visible: string[];  // Product names visible in this moment
}

export interface VideoAnalysisResult {
  description: string;
  action_intent: string;
  transcript: string;
  products: ProductCandidate[];
  content_tags: string[];
  moments: MomentDetection[];
  scene: string;
  lighting: string;
  audio_type: string;
  people_count: number;
  people_description: string;
  has_logo: boolean;
  has_packaging: boolean;
  is_junk: boolean;
  junk_reason: string;
  competitor_visible: boolean;
}

// ============================================================
// Product context loading (workspace-scoped from products table)
// ============================================================

/**
 * Fetch active products for a workspace and format as prompt context.
 * Returns empty string if no products exist.
 */
export async function getProductContextForWorkspace(workspaceId: string): Promise<string> {
  const { data, error } = await supabase
    .from('products')
    .select('name, base_product, category, colorway')
    .eq('workspace_id', workspaceId)
    .eq('active', true)
    .not('approved_at', 'is', null);

  if (error || !data || data.length === 0) {
    return '';
  }

  const products = data as Array<{ name: string; base_product: string; category: string; colorway: string | null }>;
  const colorways = [...new Set(products.map((p) => p.colorway).filter(Boolean))] as string[];
  const byCategory = new Map<string, string[]>();
  for (const p of products) {
    const list = byCategory.get(p.category) ?? [];
    list.push(p.name);
    byCategory.set(p.category, list);
  }

  const lines: string[] = ['PRODUCT CATALOG:'];
  if (colorways.length > 0) {
    lines.push('\nAvailable Colorways/Designs:');
    lines.push(colorways.join(', '));
  }
  lines.push('\nProduct Categories and Variants:');
  for (const [category, names] of byCategory.entries()) {
    lines.push(`\n${category}:`);
    for (const name of names) {
      lines.push(`  - ${name}`);
    }
  }
  return lines.join('\n');
}

// ============================================================
// V1 content tag taxonomy
// ============================================================

const CONTENT_TAG_TAXONOMY = `
CONTENT TAG TAXONOMY (assign all that apply from this list only):
- talking-to-camera: Person speaking directly to camera
- voiceover: Voice narrating over footage (speaker not on screen)
- product-closeup: Tight shot of product filling most of the frame
- hands-demonstrating: Hands interacting with product (setup, features, use)
- lifestyle-scene: Product in use in a real environment
- static-product-shot: Product alone, minimal movement, studio or styled
- unboxing: Opening packaging, first reveal
- comparison: Side-by-side or A/B with another product
- montage: Multiple quick cuts edited together
- outdoor-broll: Scenic/environmental footage without product focus
- tutorial-demo: Step-by-step instructional content
- group-activity: Multiple people using products together
`.trim();

// ============================================================
// Prompt for full video analysis
// ============================================================

function buildAnalysisPrompt(productContext: string): string {
  return `You are analyzing a video from a brand's video library. Analyze the full video including all visual content and audio.

${productContext}

${CONTENT_TAG_TAXONOMY}

PRODUCT IDENTIFICATION RULES:
- Use EXACT product names from the catalog above when you can identify them.
- For colorway: only claim a specific colorway if the visual pattern/color is clearly distinguishable. Many colorways have similar names but distinct patterns.
- confidence levels:
  - "high": Product type AND colorway are clearly visible and you are confident in the match against the catalog.
  - "medium": Product type is clear but colorway is uncertain, OR you can see the product but not clearly enough to be sure of the exact variant.
  - "low": You are guessing based on partial visibility, context, or filename.
- If you see a product that does NOT match any catalog entry, it may be a competitor — set competitor_visible to true instead of guessing a product name.
- NEVER force a match. An empty products array is better than a wrong one.
- A video can contain multiple products at different confidence levels.

MOMENT DETECTION RULES:
- Identify 3-10 meaningful moments based on scene changes, action changes, product appearances, or notable spoken content.
- Each moment should be a segment someone might want to find independently (typically 3-15 seconds).
- Use labels from the content tag taxonomy above.
- Include timestamps as seconds from video start.
- Moments should not overlap significantly.

JUNK DETECTION:
- Flag is_junk=true if: accidental recording, blank/black screen, test clip, camera pointing at ground/ceiling with no useful content.
- Do NOT flag as junk just because a video is short or has low production quality.
- If junk, provide junk_reason.

TRANSCRIPT RULES:
- Transcribe ALL spoken words you can hear.
- If no speech is audible, set transcript to "".
- Include speaker changes if there are multiple speakers.

Respond with ONLY valid JSON matching this exact schema (no markdown fences, no commentary):
{
  "description": "2-3 sentence summary of the full video",
  "action_intent": "What the video is trying to achieve or show",
  "transcript": "Full transcript of all spoken words, or empty string",
  "products": [
    {
      "name": "Exact catalog product name or best description",
      "category": "Category name from catalog (Hammocks, Beach Towels, etc.)",
      "colorway": "Colorway name or empty string if uncertain",
      "confidence": "high|medium|low"
    }
  ],
  "content_tags": ["tag-from-taxonomy"],
  "moments": [
    {
      "start_seconds": 0,
      "end_seconds": 5,
      "label": "tag-from-taxonomy",
      "description": "One sentence describing this moment",
      "products_visible": ["Product name if visible in this moment"]
    }
  ],
  "scene": "Primary location/setting (Beach, Forest, Indoor, Studio, etc.)",
  "lighting": "natural|studio|mixed|low-light",
  "audio_type": "music|voiceover|dialogue|ambient|silent|mixed",
  "people_count": 0,
  "people_description": "Solo|Couple|Family|Friends|Group|None",
  "has_logo": false,
  "has_packaging": false,
  "is_junk": false,
  "junk_reason": "",
  "competitor_visible": false
}`;
}

// ============================================================
// File upload + polling
// ============================================================

async function uploadAndWaitForProcessing(
  fileManager: GoogleAIFileManager,
  videoBuffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<{ fileUri: string; fileMimeType: string; geminiFileName: string }> {
  const uploadResult = await fileManager.uploadFile(videoBuffer, {
    mimeType,
    displayName: fileName,
  });

  const geminiFileName = uploadResult.file.name;
  let file = uploadResult.file;

  // Poll until processing is complete
  const MAX_WAIT_MS = 300_000; // 5 minutes
  const POLL_INTERVAL_MS = 3_000;
  const startTime = Date.now();

  while (file.state === FileState.PROCESSING) {
    if (Date.now() - startTime > MAX_WAIT_MS) {
      await fileManager.deleteFile(geminiFileName).catch(() => {});
      throw new Error(`Video processing timed out after ${MAX_WAIT_MS / 1000}s for ${fileName}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    file = await fileManager.getFile(geminiFileName);
  }

  if (file.state === FileState.FAILED) {
    await fileManager.deleteFile(geminiFileName).catch(() => {});
    throw new Error(`Video processing failed for ${fileName}: ${file.error?.message ?? 'unknown error'}`);
  }

  return {
    fileUri: file.uri,
    fileMimeType: file.mimeType,
    geminiFileName,
  };
}

// ============================================================
// Default / fallback result
// ============================================================

const DEFAULT_RESULT: VideoAnalysisResult = {
  description: 'Video from the collection.',
  action_intent: '',
  transcript: '',
  products: [],
  content_tags: [],
  moments: [],
  scene: 'Unknown',
  lighting: 'natural',
  audio_type: 'ambient',
  people_count: 0,
  people_description: 'None',
  has_logo: false,
  has_packaging: false,
  is_junk: false,
  junk_reason: '',
  competitor_visible: false,
};

// ============================================================
// Response parsing with validation
// ============================================================

function parseAnalysisResponse(text: string): VideoAnalysisResult {
  let jsonStr = text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(jsonStr);

  return {
    description: parsed.description || DEFAULT_RESULT.description,
    action_intent: parsed.action_intent || '',
    transcript: parsed.transcript || '',
    products: Array.isArray(parsed.products)
      ? parsed.products.map((p: Record<string, unknown>) => ({
          name: String(p.name || ''),
          category: String(p.category || ''),
          colorway: String(p.colorway || ''),
          confidence: ['high', 'medium', 'low'].includes(String(p.confidence))
            ? String(p.confidence)
            : 'low',
        }))
      : [],
    content_tags: Array.isArray(parsed.content_tags)
      ? parsed.content_tags.filter((t: unknown) => typeof t === 'string')
      : [],
    moments: Array.isArray(parsed.moments)
      ? parsed.moments.map((m: Record<string, unknown>) => ({
          start_seconds: Number(m.start_seconds) || 0,
          end_seconds: Number(m.end_seconds) || 0,
          label: String(m.label || ''),
          description: String(m.description || ''),
          products_visible: Array.isArray(m.products_visible) ? m.products_visible : [],
        }))
      : [],
    scene: parsed.scene || 'Unknown',
    lighting: parsed.lighting || 'natural',
    audio_type: parsed.audio_type || 'ambient',
    people_count: typeof parsed.people_count === 'number' ? parsed.people_count : 0,
    people_description: parsed.people_description || 'None',
    has_logo: Boolean(parsed.has_logo),
    has_packaging: Boolean(parsed.has_packaging),
    is_junk: Boolean(parsed.is_junk),
    junk_reason: parsed.junk_reason || '',
    competitor_visible: Boolean(parsed.competitor_visible),
  };
}

// ============================================================
// Main analysis functions
// ============================================================

/**
 * Analyze a video using Gemini's native video input.
 * Uploads the video to Gemini Files API, runs analysis, then cleans up.
 */
export async function analyzeVideoFull(
  videoBuffer: Buffer,
  mimeType: string,
  fileName: string,
  apiKey: string,
  productContext: string,
): Promise<VideoAnalysisResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const fileManager = new GoogleAIFileManager(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  let geminiFileName: string | undefined;

  try {
    // Upload video and wait for processing
    const uploaded = await uploadAndWaitForProcessing(fileManager, videoBuffer, mimeType, fileName);
    geminiFileName = uploaded.geminiFileName;

    // Run analysis
    const result = await model.generateContent([
      buildAnalysisPrompt(productContext),
      {
        fileData: {
          mimeType: uploaded.fileMimeType,
          fileUri: uploaded.fileUri,
        },
      },
    ]);

    return parseAnalysisResponse(result.response.text());
  } catch (err) {
    // Do NOT silently return DEFAULT_RESULT for parse failures.
    // Re-throw so the scanner retry loop can re-attempt the analysis.
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse Gemini response for ${fileName}: ${err.message}`);
    }
    throw err; // Re-throw for retry handling in scanner
  } finally {
    if (geminiFileName) {
      await fileManager.deleteFile(geminiFileName).catch((e) => {
        console.warn(`Failed to delete Gemini file ${geminiFileName}:`, e);
      });
    }
  }
}

/**
 * Fallback: Analyze a video from a single thumbnail image.
 * Used when video download fails or file is too large for upload.
 */
export async function analyzeVideoThumbnail(
  thumbnailBase64: string,
  fileName: string,
  apiKey: string,
  productContext: string,
): Promise<VideoAnalysisResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const thumbnailPrompt = `You are analyzing a single thumbnail frame from a brand's video. This is a THUMBNAIL only — you cannot see the full video or hear audio.

${productContext}

${CONTENT_TAG_TAXONOMY}

Based on this single frame and the filename "${fileName}", provide your best analysis. Since you only have one frame:
- Set transcript to "" (you cannot hear audio)
- Set moments to [] (you cannot see temporal changes)
- Be conservative with product confidence — without seeing the full video, use "low" or "medium" only
- Content tags should be based on what the frame suggests

Respond with ONLY valid JSON (no markdown fences) matching this schema:
{
  "description": "2-3 sentence summary based on the thumbnail",
  "action_intent": "Best guess at what this video shows",
  "transcript": "",
  "products": [{"name": "...", "category": "...", "colorway": "...", "confidence": "low|medium"}],
  "content_tags": ["tag1"],
  "moments": [],
  "scene": "Location/setting",
  "lighting": "natural|studio|mixed|low-light",
  "audio_type": "ambient",
  "people_count": 0,
  "people_description": "Solo|Couple|Family|Friends|Group|None",
  "has_logo": false,
  "has_packaging": false,
  "is_junk": false,
  "junk_reason": "",
  "competitor_visible": false
}`;

  try {
    const result = await model.generateContent([
      thumbnailPrompt,
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: thumbnailBase64,
        },
      },
    ]);

    return parseAnalysisResponse(result.response.text());
  } catch {
    console.error(`Failed to analyze thumbnail for ${fileName}`);
    return DEFAULT_RESULT;
  }
}
