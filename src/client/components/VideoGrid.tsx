import { useState, useCallback, useRef, useEffect } from 'react';
import VideoCard from './VideoCard';
import { VideoDetailModal } from './VideoDetailModal';
import type { Video } from '../../shared/types';
import { Loader2, ChevronDown } from 'lucide-react';

interface VideoGridProps {
  videos: Video[];
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  totalCount: number;
}

export default function VideoGrid({ videos, isLoading, hasMore, onLoadMore, totalCount }: VideoGridProps) {
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Infinite scroll observer
  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    const target = entries[0];
    if (target.isIntersecting && hasMore && !isLoading) {
      onLoadMore();
    }
  }, [hasMore, isLoading, onLoadMore]);

  useEffect(() => {
    const option = {
      root: null,
      rootMargin: '200px',
      threshold: 0,
    };
    const observer = new IntersectionObserver(handleObserver, option);
    if (loadMoreRef.current) observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [handleObserver]);

  if (isLoading && videos.length === 0) {
    return (
      <div className="max-w-[1800px] mx-auto px-4 py-6 flex justify-center">
        <Loader2 className="animate-spin text-nakie-teal" size={32} />
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="max-w-[1800px] mx-auto px-4 py-16 text-center">
        <p className="text-gray-500 text-lg">No videos found matching your search.</p>
        <p className="text-gray-400 text-sm mt-2">Try adjusting your search terms or filters.</p>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-[1800px] mx-auto px-3 py-3">
        {/* Results count */}
        <div className="mb-3 text-sm text-gray-500">
          Showing {videos.length} of {totalCount.toLocaleString()} videos
        </div>
        
        {/* Responsive grid - tighter spacing to fit more cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
          {videos.map((video) => (
            <VideoCard 
              key={video.id} 
              video={video} 
              onClick={() => setSelectedVideo(video)}
            />
          ))}
        </div>

        {/* Load more trigger */}
        <div ref={loadMoreRef} className="py-6 flex justify-center">
          {isLoading && (
            <Loader2 className="animate-spin text-nakie-teal" size={24} />
          )}
          {!isLoading && hasMore && (
            <button
              onClick={onLoadMore}
              className="flex items-center gap-2 px-5 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm"
            >
              Load more videos
              <ChevronDown size={16} />
            </button>
          )}
          {!hasMore && videos.length > 0 && (
            <p className="text-gray-400 text-sm">You've seen all {totalCount.toLocaleString()} videos</p>
          )}
        </div>
      </div>

      {selectedVideo && (
        <VideoDetailModal 
          video={selectedVideo} 
          onClose={() => setSelectedVideo(null)} 
        />
      )}
    </>
  );
}
