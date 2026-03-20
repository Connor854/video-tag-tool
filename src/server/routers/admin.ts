import { z } from 'zod';
import { router, workspaceProcedure, adminProcedure } from '../trpc.js';
import { getWorkspaceCredentials, saveWorkspaceConnection } from '../../lib/workspace.js';
import { supabase } from '../../lib/supabase.js';
import type { ScanStatus, ScanJob } from '../../shared/types.js';

// ── Scan job helpers (Phase 1: durable progress) ────────────────────────────

function isRetryableSupabaseError(err: { message?: string } | null): boolean {
  if (!err) return false;
  const m = (err.message ?? '').toLowerCase();
  return m.includes('timeout') || m.includes('etimedout') || m.includes('econnreset') || m.includes('network');
}

async function withSupabaseRetry(
  fn: () => Promise<{ error: { message?: string } | null }>,
  maxRetries = 3,
): Promise<{ error: { message?: string } | null }> {
  let result = await fn();
  for (let attempt = 0; result.error && isRetryableSupabaseError(result.error) && attempt < maxRetries; attempt++) {
    const delayMs = Math.min(1000 * 2 ** attempt + Math.random() * 500, 10000);
    console.warn(`Supabase retry ${attempt + 1}/${maxRetries} after ${result.error.message}: waiting ${Math.round(delayMs)}ms`);
    await new Promise((r) => setTimeout(r, delayMs));
    result = await fn();
  }
  return result;
}

