import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Save, Play, Loader2, CheckCircle, AlertCircle, RefreshCw, ShieldCheck, Check, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { trpc } from '../trpc';
import PipelineMonitor from './PipelineMonitor';

type ProductStatus = 'pending' | 'approved' | 'all';

interface ProductRow {
  id: string;
  name: string;
  base_product: string;
  category: string;
  colorway: string | null;
  image_url: string | null;
  active: boolean;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AdminPageProps {
  onBack: () => void;
}

export default function AdminPage({ onBack }: AdminPageProps) {
  const [adminSecret, setAdminSecret] = useState(() => localStorage.getItem('adminSecret') ?? '');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [driveFolderId, setDriveFolderId] = useState('');
  const [serviceAccountKey, setServiceAccountKey] = useState('');
  const [shopifyStoreUrl, setShopifyStoreUrl] = useState('');
  const [shopifyClientId, setShopifyClientId] = useState('');
  const [shopifyClientSecret, setShopifyClientSecret] = useState('');
  const [shopifyAccessToken, setShopifyAccessToken] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [initialized, setInitialized] = useState(false);

  const handleAdminSecretChange = (value: string) => {
    setAdminSecret(value);
    if (value) {
      localStorage.setItem('adminSecret', value);
    } else {
      localStorage.removeItem('adminSecret');
    }
  };

  const settingsQuery = trpc.admin.getSettings.useQuery();

  useEffect(() => {
    if (settingsQuery.data && !initialized) {
      setGeminiApiKey(settingsQuery.data.geminiApiKey);
      setDriveFolderId(settingsQuery.data.googleDriveFolderId);
      setServiceAccountKey(settingsQuery.data.googleServiceAccountKey);
      setShopifyStoreUrl(settingsQuery.data.shopifyStoreUrl);
      setShopifyClientId(settingsQuery.data.shopifyClientId);
      setShopifyClientSecret(settingsQuery.data.shopifyClientSecret);
      setShopifyAccessToken(settingsQuery.data.shopifyAccessToken);
      setInitialized(true);
    }
  }, [settingsQuery.data, initialized]);

  const saveMutation = trpc.admin.saveSettings.useMutation({
    onSuccess: () => {
      setSaveMsg('Settings saved!');
      setTimeout(() => setSaveMsg(''), 3000);
    },
  });

  const scanMutation = trpc.admin.startScan.useMutation();
  const scanStatusQuery = trpc.admin.scanStatus.useQuery(undefined, {
    refetchInterval: scanMutation.data?.success ? 2000 : false,
  });

  const utils = trpc.useUtils();
  const shopifySyncMutation = trpc.admin.syncShopify.useMutation({
    onSuccess: () => utils.admin.listProducts.invalidate(),
  });
  const validateMutation = trpc.admin.validateMatches.useMutation();

  const [catalogStatus, setCatalogStatus] = useState<ProductStatus>('pending');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategory, setCatalogCategory] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Pick<ProductRow, 'name' | 'base_product' | 'category' | 'colorway'>>>({});
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const listProductsQuery = trpc.admin.listProducts.useQuery({
    status: catalogStatus,
    search: catalogSearch || undefined,
    category: catalogCategory || undefined,
  });
  const updateProductMutation = trpc.admin.updateProduct.useMutation({
    onMutate: () => setCatalogError(null),
    onSuccess: (data) => {
      if (data?.success === false) {
        setCatalogError(data.error ?? 'Update failed');
      } else {
        setCatalogError(null);
        utils.admin.listProducts.invalidate();
        setEditingId(null);
        setEditDraft({});
      }
    },
    onError: (err) => setCatalogError(err.message ?? 'Update failed'),
  });
  const approveProductMutation = trpc.admin.approveProduct.useMutation({
    onMutate: () => setCatalogError(null),
    onSuccess: (data) => {
      if (data?.success === false) {
        setCatalogError(data.error ?? 'Approve failed');
      } else {
        setCatalogError(null);
        utils.admin.listProducts.invalidate();
      }
    },
    onError: (err) => setCatalogError(err.message ?? 'Approve failed'),
  });
  const approveProductsMutation = trpc.admin.approveProducts.useMutation({
    onMutate: () => setCatalogError(null),
    onSuccess: (data) => {
      if (data?.success === false) {
        setCatalogError(data.error ?? 'Bulk approve failed');
      } else {
        setCatalogError(null);
        utils.admin.listProducts.invalidate();
      }
    },
    onError: (err) => setCatalogError(err.message ?? 'Bulk approve failed'),
  });

