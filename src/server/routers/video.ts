import { z } from 'zod';
import { router, workspaceProcedure } from '../trpc.js';
import { supabase } from '../../lib/supabase.js';
import type { Video, VideoMoment } from '../../shared/types.js';

// ── Product family normalization ───────────────────────────────────
// Maps the 409 free-form AI product strings down to canonical families.
// `pattern` is matched case-insensitively as a substring against the
// text representation of the products array.
const PRODUCT_FAMILIES = [
  { label: 'Hammock', pattern: 'hammock' },
  { label: 'Picnic Blanket', pattern: 'picnic blanket' },
  { label: 'Tote Bag', pattern: 'tote bag' },
  { label: 'Travel Backpack', pattern: 'travel backpack' },
  { label: 'Foldable Backpack', pattern: 'foldable backpack' },
  { label: 'Single Beach Towel', pattern: 'beach towel' },
  { label: 'Double Beach Towel', pattern: 'beach blanket' },
  { label: 'Hooded Towel', pattern: 'hooded towel' },
  { label: 'Protein Bars', pattern: 'protein bar' },
  { label: 'Bug Net', pattern: 'bug net' },
  { label: 'Tarp', pattern: 'tarp' },
] as const;

interface SupabaseVideo {
  id: string;
  drive_id: string | null;
  name: string;
  folder_id: string | null;
  drive_link: string | null;
  thumbnail_url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  aspect_ratio: string | null;
  status: string | null;
  processing_error: string | null;
  summary: string | null;
  action_intent: string | null;
  transcript: string | null;
  key_moments: unknown | null;
  products: string[] | null;
  best_use: string[] | null;
  content_tags: string[] | null;
  scene: string | null;
  shot_type: string | null;
  motion: string | null;
  lighting: string | null;
  audio_type: string | null;
  people_count: number | null;
  people_description: string | null;
  brand_logo_visible: boolean | null;
  brand_packaging_visible: boolean | null;
  brand_colors: string | null;
  colors: string[] | null;
  mood: string[] | null;
  confidence_products: number | null;
  confidence_scene: number | null;
  confidence_action: number | null;
  confidence_people: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  drive_path: string | null;
  analysis_mode: string | null;
  embedding: string | null;
  indexed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function rowToVideo(row: SupabaseVideo): Video {
  return {
    id: row.id,
    driveFileId: row.drive_id ?? '',
    fileName: row.name,
    description: row.summary ?? '',
    actionIntent: row.action_intent ?? '',
    transcriptSummary: '',
    transcript: row.transcript ?? '',
    products: row.products ?? [],
    suggestions: row.best_use ?? [],
    sceneBackground: row.scene ?? '',
    sceneLocation: '',
    actionTags: [],
    contentTags: row.content_tags ?? [],
    shotType: row.shot_type ?? '',
    cameraMotion: row.motion ?? '',
    lighting: row.lighting ?? '',
    audioType: row.audio_type ?? '',
    groupType: row.people_description ?? '',
    groupCount: row.people_count ?? 0,
    hasLogo: row.brand_logo_visible ?? false,
    hasPackaging: row.brand_packaging_visible ?? false,
    productColorPattern: row.brand_colors ?? '',
    productStatus: row.status ?? 'unknown',
    competitorVisible: false,
    confidenceProducts: row.confidence_products ?? 0,
    confidenceScene: row.confidence_scene ?? 0,
    confidenceAction: row.confidence_action ?? 0,
    confidencePeople: row.confidence_people ?? 0,
    modelVersion: '',
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    duration: row.duration_seconds ?? 0,
    sizeBytes: row.size_bytes ?? 0,
    aspectRatio: row.aspect_ratio ?? '',
    analysisMode: row.analysis_mode ?? '',
    thumbnailUrl: row.thumbnail_url ?? '',
    driveUrl: row.drive_link ?? '',
    folderPath: row.drive_path ?? '',
    analyzedAt: row.indexed_at ?? '',
    createdAt: row.created_at ?? '',
  };
}

export const videoRouter = router({
  search: workspaceProcedure
    .input(
      z.object({
        query: z.string().optional(),
        // Multi-select arrays
        products: z.array(z.string()).optional(),
        colourways: z.array(z.string()).optional(),
        contentTags: z.array(z.string()).optional(),
        scenes: z.array(z.string()).optional(),
        lighting: z.array(z.string()).optional(),
        groupTypes: z.array(z.string()).optional(),
        shotTypes: z.array(z.string()).optional(),
        cameraMotions: z.array(z.string()).optional(),
        audioTypes: z.array(z.string()).optional(),
        // Boolean toggles
        hasLogo: z.boolean().optional(),
        hasPackaging: z.boolean().optional(),
        // Other
        productStatus: z.string().optional(),
        includeUnknown: z.boolean().optional(),
        includeCompetitor: z.boolean().optional(),
        includeExcluded: z.boolean().optional(),
        sortBy: z.enum(['relevance', 'newest', 'oldest', 'largest', 'smallest']).optional(),
        page: z.number().min(1).optional(),
        pageSize: z.number().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const workspaceId = ctx.workspaceId;
      const page = input.page ?? 1;
      const pageSize = input.pageSize ?? 12;
      const offset = (page - 1) * pageSize;

      let query = supabase.from('videos').select('*', { count: 'exact' })
        .eq('workspace_id', workspaceId);

      // Exclude 'excluded' videos by default
      if (!input.includeExcluded) {
        query = query.neq('status', 'excluded');
      }

      // Exclude videos with no Drive ID
      query = query.not('drive_id', 'is', null);

      // Exclude videos with no duration
      query = query.not('duration_seconds', 'is', null);

      // Text search
      if (input.query) {
        const q = input.query.toLowerCase();
        query = query.or(
          `name.ilike.%${q}%,summary.ilike.%${q}%,products.cs.{${q}},scene.ilike.%${q}%`,
        );
      }

      // Product family filter — expand family names to matching raw product strings
      if (input.products?.length) {
        // Fetch raw product strings to classify
        const { data: filterData } = await supabase.rpc('get_filter_options', { p_workspace_id: workspaceId });
        const rawProducts = (filterData?.products ?? []) as string[];

        // Collect all raw product strings matching selected families
        const matchingProducts: string[] = [];
        for (const familyName of input.products) {
          const fam = PRODUCT_FAMILIES.find((f) => f.label === familyName);
          if (fam) {
            for (const raw of rawProducts) {
              if (raw.toLowerCase().includes(fam.pattern)) {
                matchingProducts.push(raw);
              }
            }
          }
        }

        if (matchingProducts.length) {
          query = query.overlaps('products', matchingProducts);
        }
      }

      // Colourway filter — find Shopify product names matching the colourway + family,
      // then match those against the video's products array
      if (input.colourways?.length) {
        const { data: shopifyProducts } = await supabase
          .from('products')
          .select('name, base_product, colorway')
          .eq('workspace_id', workspaceId)
          .eq('active', true)
          .not('approved_at', 'is', null)
          .in('colorway', input.colourways);

        if (shopifyProducts?.length) {
          // If product families are also selected, narrow to those families
          let filtered = shopifyProducts;
          if (input.products?.length) {
            const selectedFamilies = input.products
              .map((name) => PRODUCT_FAMILIES.find((f) => f.label === name))
              .filter(Boolean);
            filtered = shopifyProducts.filter((row) =>
              selectedFamilies.some((fam) =>
                row.base_product?.toLowerCase().includes(fam!.pattern) ||
                row.name?.toLowerCase().includes(fam!.pattern),
              ),
            );
          }
          const productNames = [...new Set(filtered.map((r) => r.name as string))];
          if (productNames.length) {
            query = query.overlaps('products', productNames);
          }
        }
      }

      // Content tags (multi-select, OR)
      if (input.contentTags?.length) {
        const tagOr = input.contentTags.map((t) => `content_tags.cs.{${t}}`).join(',');
        query = query.or(tagOr);
      }

      // Scene / environment (multi-select, OR)
      if (input.scenes?.length) {
        query = query.in('scene', input.scenes);
      }

      // Lighting (multi-select, OR)
      if (input.lighting?.length) {
        query = query.in('lighting', input.lighting);
      }

      // People / group type (multi-select, OR)
      if (input.groupTypes?.length) {
        query = query.in('people_description', input.groupTypes);
      }

      // Shot type (multi-select, OR)
      if (input.shotTypes?.length) {
        query = query.in('shot_type', input.shotTypes);
      }

      // Camera motion (multi-select, OR)
      if (input.cameraMotions?.length) {
        query = query.in('motion', input.cameraMotions);
      }

      // Audio type (multi-select, OR)
      if (input.audioTypes?.length) {
        query = query.in('audio_type', input.audioTypes);
      }

      // Brand signals
      if (input.hasLogo === true) {
        query = query.eq('brand_logo_visible', true);
      }
      if (input.hasPackaging === true) {
        query = query.eq('brand_packaging_visible', true);
      }

      // Sort
      switch (input.sortBy) {
        case 'newest':
          query = query.order('created_at', { ascending: false });
          break;
        case 'oldest':
          query = query.order('created_at', { ascending: true });
          break;
        case 'largest':
          query = query.order('size_bytes', { ascending: false });
          break;
        case 'smallest':
          query = query.order('size_bytes', { ascending: true });
          break;
        default:
          query = query.order('created_at', { ascending: false });
      }

      const { data: rows, error, count } = await query.range(offset, offset + pageSize - 1);

      if (error) {
        console.error('Supabase query error:', error);
        return {
          videos: [],
          total: 0,
          page,
          pageSize,
          totalPages: 0,
        };
      }

      return {
        videos: (rows ?? []).map(rowToVideo),
        total: count ?? 0,
        page,
        pageSize,
        totalPages: Math.ceil((count ?? 0) / pageSize),
      };
    }),

  filters: workspaceProcedure.query(async ({ ctx }): Promise<import('../../shared/types.js').VideoFilters> => {
    const workspaceId = ctx.workspaceId;

    // RPC for products, scenes, shot_types, audio_types, content_tags
    const rpcPromise = supabase.rpc('get_filter_options', { p_workspace_id: workspaceId });

    // Additional distinct queries for fields not in the RPC (read-only, no schema change)
    const lightingPromise = supabase
      .from('videos')
      .select('lighting')
      .eq('workspace_id', workspaceId)
      .neq('status', 'excluded')
      .not('lighting', 'is', null)
      .not('drive_id', 'is', null)
      .limit(1000);

    const motionPromise = supabase
      .from('videos')
      .select('motion')
      .eq('workspace_id', workspaceId)
      .neq('status', 'excluded')
      .not('motion', 'is', null)
      .not('drive_id', 'is', null)
      .limit(1000);

    const peoplePromise = supabase
      .from('videos')
      .select('people_description')
      .eq('workspace_id', workspaceId)
      .neq('status', 'excluded')
      .not('people_description', 'is', null)
      .not('drive_id', 'is', null)
      .limit(1000);

    const [rpcResult, lightingResult, motionResult, peopleResult] =
      await Promise.all([rpcPromise, lightingPromise, motionPromise, peoplePromise]);

    const data = rpcResult.data;
    if (rpcResult.error || !data) {
      console.error('Filter RPC error:', rpcResult.error);
    }

    // Extract distinct values from raw rows
    const distinctLighting = [...new Set((lightingResult.data ?? []).map((r) => r.lighting as string))].sort();
    const distinctMotion = [...new Set((motionResult.data ?? []).map((r) => r.motion as string))].sort();
    const distinctPeople = [...new Set((peopleResult.data ?? []).map((r) => r.people_description as string))].sort();

    // Normalize raw AI product strings → canonical families
    const rawProducts = (data?.products ?? []) as string[];
    const activeProductFamilies = PRODUCT_FAMILIES
      .filter((fam) => rawProducts.some((raw) => raw.toLowerCase().includes(fam.pattern)))
      .map((fam) => fam.label);

    return {
      products: activeProductFamilies,
      scenes: (data?.scenes ?? []).sort(),
      shotTypes: (data?.shot_types ?? []).sort(),
      audioTypes: (data?.audio_types ?? []).sort(),
      groupTypes: distinctPeople,
      contentTags: (data?.content_tags ?? []).sort(),
      lightingTypes: distinctLighting,
      cameraMotions: distinctMotion,
    };
  }),

  // Dynamic colourway options scoped to selected product families
  colourwaysForProducts: workspaceProcedure
    .input(z.object({ products: z.array(z.string()).min(1) }))
    .query(async ({ ctx, input }) => {
      const workspaceId = ctx.workspaceId;

      // Query the products table, filtering base_product or name by family patterns
      const { data, error } = await supabase
        .from('products')
        .select('base_product, colorway, name')
        .eq('workspace_id', workspaceId)
        .eq('active', true)
        .not('approved_at', 'is', null)
        .not('colorway', 'is', null);

      if (error || !data) return [];

      // Keep only rows whose base_product or name matches a selected family
      const selectedFamilies = input.products
        .map((name) => PRODUCT_FAMILIES.find((f) => f.label === name))
        .filter(Boolean);

      const matching = data.filter((row) =>
        selectedFamilies.some((fam) =>
          row.base_product?.toLowerCase().includes(fam!.pattern) ||
          row.name?.toLowerCase().includes(fam!.pattern),
        ),
      );

      return [...new Set(matching.map((r) => r.colorway as string))].sort();
    }),

  stats: workspaceProcedure.query(async ({ ctx }) => {
    const workspaceId = ctx.workspaceId;
    // Run count queries in parallel — all scoped to workspace
    const [totalResult, analyzedResult, excludedResult, thumbnailResult, sizeResult] = await Promise.all([
      supabase.from('videos').select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId),
      supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .not('indexed_at', 'is', null),
      supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('status', 'excluded'),
      supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('analysis_mode', 'thumbnail_fallback'),
      supabase.rpc('get_total_size_bytes', { p_workspace_id: workspaceId }),
    ]);

    return {
      totalVideos: totalResult.count ?? 0,
      totalAnalyzed: analyzedResult.count ?? 0,
      totalExcluded: excludedResult.count ?? 0,
      totalThumbnailFallback: thumbnailResult.count ?? 0,
      totalSizeGb:
        Math.round(((sizeResult.data as number | null) ?? 0) / 1_073_741_824 * 100) / 100,
    };
  }),

  moments: workspaceProcedure
    .input(z.object({ videoId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<VideoMoment[]> => {
      const { data, error } = await supabase
        .from('video_moments')
        .select('start_seconds, end_seconds, label, description')
        .eq('video_id', input.videoId)
        .eq('workspace_id', ctx.workspaceId)
        .order('start_seconds', { ascending: true });

      if (error || !data) return [];

      return data.map((m) => ({
        startSeconds: m.start_seconds ?? 0,
        endSeconds: m.end_seconds ?? null,
        label: m.label ?? '',
        description: m.description ?? '',
      }));
    }),
});
