import { Sparkles } from 'lucide-react';
import SearchBar from './SearchBar';

interface HeaderProps {
  onSearch: (query: string) => void;
  onQuickTag: (tag: string) => void;
  searchQuery: string;
  resultCount?: number;
}

const quickTags = [
  'hammock beach',
  'family',
  'UGC compilation',
  'hiking',
  'product demo',
  'golden hour',
  'talking head',
  'sand-free',
];

export default function Header({ onSearch, onQuickTag, searchQuery, resultCount }: HeaderProps) {
  return (
    <header className="relative overflow-hidden">
      {/* Ocean/beach gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a5c6b] via-[#1b6d7a] to-[#2d8f8f]" />
      <div className="absolute inset-0 opacity-20 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiPjxkZWZzPjxsaW5lYXJHcmFkaWVudCBpZD0iZyIgeDE9IjAlIiB5MT0iMCUiIHgyPSIxMDAlIiB5Mj0iMTAwJSI+PHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6I2ZmZjtzdG9wLW9wYWNpdHk6MC4xIi8+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjojZmZmO3N0b3Atb3BhY2l0eTowIi8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNnKSIvPjwvc3ZnPg==')]" />
      {/* Wave decoration at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-4 bg-cream" style={{ borderRadius: '100% 100% 0 0' }} />

      <div className="relative z-10 max-w-[1600px] mx-auto px-4 pt-3 pb-6">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-white font-heading text-xl font-bold tracking-wider">nakie</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full px-3 py-1 text-xs text-white/90">
            <Sparkles size={12} />
            <span>AI Search</span>
          </div>
        </div>

        {/* Hero text */}
        <div className="text-center mb-3">
          <h1 className="font-heading text-2xl md:text-3xl font-bold text-white mb-2">
            Video Library Search
          </h1>
          <p className="text-white/70 text-sm max-w-xl mx-auto">
            Search by product, scene, mood, or action.
          </p>
        </div>

        {/* Search bar */}
        <SearchBar onSearch={onSearch} value={searchQuery} />

        {/* Result count */}
        {resultCount !== undefined && (
          <div className="text-center mt-2">
            <p className="text-white/70 text-xs">
              <span className="font-semibold text-white">{resultCount.toLocaleString()}</span> videos
            </p>
          </div>
        )}

        {/* Quick tags */}
        <div className="flex flex-wrap justify-center gap-1.5 mt-3">
          {quickTags.map((tag) => (
            <button
              key={tag}
              onClick={() => onQuickTag(tag)}
              className="px-2.5 py-1 rounded-full text-xs text-white/80 bg-white/10 hover:bg-white/20 backdrop-blur-sm transition-colors cursor-pointer"
            >
              {tag}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
