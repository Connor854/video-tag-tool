import { useState, useCallback, useEffect } from 'react';
import { Settings } from 'lucide-react';
import Header from './components/Header';
import Filters, { ActiveFilterChips, type FilterState, EMPTY_FILTERS } from './components/Filters';
import VideoGrid from './components/VideoGrid';
import Footer from './components/Footer';
import AdminPage from './components/AdminPage';
import { trpc } from './trpc';

const PAGE_SIZE = 24;

export default function App() {
  const [page, setPage] = useState('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [allVideos, setAllVideos] = useState<any[]>([]);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  const statsQuery = trpc.video.stats.useQuery();
  const filtersQuery = trpc.video.filters.useQuery();

  // Build search params from filter state
  const searchParams = {
    query: searchQuery || undefined,
    products: filters.products.length ? filters.products : undefined,
    colourways: filters.colourways.length ? filters.colourways : undefined,
    contentTags: filters.contentTags.length ? filters.contentTags : undefined,
    scenes: filters.scenes.length ? filters.scenes : undefined,
    lighting: filters.lighting.length ? filters.lighting : undefined,
    groupTypes: filters.groupTypes.length ? filters.groupTypes : undefined,
    shotTypes: filters.shotTypes.length ? filters.shotTypes : undefined,
    cameraMotions: filters.cameraMotions.length ? filters.cameraMotions : undefined,
    audioTypes: filters.audioTypes.length ? filters.audioTypes : undefined,
    hasLogo: filters.hasLogo || undefined,
    hasPackaging: filters.hasPackaging || undefined,
    page: currentPage,
    pageSize: PAGE_SIZE,
  };

  const searchResult = trpc.video.search.useQuery(searchParams);

  // Sync videos when search result changes
  useEffect(() => {
    if (searchResult.data) {
      if (currentPage === 1) {
        // Initial load or new search - replace videos
        setAllVideos(searchResult.data.videos);
      } else {
        // Load more - append new videos
        setAllVideos(prev => {
          const existingIds = new Set(prev.map(v => v.id));
          const newVideos = searchResult.data!.videos.filter(v => !existingIds.has(v.id));
          return [...prev, ...newVideos];
        });
      }
    }
  }, [searchResult.data, currentPage]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setCurrentPage(1);
  }, []);

  const handleQuickTag = useCallback((tag: string) => {
    setSearchQuery(tag);
    setCurrentPage(1);
  }, []);

  const handleFilterChange = useCallback((next: FilterState) => {
    setFilters(next);
    setCurrentPage(1);
  }, []);

  const handleLoadMore = useCallback(() => {
    if (!searchResult.isLoading && searchResult.data) {
      setCurrentPage(prev => prev + 1);
    }
  }, [searchResult.isLoading, searchResult.data]);

  if (page === 'admin') {
    return <AdminPage onBack={() => setPage('search')} />;
  }

  const stats = statsQuery.data;
  const filterOptions = filtersQuery.data;
  const results = searchResult.data;

  const hasMore = results ? allVideos.length < results.total : false;
  const isInitialLoad = searchResult.isLoading && currentPage === 1;

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      {/* Admin link - floating */}
      <button
        onClick={() => setPage('admin')}
        className="fixed bottom-4 right-4 z-50 bg-white shadow-lg border border-gray-200 rounded-full p-3 text-gray-500 hover:text-gray-700 hover:shadow-xl transition-all cursor-pointer"
        title="Admin Settings"
      >
        <Settings size={20} />
      </button>

      <Header
        onSearch={handleSearch}
        onQuickTag={handleQuickTag}
        searchQuery={searchQuery}
        resultCount={results?.total}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left filter rail */}
        {filterOptions && (
          <Filters
            filters={filterOptions}
            selected={filters}
            onChange={handleFilterChange}
          />
        )}

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <ActiveFilterChips selected={filters} onChange={handleFilterChange} />

          <VideoGrid
            videos={allVideos}
            isLoading={isInitialLoad}
            hasMore={hasMore}
            onLoadMore={handleLoadMore}
            totalCount={results?.total ?? 0}
          />
        </main>
      </div>

      <Footer
        totalAnalyzed={stats?.totalAnalyzed ?? 0}
        totalVideos={stats?.totalVideos ?? 0}
        totalSizeGb={stats?.totalSizeGb ?? 0}
      />
    </div>
  );
}
