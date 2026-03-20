export interface VideoMoment {
  startSeconds: number;
  endSeconds: number | null;
  label: string;
  description: string;
}

export interface Video {
  id: string;
  driveFileId: string;
  fileName: string;
  description: string;
  actionIntent: string;
  transcriptSummary: string;
  transcript: string;
  products: string[];
  suggestions: string[];
  sceneBackground: string;
  sceneLocation: string;
  actionTags: string[];
  contentTags: string[];
  shotType: string;
  cameraMotion: string;
  lighting: string;
  audioType: string;
  groupType: string;
  groupCount: number;
  hasLogo: boolean;
  hasPackaging: boolean;
  productColorPattern: string;
  productStatus: string; // 'confirmed' | 'probable' | 'unknown' | 'competitor'
  competitorVisible: boolean;
  confidenceProducts: number;
  confidenceScene: number;
  confidenceAction: number;
  confidencePeople: number;
  modelVersion: string;
  inputTokens: number;
  outputTokens: number;
  duration: number;
  sizeBytes: number;
  aspectRatio: string;
  analysisMode: string; // 'full_video' | 'thumbnail_fallback' | ''
  thumbnailUrl: string;
  driveUrl: string;
  folderPath: string;
  analyzedAt: string;
  createdAt: string;
}

export interface VideoSearchParams {
  query?: string;
  // Product filters
  products?: string[];
  colourways?: string[];
  // Presentation / Structure
  contentTags?: string[];
  // Scene / Environment
  scenes?: string[];
  lighting?: string[];
  // People / Talent
  groupTypes?: string[];
  // Camera / Shot
  shotTypes?: string[];
  cameraMotions?: string[];
  // Audio
  audioTypes?: string[];
  // Product-specific signals
  hasLogo?: boolean;
  hasPackaging?: boolean;
  productStatus?: string;
  // Legacy compat
  includeUnknown?: boolean;
  includeCompetitor?: boolean;
  includeExcluded?: boolean;
  sortBy?: 'relevance' | 'newest' | 'oldest' | 'largest' | 'smallest';
  page?: number;
  pageSize?: number;
}

export interface VideoSearchResult {
  videos: Video[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface VideoFilters {
  products: string[];
  scenes: string[];
  shotTypes: string[];
  audioTypes: string[];
  groupTypes: string[];
  contentTags: string[];
  lightingTypes: string[];
  cameraMotions: string[];
}

export interface VideoStats {
  totalVideos: number;
  totalAnalyzed: number;
  totalExcluded: number;
  totalThumbnailFallback: number;
  totalSizeGb: number;
}

export interface ScanStatus {
  isScanning: boolean;
  progress: number;
  total: number;
  currentFile?: string;
  error?: string;
}

/** DB row for scan_jobs table. */
export interface ScanJob {
  id: string;
  workspace_id: string;
  status: 'running' | 'completed' | 'aborted' | 'failed';
  progress: number;
  total: number;
  current_file: string | null;
  error_message: string | null;
  workers: number;
  started_at: string;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Input for creating a new scan job. */
export interface ScanJobInsert {
  workspace_id: string;
  status: 'running';
  progress: number;
  total: number;
  workers: number;
}

export interface Settings {
  geminiApiKey: string;
  googleDriveFolderId: string;
  googleServiceAccountKey: string;
  shopifyStoreUrl: string;
  shopifyClientId: string;
  shopifyClientSecret: string;
  shopifyAccessToken: string;
}