export async function getActiveScanJob(workspaceId: string): Promise<ScanJob | null> {
  const { data, error } = await supabase
    .from('scan_jobs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as ScanJob;
}

function jobToScanStatus(job: ScanJob | null): ScanStatus {
  if (!job) {
    return { isScanning: false, progress: 0, total: 0 };
  }
  return {
    isScanning: job.status === 'running',
    progress: job.progress,
    total: job.total,
    currentFile: job.current_file ?? undefined,
    error: job.error_message ?? undefined,
  };
}

export async function updateScanJobProgress(
  jobId: string,
  opts: { progress: number; total?: number; currentFile?: string },
): Promise<void> {
  const update: Record<string, unknown> = {
    progress: opts.progress,
    updated_at: new Date().toISOString(),
  };
  if (opts.total != null) update.total = opts.total;
  if (opts.currentFile != null) update.current_file = opts.currentFile;
  const { error } = await withSupabaseRetry(async () =>
    supabase.from('scan_jobs').update(update).eq('id', jobId).eq('status', 'running'),
  );
  if (error) {
    console.error('updateScanJobProgress failed:', jobId, error);
  }
}

export async function completeScanJob(jobId: string, progress: number): Promise<void> {
  const { error } = await withSupabaseRetry(async () =>
    supabase
      .from('scan_jobs')
      .update({
        status: 'completed',
        progress,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId),
  );
  if (error) {
    console.error('completeScanJob failed:', jobId, error);
  }
}

export async function abortScanJob(jobId: string, progress: number): Promise<void> {
  const { error } = await withSupabaseRetry(async () =>
    supabase
      .from('scan_jobs')
      .update({
        status: 'aborted',
        progress,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('status', 'running'),
  );
  if (error) {
    console.error('abortScanJob failed:', jobId, error);
  }
}

export async function failScanJob(jobId: string, errorMessage: string): Promise<void> {
  const { error } = await withSupabaseRetry(async () =>
    supabase
      .from('scan_jobs')
      .update({
        status: 'failed',
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId),
  );
  if (error) {
    console.error('failScanJob failed:', jobId, error);
  }
}

export const adminRouter = router({
  listProducts: adminProcedure
    .input(
      z.object({
        status: z.enum(['pending', 'approved', 'all']).optional().default('all'),
        search: z.string().optional(),
        category: z.string().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const workspaceId = ctx.workspaceId;
      const status = input?.status ?? 'all';
      const search = input?.search?.trim();
      const category = input?.category?.trim();

      let query = supabase
        .from('products')
        .select('id, name, base_product, category, colorway, image_url, active, approved_at, created_at, updated_at')
        .eq('workspace_id', workspaceId);

      if (status === 'pending') {
        query = query.is('approved_at', null);
      } else if (status === 'approved') {
        query = query.not('approved_at', 'is', null);
      }

      if (search) {
        query = query.ilike('name', `%${search}%`);
      }

      if (category) {
        query = query.eq('category', category);
      }

      const { data, error } = await query
        .order('approved_at', { ascending: true, nullsFirst: true })
        .order('name', { ascending: true });

      if (error) {
        console.error('listProducts failed:', error);
        return { products: [] };
      }

      return { products: data ?? [] };
    }),

  updateProduct: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        base_product: z.string().min(1).optional(),
        category: z.string().min(1).optional(),
        colorway: z.string().nullable().optional(),
      }).refine(
        (data) =>
          data.name !== undefined ||
          data.base_product !== undefined ||
          data.category !== undefined ||
          data.colorway !== undefined,
        { message: 'At least one field (name, base_product, category, colorway) must be provided' },
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const workspaceId = ctx.workspaceId;

      const { data: existing, error: fetchError } = await supabase
        .from('products')
        .select('id, workspace_id')
        .eq('id', input.id)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (fetchError || !existing) {
        return { success: false as const, error: 'Product not found' };
      }

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (input.name !== undefined) updates.name = input.name;
      if (input.base_product !== undefined) updates.base_product = input.base_product;
      if (input.category !== undefined) updates.category = input.category;
      if (input.colorway !== undefined) updates.colorway = input.colorway;

      const { data: updated, error: updateError } = await supabase
        .from('products')
        .update(updates)
        .eq('id', input.id)
        .eq('workspace_id', workspaceId)
        .select('id, name, base_product, category, colorway, image_url, active, approved_at, created_at, updated_at')
        .single();

      if (updateError) {
        if (updateError.code === '23505') {
          return { success: false as const, error: 'Product name already exists in this workspace' };
        }
        console.error('updateProduct failed:', updateError);
        return { success: false as const, error: updateError.message };
      }

      return { success: true as const, product: updated };
    }),

  approveProduct: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const workspaceId = ctx.workspaceId;
      const now = new Date().toISOString();

      const { data: updated, error } = await supabase
        .from('products')
        .update({ approved_at: now, updated_at: now })
        .eq('id', input.id)
        .eq('workspace_id', workspaceId)
        .select('id, name, base_product, category, colorway, image_url, active, approved_at, created_at, updated_at')
        .single();

      if (error || !updated) {
        return { success: false as const, error: 'Product not found' };
      }

      return { success: true as const, product: updated };
    }),

  approveProducts: adminProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const workspaceId = ctx.workspaceId;
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from('products')
        .update({ approved_at: now, updated_at: now })
        .eq('workspace_id', workspaceId)
        .in('id', input.ids)
        .select('id');

      if (error) {
        console.error('approveProducts failed:', error);
        return { success: false as const, error: error.message };
      }

      const approved = data?.length ?? 0;
      return { success: true as const, approved };
    }),

  getSettings: adminProcedure.query(async ({ ctx }) => {
    const workspaceId = ctx.workspaceId;
    const creds = await getWorkspaceCredentials(workspaceId);

    return {
      geminiApiKey: creds.geminiApiKey ?? '',
      googleDriveFolderId: creds.googleDriveFolderId ?? '',
      googleServiceAccountKey: creds.googleServiceAccountKey ?? '',
      shopifyStoreUrl: creds.shopifyStoreUrl ?? '',
      shopifyClientId: creds.shopifyClientId ?? '',
      shopifyClientSecret: creds.shopifyClientSecret ?? '',
      shopifyAccessToken: creds.shopifyAccessToken ?? '',
    };
  }),

  saveSettings: adminProcedure
    .input(
      z.object({
        geminiApiKey: z.string().optional(),
        googleDriveFolderId: z.string().optional(),
        googleServiceAccountKey: z.string().optional(),
        shopifyStoreUrl: z.string().optional(),
        shopifyClientId: z.string().optional(),
        shopifyClientSecret: z.string().optional(),
        shopifyAccessToken: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspaceId = ctx.workspaceId;

      // Save Google Drive connection (credentials + metadata)
      if (input.googleServiceAccountKey !== undefined || input.googleDriveFolderId !== undefined) {
        // Fetch existing to merge partial updates
        const existing = await getWorkspaceCredentials(workspaceId);
        const driveCredentials: Record<string, string> = {};
        const driveMetadata: Record<string, string> = {};

        if (input.googleServiceAccountKey !== undefined) {
          driveCredentials['service_account_key'] = input.googleServiceAccountKey;
        } else if (existing.googleServiceAccountKey) {
          driveCredentials['service_account_key'] = existing.googleServiceAccountKey;
        }

        if (input.googleDriveFolderId !== undefined) {
          driveMetadata['folder_id'] = input.googleDriveFolderId;
        } else if (existing.googleDriveFolderId) {
          driveMetadata['folder_id'] = existing.googleDriveFolderId;
        }

        await saveWorkspaceConnection(workspaceId, 'google_drive', driveCredentials, driveMetadata);
      }

      // Save Gemini connection
      if (input.geminiApiKey !== undefined) {
        await saveWorkspaceConnection(workspaceId, 'gemini', {
          api_key: input.geminiApiKey,
        });
      }

      // Save Shopify connection
      const hasShopifyInput = input.shopifyStoreUrl !== undefined ||
        input.shopifyClientId !== undefined ||
        input.shopifyClientSecret !== undefined ||
        input.shopifyAccessToken !== undefined;

      if (hasShopifyInput) {
        const existing = await getWorkspaceCredentials(workspaceId);
        const shopifyCredentials: Record<string, string> = {};
        const shopifyMetadata: Record<string, string> = {};

        // Client credentials (primary path)
        if (input.shopifyClientId !== undefined) {
          shopifyCredentials['client_id'] = input.shopifyClientId;
        } else if (existing.shopifyClientId) {
          shopifyCredentials['client_id'] = existing.shopifyClientId;
        }

        if (input.shopifyClientSecret !== undefined) {
          shopifyCredentials['client_secret'] = input.shopifyClientSecret;
        } else if (existing.shopifyClientSecret) {
          shopifyCredentials['client_secret'] = existing.shopifyClientSecret;
        }

        // Legacy raw token (backward compat)
        if (input.shopifyAccessToken !== undefined) {
          shopifyCredentials['access_token'] = input.shopifyAccessToken;
        } else if (existing.shopifyAccessToken) {
          shopifyCredentials['access_token'] = existing.shopifyAccessToken;
        }

        // Preserve cached token if not changing credentials
        if (existing.shopifyCachedToken && input.shopifyClientId === undefined && input.shopifyClientSecret === undefined) {
          shopifyCredentials['cached_access_token'] = existing.shopifyCachedToken;
          if (existing.shopifyCachedTokenExpiresAt) {
            shopifyCredentials['cached_token_expires_at'] = existing.shopifyCachedTokenExpiresAt;
          }
        }

        if (input.shopifyStoreUrl !== undefined) {
          shopifyMetadata['store_url'] = input.shopifyStoreUrl;
        } else if (existing.shopifyStoreUrl) {
          shopifyMetadata['store_url'] = existing.shopifyStoreUrl;
        }

        // Tag connection method based on what's provided
        const hasClientCreds = shopifyCredentials['client_id'] && shopifyCredentials['client_secret'];
        shopifyMetadata['connected_via'] = hasClientCreds ? 'client_credentials' : 'manual_token';

        await saveWorkspaceConnection(workspaceId, 'shopify', shopifyCredentials, shopifyMetadata);
      }

      return { success: true };
    }),

  scanStatus: workspaceProcedure.query(async ({ ctx }) => {
    const workspaceId = ctx.workspaceId;
    const job = await getActiveScanJob(workspaceId);
    return jobToScanStatus(job);
  }),

  startScan: adminProcedure
    .input(
      z.object({
        maxVideos: z.number().int().min(0).optional(),
        workers: z.number().int().min(1).max(10).optional(),
        queueOnly: z.boolean().optional(),
      }).optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const workspaceId = ctx.workspaceId;
      const existingJob = await getActiveScanJob(workspaceId);
      if (existingJob) {
        return { success: false, error: 'Scan already in progress' };
      }

      const workers = input?.workers ?? 3;
      const { data: job, error: insertError } = await supabase
        .from('scan_jobs')
        .insert({
          workspace_id: workspaceId,
          status: 'running',
          progress: 0,
          total: 0,
          workers,
        })
        .select('id')
        .single();

      if (insertError || !job) {
        console.error('Failed to create scan job:', insertError);
        return { success: false, error: 'Failed to create scan job' };
      }

      const jobId = job.id;

      const { startScan } = await import('../../services/scanner.js');
      startScan(workspaceId, {
        maxVideos: input?.maxVideos,
        workers,
        queueOnly: input?.queueOnly,
        jobId,
      }).catch((err) => {
        console.error('Scan failed:', err);
        failScanJob(jobId, String(err));
      });

      return { success: true };
    }),

  stopScan: adminProcedure.mutation(async ({ ctx }) => {
    const workspaceId = ctx.workspaceId;
    const job = await getActiveScanJob(workspaceId);
    if (!job) {
      return { success: false, error: 'No scan in progress' };
    }
    const { abortScan } = await import('../../services/scanner.js');
    abortScan();
    return { success: true, message: 'Abort signal sent — workers will stop after current video' };
  }),

  syncShopify: adminProcedure.mutation(async ({ ctx }) => {
    const workspaceId = ctx.workspaceId;
    const creds = await getWorkspaceCredentials(workspaceId);

    if (!creds.shopifyStoreUrl) {
      return { success: false, error: 'Shopify store URL not configured' };
    }

    const hasClientCreds = creds.shopifyClientId && creds.shopifyClientSecret;
    const hasLegacyToken = Boolean(creds.shopifyAccessToken);

    if (!hasClientCreds && !hasLegacyToken) {
      return { success: false, error: 'Shopify not configured — enter Client ID + Client Secret (or a legacy access token)' };
    }

    try {
      const { syncShopifyProducts } = await import('../../services/shopify.js');

      const result = await syncShopifyProducts(workspaceId, {
        storeUrl: creds.shopifyStoreUrl,
        clientId: creds.shopifyClientId,
        clientSecret: creds.shopifyClientSecret,
        accessToken: creds.shopifyAccessToken,
        cachedToken: creds.shopifyCachedToken,
        cachedTokenExpiresAt: creds.shopifyCachedTokenExpiresAt,
      });

      return {
        success: true,
        totalShopifyProducts: result.totalShopifyProducts,
        totalVariants: result.totalVariants,
        inserted: result.inserted,
        updated: result.updated,
        skippedCount: result.skipped.length,
        skipped: result.skipped.slice(0, 30).map((s) => ({
          product: s.shopifyProductTitle,
          variant: s.shopifyVariantTitle,
          reason: s.reason,
        })),
      };
    } catch (err) {
      console.error('Shopify sync failed:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }),

  validateMatches: adminProcedure.mutation(async ({ ctx }) => {
    const workspaceId = ctx.workspaceId;
    const creds = await getWorkspaceCredentials(workspaceId);

    if (!creds.geminiApiKey) {
      return { success: false, error: 'Gemini API key not configured' };
    }

    try {
      const { validateAmberMatches } = await import('../../services/colorwayValidator.js');

      const result = await validateAmberMatches(workspaceId, creds.geminiApiKey);

      return {
        success: true,
        ...result,
      };
    } catch (err) {
      console.error('Validation failed:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }),

  pipelineStats: workspaceProcedure.query(async ({ ctx }) => {
    const workspaceId = ctx.workspaceId;

    const SIZE_BANDS = [
      { label: 'under50MB', min: 1, max: 50 * 1024 * 1024 },
      { label: '50to200MB', min: 50 * 1024 * 1024 + 1, max: 200 * 1024 * 1024 },
      { label: '200MBto1GB', min: 200 * 1024 * 1024 + 1, max: 1024 * 1024 * 1024 },
    ];

    // Paginated count helper — always reliable, avoids Supabase statement timeouts
    async function pCount(filters: { status?: string; analysis_mode?: string; sizeMin?: number; sizeMax?: number }): Promise<number> {
      let total = 0;
      let from = 0;
      const batchSize = 1000;
      while (true) {
        let q = supabase.from('videos').select('id').eq('workspace_id', workspaceId);
        if (filters.status) q = q.eq('status', filters.status);
        if (filters.analysis_mode) q = q.eq('analysis_mode', filters.analysis_mode);
        if (filters.sizeMin != null) q = q.gte('size_bytes', filters.sizeMin);
        if (filters.sizeMax != null) q = q.lte('size_bytes', filters.sizeMax);
        const { data, error } = await q.range(from, from + batchSize - 1);
        if (error || !data || data.length === 0) break;
        total += data.length;
        if (data.length < batchSize) break;
        from += batchSize;
      }
      return total;
    }

    // ── Sequential paginated counts (serialized to avoid connection pool exhaustion) ──
    const syncedCount = await pCount({ status: 'synced' });
    const triagedCount = await pCount({ status: 'triaged' });
    const analyzingCount = await pCount({ status: 'analyzing' });
    const errorCount = await pCount({ status: 'error' });
    const excludedCount = await pCount({ status: 'excluded' });
    const reanalysisCount = await pCount({ status: 'reanalysis_needed' });
    const fullVideoCount = await pCount({ status: 'analyzed', analysis_mode: 'full_video' });
    const thumbnailCount = await pCount({ status: 'analyzed', analysis_mode: 'thumbnail' });
    const thumbSizeLimitCount = await pCount({ status: 'analyzed', analysis_mode: 'thumbnail_size_limit' });

    const analyzedCount = fullVideoCount + thumbnailCount + thumbSizeLimitCount;

    const counts: Record<string, number> = {
      synced: syncedCount, triaged: triagedCount, analyzing: analyzingCount,
      analyzed: analyzedCount, excluded: excludedCount, error: errorCount,
      reanalysis_needed: reanalysisCount,
    };
    const modes: Record<string, number> = {
      full_video: fullVideoCount, thumbnail: thumbnailCount, thumbnail_size_limit: thumbSizeLimitCount,
    };

    // ── Size band counts (also sequential) ──
    const sizeBandQueued: number[] = [];
    const sizeBandCompleted: number[] = [];
    for (const band of SIZE_BANDS) {
      sizeBandQueued.push(await pCount({ status: 'reanalysis_needed', sizeMin: band.min, sizeMax: band.max }));
      sizeBandCompleted.push(await pCount({ status: 'analyzed', analysis_mode: 'full_video', sizeMin: band.min, sizeMax: band.max }));
    }

    // ── Recent activity + timing (single queries, safe to parallel) ──
    const [recentAnalyzed, recentErrors, timingResult] = await Promise.all([
      supabase.from('videos').select('name, analysis_mode, products, indexed_at, size_bytes')
        .eq('workspace_id', workspaceId).eq('status', 'analyzed')
        .not('indexed_at', 'is', null)
        .order('indexed_at', { ascending: false }).limit(20),
      supabase.from('videos').select('name, processing_error, indexed_at, size_bytes')
        .eq('workspace_id', workspaceId).eq('status', 'error').limit(10),
      supabase.from('videos').select('size_bytes, indexed_at')
        .eq('workspace_id', workspaceId).eq('status', 'analyzed').eq('analysis_mode', 'full_video')
        .not('indexed_at', 'is', null)
        .order('indexed_at', { ascending: false }).limit(100),
    ]);
    const timingRows = timingResult.data;

    // Worker count from scan status
    const job = await getActiveScanJob(workspaceId);
    const currentScanStatus = jobToScanStatus(job);

    // Build size band breakdown
    const sizeBands: Record<string, { queued: number; completed: number; avgSeconds: number | null }> = {};
    for (let i = 0; i < SIZE_BANDS.length; i++) {
      sizeBands[SIZE_BANDS[i].label] = {
        queued: sizeBandQueued[i],
        completed: sizeBandCompleted[i],
        avgSeconds: null,
      };
    }

    // Compute avg processing time per size band from recent timing data
    const rows = timingRows ?? [];
    for (const band of SIZE_BANDS) {
      const bandRows = rows
        .filter((r) => r.size_bytes && r.size_bytes >= band.min && r.size_bytes <= band.max && r.indexed_at)
        .sort((a, b) => new Date(b.indexed_at!).getTime() - new Date(a.indexed_at!).getTime());

      if (bandRows.length >= 2) {
        const newest = new Date(bandRows[0].indexed_at!).getTime();
        const oldest = new Date(bandRows[bandRows.length - 1].indexed_at!).getTime();
        const spanMs = newest - oldest;
        if (spanMs > 0) {
          sizeBands[band.label].avgSeconds = Math.round(spanMs / (bandRows.length - 1) / 1000);
        }
      }
    }

    // Compute throughput from recent timestamps
    const recentRows = recentAnalyzed.data ?? [];
    let throughputPerHour = 0;
    if (recentRows.length >= 2) {
      const newest = new Date(recentRows[0].indexed_at!).getTime();
      const oldest = new Date(recentRows[recentRows.length - 1].indexed_at!).getTime();
      const spanMs = newest - oldest;
      if (spanMs > 0) {
        throughputPerHour = Math.round((recentRows.length / spanMs) * 3_600_000);
      }
    }

    // ETA for remaining queue
    const remaining = (counts['triaged'] ?? 0) + (counts['synced'] ?? 0) + (counts['reanalysis_needed'] ?? 0);
    const etaHours = throughputPerHour > 0 ? remaining / throughputPerHour : null;
    const etaCompletionIso = etaHours != null ? new Date(Date.now() + etaHours * 3_600_000).toISOString() : null;

    return {
      counts,
      modes,
      analyzedWithProducts: 0, // Removed: expensive cross-column query, not critical for monitoring
      totalAnalyzed: analyzedCount,
      throughputPerHour,
      remaining,
      etaHours,
      etaCompletionIso,
      sizeBands,
      isScanning: currentScanStatus.isScanning,
      scanProgress: currentScanStatus.progress,
      scanTotal: currentScanStatus.total,
      scanCurrentFile: currentScanStatus.currentFile ?? null,
      recentAnalyzed: recentRows.map((r) => ({
        name: r.name,
        mode: r.analysis_mode ?? '',
        products: (r.products as string[])?.length ?? 0,
        indexedAt: r.indexed_at ?? '',
        sizeMB: r.size_bytes ? Math.round(r.size_bytes / 1024 / 1024) : null,
      })),
      recentErrors: (recentErrors.data ?? []).map((r) => ({
        name: r.name,
        error: r.processing_error ?? '',
        indexedAt: r.indexed_at ?? '',
        sizeMB: r.size_bytes ? Math.round(r.size_bytes / 1024 / 1024) : null,
      })),
    };
  }),
});
