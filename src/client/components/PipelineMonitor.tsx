import { trpc } from '../trpc';
import {
  Activity, Clock, Database, AlertTriangle, CheckCircle,
  Filter, Eye, Image, Video, Package, TrendingUp,
  RefreshCw, HardDrive, RotateCcw,
} from 'lucide-react';

function formatEta(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  return `${d}d ${h}h`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const BAND_LABELS: Record<string, string> = {
  under50MB: '< 50 MB',
  '50to200MB': '50–200 MB',
  '200MBto1GB': '200 MB–1 GB',
};

export default function PipelineMonitor() {
  const { data, isLoading } = trpc.admin.pipelineStats.useQuery(undefined, {
    refetchInterval: 10_000,
  });

  if (isLoading || !data) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
        <h2 className="font-heading text-xl font-semibold text-gray-800 mb-4">Pipeline Monitor</h2>
        <div className="text-sm text-gray-400">Loading...</div>
      </div>
    );
  }

  const c = data.counts;
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const analyzedPct = total > 0 ? Math.round(((c['analyzed'] ?? 0) / total) * 100) : 0;
  const productHitPct = data.totalAnalyzed > 0
    ? Math.round((data.analyzedWithProducts / data.totalAnalyzed) * 100)
    : 0;

  const reanalysisQueued = c['reanalysis_needed'] ?? 0;
  const analyzing = c['analyzing'] ?? 0;
  const errors = c['error'] ?? 0;
  const fullVideoCount = data.modes['full_video'] ?? 0;
  const thumbCount = data.modes['thumbnail'] ?? 0;
  const thumbSizeLimitCount = data.modes['thumbnail_size_limit'] ?? 0;

  // Backlog: queued + currently analyzing
  const backlogTotal = reanalysisQueued + analyzing + fullVideoCount;
  const backlogCompleted = fullVideoCount;
  const backlogPct = backlogTotal > 0 ? Math.round((backlogCompleted / backlogTotal) * 100) : 0;
  const backlogSuccessRate = (backlogCompleted + errors) > 0
    ? Math.round((backlogCompleted / (backlogCompleted + errors)) * 100)
    : 100;

  const statusTiles = [
    { label: 'Synced', count: c['synced'] ?? 0, color: '#6b7280', icon: Database },
    { label: 'Triaged', count: c['triaged'] ?? 0, color: '#8b5cf6', icon: Filter },
    { label: 'Reanalysis', count: reanalysisQueued, color: '#0ea5e9', icon: RotateCcw },
    { label: 'Analyzing', count: analyzing, color: '#f59e0b', icon: Activity },
    { label: 'Analyzed', count: c['analyzed'] ?? 0, color: '#10b981', icon: CheckCircle },
    { label: 'Excluded', count: c['excluded'] ?? 0, color: '#9ca3af', icon: Eye },
    { label: 'Errors', count: errors, color: '#ef4444', icon: AlertTriangle },
  ];

  return (
    <div className="space-y-6 mb-6">
      {/* ─── Main Pipeline Card ─── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-heading text-xl font-semibold text-gray-800">Pipeline Monitor</h2>
          <div className="flex items-center gap-3">
            {data.isScanning && (
              <span className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">
                <RefreshCw size={11} className="animate-spin" />
                Scanning{data.scanProgress != null && data.scanTotal ? ` ${data.scanProgress}/${data.scanTotal}` : ''}
              </span>
            )}
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Auto-refresh 10s</span>
          </div>
        </div>

        {/* ─── Status Grid ─── */}
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-3 mb-5">
          {statusTiles.map((tile) => (
            <div
              key={tile.label}
              className="rounded-xl border border-gray-100 p-3 text-center"
            >
              <tile.icon size={14} className="mx-auto mb-1.5" style={{ color: tile.color }} />
              <div className="text-lg font-semibold text-gray-800">{tile.count.toLocaleString()}</div>
              <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: tile.color }}>{tile.label}</div>
            </div>
          ))}
        </div>

        {/* ─── Overall Progress Bar ─── */}
        <div className="mb-5">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
            <span>{(c['analyzed'] ?? 0).toLocaleString()} of {total.toLocaleString()} videos analyzed ({analyzedPct}%)</span>
            <span>{data.remaining.toLocaleString()} remaining in queue</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${analyzedPct}%`,
                background: 'linear-gradient(to right, #0d9488, #10b981)',
              }}
            />
          </div>
        </div>

        {/* ─── Metrics Row ─── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-gray-50 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp size={12} className="text-gray-400" />
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Throughput</span>
            </div>
            <div className="text-base font-semibold text-gray-800">
              {data.throughputPerHour > 0 ? `${data.throughputPerHour}/hr` : '—'}
            </div>
          </div>

          <div className="rounded-xl bg-gray-50 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Clock size={12} className="text-gray-400" />
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">ETA</span>
            </div>
            <div className="text-base font-semibold text-gray-800">
              {data.etaHours != null ? formatEta(data.etaHours) : '—'}
            </div>
            {data.etaCompletionIso && (
              <div className="text-[10px] text-gray-400 mt-0.5">{formatTime(data.etaCompletionIso)}</div>
            )}
          </div>

          <div className="rounded-xl bg-gray-50 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Video size={12} className="text-gray-400" />
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Analysis Modes</span>
            </div>
            <div className="text-base font-semibold text-gray-800">
              {fullVideoCount.toLocaleString()}
              <span className="text-xs text-gray-400 font-normal ml-1">full</span>
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">
              {thumbCount.toLocaleString()} thumb / {thumbSizeLimitCount.toLocaleString()} size-limit
            </div>
          </div>

          <div className="rounded-xl bg-gray-50 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Package size={12} className="text-gray-400" />
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Product Hit Rate</span>
            </div>
            <div className="text-base font-semibold text-gray-800">
              {data.totalAnalyzed > 0 ? `${productHitPct}%` : '—'}
              <span className="text-xs text-gray-400 font-normal ml-1">
                ({data.analyzedWithProducts}/{data.totalAnalyzed})
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Reanalysis Backlog Card ─── */}
      {(reanalysisQueued > 0 || fullVideoCount > 0) && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-heading text-lg font-semibold text-gray-800 flex items-center gap-2">
              <RotateCcw size={16} className="text-sky-500" />
              Reanalysis Backlog
            </h3>
            <span className="text-xs text-gray-400">
              {backlogSuccessRate}% success rate
            </span>
          </div>

          {/* Backlog progress bar */}
          <div className="mb-5">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
              <span>{backlogCompleted.toLocaleString()} completed of {backlogTotal.toLocaleString()} ({backlogPct}%)</span>
              <span>
                {reanalysisQueued.toLocaleString()} queued
                {analyzing > 0 && <> / {analyzing} processing</>}
                {errors > 0 && <> / <span className="text-red-400">{errors} failed</span></>}
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${backlogPct}%`,
                  background: 'linear-gradient(to right, #0284c7, #0ea5e9)',
                }}
              />
            </div>
          </div>

          {/* ─── Size Band Breakdown ─── */}
          <h4 className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-3 flex items-center gap-1.5">
            <HardDrive size={11} className="text-gray-400" />
            Size Band Breakdown
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Object.entries(data.sizeBands).map(([key, band]) => {
              const bandTotal = band.queued + band.completed;
              const bandPct = bandTotal > 0 ? Math.round((band.completed / bandTotal) * 100) : 0;
              return (
                <div key={key} className="rounded-xl border border-gray-100 p-3">
                  <div className="text-xs font-medium text-gray-700 mb-2">{BAND_LABELS[key] ?? key}</div>
                  <div className="flex items-end justify-between mb-2">
                    <div>
                      <span className="text-lg font-semibold text-gray-800">{band.completed.toLocaleString()}</span>
                      <span className="text-xs text-gray-400 ml-1">/ {bandTotal.toLocaleString()}</span>
                    </div>
                    <span className="text-xs text-gray-400">{bandPct}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden mb-2">
                    <div
                      className="h-full rounded-full transition-all duration-500 bg-sky-400"
                      style={{ width: `${bandPct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span>{band.queued.toLocaleString()} queued</span>
                    <span>
                      {band.avgSeconds != null ? `~${band.avgSeconds}s avg` : 'no timing data'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Recent Activity Card ─── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h3 className="font-heading text-lg font-semibold text-gray-800 mb-4">Recent Activity</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Recent Analyzed */}
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">Recent Analyzed</h4>
            <div className="space-y-0 max-h-72 overflow-y-auto">
              {data.recentAnalyzed.length === 0 && (
                <p className="text-xs text-gray-400">No videos analyzed yet</p>
              )}
              {data.recentAnalyzed.map((v, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
                  {v.mode === 'full_video' ? (
                    <Video size={11} className="text-emerald-500 flex-shrink-0" />
                  ) : (
                    <Image size={11} className="text-amber-500 flex-shrink-0" />
                  )}
                  <span className="text-xs text-gray-700 truncate flex-1" title={v.name}>{v.name}</span>
                  {v.sizeMB != null && (
                    <span className="text-[10px] text-gray-300 flex-shrink-0">{v.sizeMB}MB</span>
                  )}
                  <span className="text-[10px] text-gray-400 flex-shrink-0">
                    {v.products > 0 ? `${v.products}p` : '—'}
                  </span>
                  <span className="text-[10px] text-gray-300 flex-shrink-0 w-12 text-right">
                    {v.indexedAt ? timeAgo(v.indexedAt) : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Errors */}
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">Recent Errors</h4>
            <div className="space-y-0 max-h-72 overflow-y-auto">
              {data.recentErrors.length === 0 && (
                <p className="text-xs text-gray-400">No errors</p>
              )}
              {data.recentErrors.map((v, i) => (
                <div key={i} className="py-1.5 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={11} className="text-red-400 flex-shrink-0" />
                    <span className="text-xs text-gray-700 truncate flex-1" title={v.name}>{v.name}</span>
                    {v.sizeMB != null && (
                      <span className="text-[10px] text-gray-300 flex-shrink-0">{v.sizeMB}MB</span>
                    )}
                    <span className="text-[10px] text-gray-300 flex-shrink-0">
                      {v.indexedAt ? timeAgo(v.indexedAt) : ''}
                    </span>
                  </div>
                  <p className="text-[10px] text-red-400 mt-0.5 ml-5 truncate" title={v.error}>{v.error}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
