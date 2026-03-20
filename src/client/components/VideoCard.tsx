import { Play, Copy, ExternalLink, MapPin, Tag } from 'lucide-react';
import { useState } from 'react';
import type { Video } from '../../shared/types';

interface VideoCardProps {
  video: Video;
  onClick?: () => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export default function VideoCard({ video, onClick }: VideoCardProps) {
  const [copied, setCopied] = useState(false);

  const thumbnailSrc = `/thumbnail/${video.driveFileId}?size=800`;

  const handleCopyLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(video.driveUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('a')) {
      return;
    }
    onClick?.();
  };

  return (
    <div 
      className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group"
      onClick={handleCardClick}
    >
      {/* Thumbnail - 4:5 aspect with cover (crops to center, no black bars) */}
      <div className="relative aspect-[4/5] bg-gray-100 overflow-hidden">
        <img
          src={thumbnailSrc}
          alt={video.fileName}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        
        {/* Gradient overlay for better text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        
        {/* Play icon on hover */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 transform scale-90 group-hover:scale-100 shadow-lg">
            <Play size={22} className="text-gray-800 ml-1" fill="currentColor" />
          </div>
        </div>
        
        {/* Top badges */}
        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between">
          {/* Product tag */}
          {video.products[0] && (
            <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white/95 text-gray-800 backdrop-blur-sm shadow-sm">
              {video.products[0]}
            </span>
          )}
          {/* Duration */}
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-black/70 text-white shadow-sm">
            {formatDuration(video.duration)}
          </span>
        </div>
        
        {/* Bottom scene tag */}
        {video.sceneBackground && (
          <div className="absolute bottom-2.5 left-2.5">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium bg-white/95 text-gray-700 backdrop-blur-sm shadow-sm">
              <MapPin size={9} />
              {video.sceneBackground}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3">
        {/* Additional tags only - file name hidden in grid */}
        {video.products.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {video.products.slice(0, 3).map((product) => (
              <span
                key={product}
                className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600"
              >
                {product}
              </span>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-1.5 mt-2">
          <button
            onClick={handleCopyLink}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors cursor-pointer"
          >
            <Copy size={10} />
            {copied ? 'Copied' : 'Copy'}
          </button>
          <a
            href={video.driveUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium rounded-md bg-nakie-teal text-white hover:bg-teal-600 transition-colors"
          >
            <ExternalLink size={10} />
            Open
          </a>
        </div>
      </div>
    </div>
  );
}