  // Product Groups
  const [newGroupName, setNewGroupName] = useState('');
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [membersModalGroupId, setMembersModalGroupId] = useState<string | null>(null);
  const [membersSearch, setMembersSearch] = useState('');
  const [stagedMemberIds, setStagedMemberIds] = useState<Set<string>>(new Set());
  const membersModalInitializedRef = useRef<string | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);

  const listGroupsQuery = trpc.admin.listProductGroups.useQuery();
  const groups = listGroupsQuery.data?.groups ?? [];
  const createGroupMutation = trpc.admin.createProductGroup.useMutation({
    onSuccess: (data) => {
      if (data?.success === false) {
        setGroupsError(data.error ?? 'Create failed');
      } else {
        setGroupsError(null);
        setNewGroupName('');
        utils.admin.listProductGroups.invalidate();
        utils.video.filters.invalidate();
      }
    },
    onError: (err) => setGroupsError(err.message ?? 'Create failed'),
  });
  const updateGroupMutation = trpc.admin.updateProductGroup.useMutation({
    onSuccess: (data) => {
      if (data?.success === false) {
        setGroupsError(data.error ?? 'Rename failed');
      } else {
        setGroupsError(null);
        setRenamingGroupId(null);
        setRenameDraft('');
        utils.admin.listProductGroups.invalidate();
        utils.video.filters.invalidate();
      }
    },
    onError: (err) => setGroupsError(err.message ?? 'Rename failed'),
  });
  const deleteGroupMutation = trpc.admin.deleteProductGroup.useMutation({
    onSuccess: (data) => {
      if (data?.success === false) {
        setGroupsError(data.error ?? 'Delete failed');
      } else {
        setGroupsError(null);
        utils.admin.listProductGroups.invalidate();
        utils.video.filters.invalidate();
      }
    },
    onError: (err) => setGroupsError(err.message ?? 'Delete failed'),
  });
  const setMembersMutation = trpc.admin.setProductGroupMembers.useMutation({
    onSuccess: (data, variables) => {
      if (data?.success === false) {
        setGroupsError(data.error ?? 'Update members failed');
      } else {
        setGroupsError(null);
        setMembersModalGroupId(null);
        utils.admin.listProductGroups.invalidate();
        if (variables?.groupId) utils.admin.getProductsForGroup.invalidate({ groupId: variables.groupId });
      }
    },
    onError: (err) => setGroupsError(err.message ?? 'Update members failed'),
  });

  const productsForGroupQuery = trpc.admin.getProductsForGroup.useQuery(
    { groupId: membersModalGroupId! },
    { enabled: !!membersModalGroupId },
  );
  const approvedProductsQuery = trpc.admin.listProducts.useQuery(
    { status: 'approved' },
    { enabled: !!membersModalGroupId },
  );
  const approvedProducts = (approvedProductsQuery.data?.products ?? []) as ProductRow[];

  // Initialize staged selection when Edit members modal opens (or switches groups)
  useEffect(() => {
    if (!membersModalGroupId) {
      membersModalInitializedRef.current = null;
      setMembersSearch('');
      return;
    }
    const productIds = productsForGroupQuery.data?.productIds ?? [];
    const hasData = productsForGroupQuery.data !== undefined;
    const notYetInitialized = membersModalInitializedRef.current !== membersModalGroupId;
    if (hasData && notYetInitialized) {
      membersModalInitializedRef.current = membersModalGroupId;
      setStagedMemberIds(new Set(productIds));
    }
  }, [membersModalGroupId, productsForGroupQuery.data]);

  const matchesProductSearch = (p: ProductRow, q: string): boolean => {
    if (!q.trim()) return true;
    const lower = q.trim().toLowerCase();
    const fields = [p.name, p.base_product, p.category, p.colorway].filter(Boolean).map(String);
    return fields.some((f) => f.toLowerCase().includes(lower));
  };
  const visibleProducts = approvedProducts.filter((p) => matchesProductSearch(p, membersSearch));
  const visibleProductIds = new Set(visibleProducts.map((p) => p.id));

  const products = (listProductsQuery.data?.products ?? []) as ProductRow[];
  const pendingIds = products.filter((p) => !p.approved_at).map((p) => p.id);

  const handleEditStart = (p: ProductRow) => {
    setCatalogError(null);
    setEditingId(p.id);
    setEditDraft({ name: p.name, base_product: p.base_product, category: p.category, colorway: p.colorway });
  };
  const handleEditSave = () => {
    if (!editingId || !editDraft.name?.trim()) return;
    const payload: { id: string; name?: string; base_product?: string; category?: string; colorway?: string | null } = {
      id: editingId,
    };
    if (editDraft.name !== undefined) payload.name = editDraft.name;
    if (editDraft.base_product !== undefined) payload.base_product = editDraft.base_product;
    if (editDraft.category !== undefined) payload.category = editDraft.category;
    if (editDraft.colorway !== undefined) payload.colorway = editDraft.colorway;
    updateProductMutation.mutate(payload);
  };
  const handleEditCancel = () => {
    setCatalogError(null);
    setEditingId(null);
    setEditDraft({});
  };
  const handleApproveAll = () => {
    if (pendingIds.length === 0) return;
    approveProductsMutation.mutate({ ids: pendingIds });
  };

  const handleSave = () => {
    saveMutation.mutate({
      geminiApiKey,
      googleDriveFolderId: driveFolderId,
      googleServiceAccountKey: serviceAccountKey,
      shopifyStoreUrl,
      shopifyClientId,
      shopifyClientSecret,
      shopifyAccessToken,
    });
  };

  const handleScan = () => {
    scanMutation.mutate();
  };

  const scanStatus = scanStatusQuery.data;

  return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 mb-6 cursor-pointer"
        >
          <ArrowLeft size={16} />
          Back to search
        </button>

        <h1 className="font-heading text-3xl font-bold text-gray-800 mb-8">Admin Settings</h1>

        {/* Pipeline Monitor */}
        <PipelineMonitor />

        {/* Admin Auth */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="font-heading text-xl font-semibold text-gray-800 mb-4">Admin Access</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Admin Secret
            </label>
            <input
              type="password"
              value={adminSecret}
              onChange={(e) => handleAdminSecretChange(e.target.value)}
              placeholder="Enter admin secret to enable write operations"
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-nakie-teal/30"
            />
            <p className="text-xs text-gray-400 mt-1">
              Required to save settings and start scans
            </p>
          </div>
        </div>

        {/* Settings Form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="font-heading text-xl font-semibold text-gray-800 mb-4">API Configuration</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Gemini API Key
              </label>
              <input
                type="password"
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder="Enter your Gemini API key"
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-nakie-teal/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Google Drive Folder ID
              </label>
              <input
                type="text"
                value={driveFolderId}
                onChange={(e) => setDriveFolderId(e.target.value)}
                placeholder="e.g., 1ABC123def456"
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-nakie-teal/30"
              />
              <p className="text-xs text-gray-400 mt-1">
                The folder ID from the Google Drive URL
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Google Service Account Key (JSON)
              </label>
              <textarea
                value={serviceAccountKey}
                onChange={(e) => setServiceAccountKey(e.target.value)}
                placeholder='Paste your service account JSON key here or enter file path'
                rows={4}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-nakie-teal/30"
              />
            </div>

            <hr className="border-gray-100" />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Shopify Store URL
              </label>
              <input
                type="text"
                value={shopifyStoreUrl}
                onChange={(e) => setShopifyStoreUrl(e.target.value)}
                placeholder="your-store.myshopify.com"
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-nakie-teal/30"
              />
              <p className="text-xs text-gray-400 mt-1">
                Your Shopify store domain (e.g., nakie.myshopify.com)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Shopify Client ID
              </label>
              <input
                type="text"
                value={shopifyClientId}
                onChange={(e) => setShopifyClientId(e.target.value)}
                placeholder="e.g., 1a2b3c4d5e6f..."
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-nakie-teal/30"
              />
              <p className="text-xs text-gray-400 mt-1">
                From Dev Dashboard &rarr; your app &rarr; Settings &rarr; Client credentials
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Shopify Client Secret
              </label>
              <input
                type="password"
                value={shopifyClientSecret}
                onChange={(e) => setShopifyClientSecret(e.target.value)}
                placeholder="shpss_..."
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-nakie-teal/30"
              />
              <p className="text-xs text-gray-400 mt-1">
                From Dev Dashboard &rarr; your app &rarr; Settings &rarr; Client credentials
              </p>
            </div>

            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">
                Legacy: raw access token (for old custom apps only)
              </summary>
              <div className="mt-2">
                <input
                  type="password"
                  value={shopifyAccessToken}
                  onChange={(e) => setShopifyAccessToken(e.target.value)}
                  placeholder="shpat_..."
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-nakie-teal/30"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Only needed if you have an existing custom app with a permanent access token
                </p>
              </div>
            </details>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 bg-nakie-green text-white rounded-lg text-sm font-medium hover:bg-nakie-green/90 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save Settings
              </button>
              {saveMsg && (
                <span className="flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle size={14} />
                  {saveMsg}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Scan Control */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="font-heading text-xl font-semibold text-gray-800 mb-4">
            Google Drive Scanner
          </h2>

          <p className="text-sm text-gray-600 mb-4">
            Scan your Google Drive folder for new videos and analyze them with Gemini AI.
          </p>

          {scanStatus?.isScanning && (
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                <span>Scanning... {scanStatus.currentFile}</span>
                <span>{scanStatus.progress} / {scanStatus.total}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-nakie-teal h-2 rounded-full transition-all"
                  style={{
                    width: scanStatus.total > 0
                      ? `${(scanStatus.progress / scanStatus.total) * 100}%`
                      : '0%',
                  }}
                />
              </div>
            </div>
          )}

          {scanStatus?.error && (
            <div className="flex items-center gap-2 text-sm text-red-600 mb-4">
              <AlertCircle size={14} />
              {scanStatus.error}
            </div>
          )}

          <button
            onClick={handleScan}
            disabled={scanStatus?.isScanning || scanMutation.isPending}
            className="flex items-center gap-2 px-5 py-2.5 bg-nakie-teal text-white rounded-lg text-sm font-medium hover:bg-nakie-teal/90 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {scanStatus?.isScanning ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            {scanStatus?.isScanning ? 'Scanning...' : 'Start Scan'}
          </button>
        </div>

        {/* Shopify Sync & Validation */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="font-heading text-xl font-semibold text-gray-800 mb-4">
            Product Matching
          </h2>

          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-600 mb-3">
                Sync products from Shopify to populate product images, then run image-based validation to promote confident matches from amber to green.
              </p>

              <div className="flex items-center gap-3 mb-3">
                <button
                  onClick={() => shopifySyncMutation.mutate()}
                  disabled={shopifySyncMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {shopifySyncMutation.isPending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  Sync Shopify Products
                </button>

                <button
                  onClick={() => validateMutation.mutate()}
                  disabled={validateMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {validateMutation.isPending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <ShieldCheck size={16} />
                  )}
                  Validate Matches
                </button>
              </div>

              {shopifySyncMutation.data?.success && 'inserted' in shopifySyncMutation.data && (() => {
                const syncData = shopifySyncMutation.data as {
                  success: boolean;
                  totalShopifyProducts: number;
                  totalVariants: number;
                  inserted: number;
                  updated: number;
                  skippedCount: number;
                  skipped: { product: string; variant: string; reason: string }[];
                };
                return (
                  <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 mb-2 space-y-2">
                    <div>
                      Synced {syncData.totalShopifyProducts} Shopify products
                      ({syncData.totalVariants} variants).
                      Inserted: <span className="font-medium text-green-700">{syncData.inserted}</span>.
                      Updated: <span className="font-medium text-blue-700">{syncData.updated}</span>.
                      {syncData.skippedCount > 0 && (
                        <> Skipped: <span className="font-medium text-amber-700">{syncData.skippedCount}</span>.</>
                      )}
                    </div>
                    {syncData.skipped.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
                          Show skipped variants ({syncData.skippedCount})
                        </summary>
                        <ul className="mt-1 space-y-1 text-xs text-gray-500 max-h-48 overflow-y-auto">
                          {syncData.skipped.map((s, i) => (
                            <li key={i} className="border-l-2 border-amber-300 pl-2">
                              <span className="font-medium">{s.product}</span>
                              {s.variant !== 'Default Title' && <> / {s.variant}</>}
                              <br />
                              <span className="text-gray-400">{s.reason}</span>
                            </li>
                          ))}
                          {syncData.skippedCount > syncData.skipped.length && (
                            <li className="text-gray-400 italic">
                              ... and {syncData.skippedCount - syncData.skipped.length} more
                            </li>
                          )}
                        </ul>
                      </details>
                    )}
                  </div>
                );
              })()}

              {shopifySyncMutation.data && !shopifySyncMutation.data.success && (
                <div className="flex items-center gap-2 text-sm text-red-600 mb-2">
                  <AlertCircle size={14} />
                  {shopifySyncMutation.data.error}
                </div>
              )}

              {shopifySyncMutation.isError && (
                <div className="flex items-center gap-2 text-sm text-red-600 mb-2">
                  <AlertCircle size={14} />
                  {shopifySyncMutation.error?.message ?? 'Shopify sync request failed'}
                </div>
              )}

              {validateMutation.data?.success && 'total' in validateMutation.data && (
                <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 space-y-1">
                  <div>
                    Checked <span className="font-medium">{validateMutation.data.total}</span> amber matches
                    {validateMutation.data.source && <span className="text-gray-400"> (source: {validateMutation.data.source})</span>}
                  </div>
                  <div>
                    Promoted to green: <span className="font-medium text-green-700">{validateMutation.data.promoted}</span>.
                    Stayed amber: <span className="font-medium text-amber-700">{validateMutation.data.rejected}</span>.
                    Skipped: {validateMutation.data.skipped}.
                    {validateMutation.data.errors > 0 && <span className="text-red-600"> Errors: {validateMutation.data.errors}.</span>}
                  </div>
                </div>
              )}

              {validateMutation.data && !validateMutation.data.success && (
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <AlertCircle size={14} />
                  {validateMutation.data.error}
                </div>
              )}

              {validateMutation.isError && (
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <AlertCircle size={14} />
                  {validateMutation.error?.message ?? 'Validation request failed'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Product Catalog */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="font-heading text-xl font-semibold text-gray-800 mb-4">
            Product Catalog
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            Review and approve products synced from Shopify. Only approved products are used for video analysis and filters.
          </p>

          <div className="flex flex-wrap gap-3 mb-4">
            <select
              value={catalogStatus}
              onChange={(e) => setCatalogStatus(e.target.value as ProductStatus)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-nakie-teal/30"
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="all">All</option>
            </select>
            <input
              type="text"
              placeholder="Search by name"
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-nakie-teal/30"
            />
            <input
              type="text"
              placeholder="Category"
              value={catalogCategory}
              onChange={(e) => setCatalogCategory(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-nakie-teal/30"
            />
            {pendingIds.length > 0 && (
              <button
                onClick={handleApproveAll}
                disabled={approveProductsMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 cursor-pointer"
              >
                {approveProductsMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Approve all ({pendingIds.length})
              </button>
            )}
          </div>

          {catalogError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">
              <AlertCircle size={16} className="flex-shrink-0" />
              {catalogError}
            </div>
          )}

          {listProductsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-8">
              <Loader2 size={16} className="animate-spin" />
              Loading products…
            </div>
          ) : products.length === 0 ? (
            <p className="text-sm text-gray-500 py-8">
              {catalogSearch.trim() || catalogCategory.trim()
                ? 'No products match the current filters.'
                : catalogStatus === 'all'
                  ? 'No products yet. Sync products from Shopify above to start reviewing your catalog.'
                  : catalogStatus === 'pending'
                    ? 'No pending products. Everything currently synced has been approved.'
                    : 'No approved products yet. Sync from Shopify above and approve them in the catalog.'}
            </p>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-12">Img</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Name</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Base</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Category</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Colorway</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-20">Status</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-28">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                        <td className="px-3 py-2">
                          {p.image_url ? (
                            <img src={p.image_url} alt="" className="w-10 h-10 object-cover rounded" />
                          ) : (
                            <span className="w-10 h-10 block bg-gray-100 rounded text-gray-400 text-xs flex items-center justify-center">—</span>
                          )}
                        </td>
                        {editingId === p.id ? (
                          <>
                            <td className="px-3 py-2" colSpan={5}>
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  value={editDraft.name ?? ''}
                                  onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                                  placeholder="Name"
                                  className="px-2 py-1.5 rounded border border-gray-200 text-sm"
                                />
                                <input
                                  value={editDraft.base_product ?? ''}
                                  onChange={(e) => setEditDraft((d) => ({ ...d, base_product: e.target.value }))}
                                  placeholder="Base product"
                                  className="px-2 py-1.5 rounded border border-gray-200 text-sm"
                                />
                                <input
                                  value={editDraft.category ?? ''}
                                  onChange={(e) => setEditDraft((d) => ({ ...d, category: e.target.value }))}
                                  placeholder="Category"
                                  className="px-2 py-1.5 rounded border border-gray-200 text-sm"
                                />
                                <input
                                  value={editDraft.colorway ?? ''}
                                  onChange={(e) => setEditDraft((d) => ({ ...d, colorway: e.target.value || null }))}
                                  placeholder="Colorway"
                                  className="px-2 py-1.5 rounded border border-gray-200 text-sm"
                                />
                              </div>
                            </td>
                            <td className="px-3 py-2" colSpan={1}>
                              <div className="flex gap-1">
                                <button
                                  onClick={handleEditSave}
                                  disabled={updateProductMutation.isPending || !editDraft.name?.trim()}
                                  className="flex items-center gap-1 px-2 py-1 bg-nakie-green text-white rounded text-xs font-medium disabled:opacity-50 cursor-pointer"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={handleEditCancel}
                                  className="flex items-center gap-1 px-2 py-1 border border-gray-200 rounded text-xs cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2 font-medium">{p.name}</td>
                            <td className="px-3 py-2 text-gray-600">{p.base_product}</td>
                            <td className="px-3 py-2 text-gray-600">{p.category}</td>
                            <td className="px-3 py-2 text-gray-600">{p.colorway ?? '—'}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.approved_at ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                                {p.approved_at ? 'Approved' : 'Pending'}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex gap-1">
                                {!p.approved_at && (
                                  <button
                                    onClick={() => approveProductMutation.mutate({ id: p.id })}
                                    disabled={approveProductMutation.isPending}
                                    className="p-1.5 text-green-600 hover:bg-green-50 rounded cursor-pointer"
                                    title="Approve"
                                  >
                                    <Check size={14} />
                                  </button>
                                )}
                                <button
                                  onClick={() => handleEditStart(p)}
                                  className="p-1.5 text-gray-500 hover:bg-gray-100 rounded cursor-pointer"
                                  title="Edit"
                                >
                                  <Pencil size={14} />
                                </button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Product Groups */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="font-heading text-xl font-semibold text-gray-800 mb-4">
            Product Groups
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            Create groups of approved products for use as filters in video search. Only approved products can be added.
          </p>

          <div className="flex flex-wrap gap-2 mb-4">
            <input
              type="text"
              placeholder="New group name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-nakie-teal/30"
            />
            <button
              onClick={() => {
                const name = newGroupName.trim();
                if (!name) return;
                createGroupMutation.mutate({ name });
              }}
              disabled={!newGroupName.trim() || createGroupMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-nakie-teal text-white rounded-lg text-sm font-medium hover:bg-nakie-teal/90 disabled:opacity-50 cursor-pointer"
            >
              {createGroupMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Create Group
            </button>
          </div>

          {groupsError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">
              <AlertCircle size={16} className="flex-shrink-0" />
              {groupsError}
            </div>
          )}

          {listGroupsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
              <Loader2 size={16} className="animate-spin" />
              Loading groups…
            </div>
          ) : groups.length === 0 ? (
            <p className="text-sm text-gray-500 py-6">
              No product groups yet. Create one above to use as a filter in video search.
            </p>
          ) : (
            <ul className="space-y-2">
              {groups.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg border border-gray-100 hover:bg-gray-50/50"
                >
                  {renamingGroupId === g.id ? (
                    <>
                      <input
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        placeholder="Group name"
                        className="flex-1 px-2 py-1 rounded border border-gray-200 text-sm"
                        autoFocus
                      />
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            const name = renameDraft.trim();
                            if (name) updateGroupMutation.mutate({ id: g.id, name });
                          }}
                          disabled={!renameDraft.trim() || updateGroupMutation.isPending}
                          className="px-2 py-1 bg-nakie-green text-white rounded text-xs font-medium disabled:opacity-50 cursor-pointer"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setRenamingGroupId(null);
                            setRenameDraft('');
                          }}
                          className="px-2 py-1 border border-gray-200 rounded text-xs cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-gray-800">{g.name}</span>
                      <span className="text-xs text-gray-500">({g.memberCount} products)</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            setMembersModalGroupId(g.id);
                          }}
                          className="p-1.5 text-gray-500 hover:bg-gray-100 rounded cursor-pointer"
                          title="Edit members"
                        >
                          <Users size={14} />
                        </button>
                        <button
                          onClick={() => {
                            setRenamingGroupId(g.id);
                            setRenameDraft(g.name);
                          }}
                          className="p-1.5 text-gray-500 hover:bg-gray-100 rounded cursor-pointer"
                          title="Rename"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete group "${g.name}"?`)) {
                              deleteGroupMutation.mutate({ id: g.id });
                            }
                          }}
                          disabled={deleteGroupMutation.isPending}
                          className="p-1.5 text-red-500 hover:bg-red-50 rounded cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Edit Members Modal */}
        {membersModalGroupId && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-gray-100">
                <h3 className="font-heading text-lg font-semibold text-gray-800">
                  Edit group members
                </h3>
                <button
                  onClick={() => setMembersModalGroupId(null)}
                  className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 overflow-y-auto flex-1">
                <p className="text-sm text-gray-600 mb-3">
                  Select approved products to include in this group:
                </p>
                {approvedProductsQuery.isLoading || productsForGroupQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 py-8">
                    <Loader2 size={16} className="animate-spin" />
                    Loading…
                  </div>
                ) : approvedProducts.length === 0 ? (
                  <p className="text-sm text-gray-500 py-6">
                    No approved products. Approve products in the Product Catalog first.
                  </p>
                ) : (
                  <>
                    <input
                      type="text"
                      placeholder="Search by name, base, category, colorway…"
                      value={membersSearch}
                      onChange={(e) => setMembersSearch(e.target.value)}
                      className="w-full px-3 py-2 mb-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-nakie-teal/30"
                    />
                    <div className="flex gap-2 mb-3">
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(stagedMemberIds);
                          visibleProductIds.forEach((id) => next.add(id));
                          setStagedMemberIds(next);
                        }}
                        className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                      >
                        Select all visible
                      </button>
                      <button
                        type="button"
                        onClick={() => setStagedMemberIds(new Set())}
                        className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                      >
                        Clear selection
                      </button>
                    </div>
                    <ul className="space-y-2 max-h-64 overflow-y-auto">
                      {visibleProducts.length === 0 ? (
                        <li className="text-sm text-gray-500 py-4">
                          No products match the search.
                        </li>
                      ) : (
                        visibleProducts.map((p) => (
                          <li key={p.id} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id={`member-${p.id}`}
                              checked={stagedMemberIds.has(p.id)}
                              onChange={(e) => {
                                const next = new Set(stagedMemberIds);
                                if (e.target.checked) {
                                  next.add(p.id);
                                } else {
                                  next.delete(p.id);
                                }
                                setStagedMemberIds(next);
                              }}
                              className="rounded border-gray-300"
                            />
                            <label htmlFor={`member-${p.id}`} className="text-sm cursor-pointer flex-1">
                              {p.name}
                              {p.colorway && (
                                <span className="text-gray-500 ml-1">({p.colorway})</span>
                              )}
                            </label>
                          </li>
                        ))
                      )}
                    </ul>
                  </>
                )}
              </div>
              <div className="p-4 border-t border-gray-100 flex gap-2">
                <button
                  onClick={() => setMembersModalGroupId(null)}
                  className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!membersModalGroupId) return;
                    setMembersMutation.mutate({
                      groupId: membersModalGroupId,
                      productIds: [...stagedMemberIds],
                    });
                  }}
                  disabled={setMembersMutation.isPending}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-nakie-teal text-white rounded-lg text-sm font-medium hover:bg-nakie-teal/90 disabled:opacity-50 cursor-pointer"
                >
                  {setMembersMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  Update group members
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
