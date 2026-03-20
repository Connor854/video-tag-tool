import { useState } from 'react';
import type { Video } from '../../shared/types';
import { trpc } from '../trpc';
import {
  Copy, ExternalLink, X, Sparkles, Tag, Clock,
  HardDrive, MapPin, Video as VideoIcon, Camera, Sun,
  Volume2, Users, Eye, Package, FolderOpen, Cpu, Check,
} from 'lucide-react';

interface VideoDetailModalProps {
  video: Video;
  onClose: () => void;
}

export function VideoDetailModal({ video, onClose }: VideoDetailModalProps) {
  const [copied, setCopied] = useState(false);

  const momentsQuery = trpc.video.moments.useQuery(
    { videoId: video.id },
    { staleTime: 60_000 },
  );
  const moments = momentsQuery.data ?? [];

  const formatSize = (bytes: number) => {
    if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
  };

  const formatTimestamp = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const copyDriveLink = () => {
    navigator.clipboard.writeText(`https://drive.google.com/file/d/${video.driveFileId}/view`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openInDrive = () => {
    window.open(`https://drive.google.com/file/d/${video.driveFileId}/view`, '_blank');
  };

  const hasDescription = video.description && video.description !== 'No summary available';
  const hasTranscript = Boolean(video.transcript || video.transcriptSummary);
  const transcriptText = video.transcript || video.transcriptSummary;
  const hasTechnicalDetails = video.sceneBackground || video.shotType || video.cameraMotion || video.lighting || video.audioType || video.groupCount > 0;
  const hasBrandPresence = video.hasLogo || video.hasPackaging || video.productColorPattern;

  // Technical detail items — only show those with data
  const technicalItems = [
    video.sceneBackground ? { icon: MapPin, label: 'Scene', value: video.sceneBackground } : null,
    video.shotType ? { icon: Camera, label: 'Shot', value: video.shotType.replace(/_/g, ' ') } : null,
    video.cameraMotion ? { icon: Eye, label: 'Motion', value: video.cameraMotion } : null,
    video.lighting ? { icon: Sun, label: 'Lighting', value: video.lighting.replace(/_/g, ' ') } : null,
    video.audioType ? { icon: Volume2, label: 'Audio', value: video.audioType.replace(/_/g, ' ') } : null,
    video.groupCount > 0 ? { icon: Users, label: 'People', value: `${video.groupCount} (${video.groupType || 'Solo'})` } : null,
  ].filter(Boolean) as { icon: typeof MapPin; label: string; value: string }[];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl h-[90vh] overflow-hidden rounded-2xl flex flex-col bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* ─── TOP HEADER ─── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#f0fdf4' }}>
              <Sparkles size={18} style={{ color: '#0d9488' }} />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 leading-tight">AI Analysis</h2>
              <p className="text-sm text-gray-400 truncate">
                {video.fileName}
                {video.sizeBytes > 0 && <span className="ml-1.5">&middot; {formatSize(video.sizeBytes)}</span>}
                {video.analysisMode && (
                  <span className="ml-1.5">&middot; {video.analysisMode === 'full_video' ? 'Full video' : 'Thumbnail'}</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={copyDriveLink}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy Drive Link'}
            </button>
            <button
              onClick={openInDrive}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
            >
              <ExternalLink size={14} />
              Open in Drive
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer ml-1"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ─── TWO-COLUMN BODY ─── */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* LEFT COLUMN */}
          <div className="flex-1 overflow-y-auto">
            {/* Video Preview */}
            <div className="aspect-video bg-black">
              <iframe
                src={`https://drive.google.com/file/d/${video.driveFileId}/preview`}
                className="w-full h-full"
                allow="autoplay"
                title={video.fileName}
                style={{ border: 'none' }}
              />
            </div>

            {/* Analysis Sections */}
            <div className="p-6 space-y-6">
              {/* Summary */}
              {hasDescription && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Summary</h3>
                  <p className="text-sm text-gray-700 leading-relaxed">{video.description}</p>
                </section>
              )}

              {/* Action / Intent */}
              {video.actionIntent && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Action / Intent</h3>
                  <p className="text-sm text-gray-700 leading-relaxed">{video.actionIntent}</p>
                </section>
              )}

              {/* Audio Transcript */}
              {hasTranscript && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Audio Transcript</h3>
                  <p className="text-sm text-gray-600 leading-relaxed italic">{transcriptText}</p>
                </section>
              )}

              {/* Key Moments */}
              {moments.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Key Moments</h3>
                  <div className="space-y-0">
                    {moments.map((moment, i) => (
                      <div key={i} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                        <span
                          className="flex-shrink-0 px-2 py-0.5 rounded text-xs font-mono font-medium mt-0.5"
                          style={{ backgroundColor: '#f0fdf4', color: '#0d9488' }}
                        >
                          {formatTimestamp(moment.startSeconds)}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm text-gray-700">{moment.label}</p>
                          {moment.description && moment.description !== moment.label && (
                            <p className="text-xs text-gray-400 mt-0.5">{moment.description}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Content Tags */}
              {video.contentTags && video.contentTags.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Content Tags</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {video.contentTags.map((tag, i) => (
                      <span
                        key={i}
                        className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600"
                      >
                        {tag.replace(/-/g, ' ')}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Not yet analyzed state */}
              {!hasDescription && !video.actionIntent && moments.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-400">Not yet analyzed</p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="w-full lg:w-80 flex-shrink-0 overflow-y-auto border-l border-gray-100 bg-gray-50/50">
            <div className="p-5 space-y-5">
              {/* Products Detected */}
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2.5 flex items-center gap-1.5">
                  <Tag size={12} />
                  Products Detected
                </h4>
                {video.products.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {video.products.map((product, i) => (
                      <span
                        key={i}
                        className="px-2.5 py-1 rounded-full text-xs font-medium"
                        style={{ backgroundColor: '#ccfbf1', color: '#0f766e' }}
                      >
                        {product}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">None detected</p>
                )}
              </section>

              {/* Technical Details */}
              {hasTechnicalDetails && (
                <section className="bg-white rounded-xl border border-gray-200 p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                    Technical Details
                  </h4>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    {technicalItems.map((item) => (
                      <div key={item.label} className="flex items-start gap-2">
                        <item.icon size={13} className="text-gray-400 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-wider text-gray-400 leading-tight">{item.label}</p>
                          <p className="text-sm font-medium text-gray-700 capitalize leading-tight mt-0.5">{item.value}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Brand Presence */}
              {hasBrandPresence && (
                <section className="bg-white rounded-xl border border-gray-200 p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                    Brand Presence
                  </h4>
                  <div className="space-y-2">
                    {video.hasLogo && (
                      <div className="flex items-center gap-2 text-sm">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: '#dcfce7' }}>
                          <Check size={11} style={{ color: '#16a34a' }} />
                        </div>
                        <span className="text-gray-700">Logo visible</span>
                      </div>
                    )}
                    {video.hasPackaging && (
                      <div className="flex items-center gap-2 text-sm">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: '#dcfce7' }}>
                          <Check size={11} style={{ color: '#16a34a' }} />
                        </div>
                        <span className="text-gray-700">Packaging visible</span>
                      </div>
                    )}
                    {video.productColorPattern && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-gray-500">Color:</span>
                        <span className="text-gray-700 font-medium">{video.productColorPattern}</span>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Processing Stats */}
              <section className="bg-white rounded-xl border border-gray-200 p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                  Processing Stats
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  {video.duration > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-gray-400">Duration</p>
                      <p className="text-sm font-medium text-gray-700 mt-0.5">{formatDuration(video.duration)}</p>
                    </div>
                  )}
                  {video.sizeBytes > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-gray-400">Size</p>
                      <p className="text-sm font-medium text-gray-700 mt-0.5">{formatSize(video.sizeBytes)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-400">Model</p>
                    <p className="text-sm font-medium text-gray-700 mt-0.5">{video.modelVersion || 'Gemini 2.5 Flash'}</p>
                  </div>
                  {(video.inputTokens > 0 || video.outputTokens > 0) && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-gray-400">Tokens</p>
                      <p className="text-sm font-medium text-gray-700 mt-0.5">
                        {video.inputTokens.toLocaleString()} in / {video.outputTokens.toLocaleString()} out
                      </p>
                    </div>
                  )}
                </div>
              </section>

              {/* Drive Location */}
              {video.folderPath && (
                <section className="bg-white rounded-xl border border-gray-200 p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1.5">
                    <FolderOpen size={12} />
                    Drive Location
                  </h4>
                  <p className="text-xs font-mono text-gray-500 break-all leading-relaxed">
                    {video.folderPath}
                  </p>
                </section>
              )}

              {/* Video ID */}
              <p className="text-center text-[10px] text-gray-300 pt-1">
                {video.id}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
