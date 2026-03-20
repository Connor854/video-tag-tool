import { Search, X } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  value: string;
}

// Common search suggestions based on the video library
const suggestions = [
  'hammock beach',
  'family',
  'UGC compilation',
  'hiking',
  'product demo',
  'golden hour',
  'talking head',
  'sand-free',
  'beach towel',
  'pool',
  'backpack',
  'outdoor',
  'indoor',
  'close-up',
  'lifestyle',
  'aerial',
];

export default function SearchBar({ onSearch, value }: SearchBarProps) {
  const [input, setInput] = useState(value);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInput(value);
  }, [value]);

  // Filter suggestions based on input
  useEffect(() => {
    if (input.length > 0) {
      const filtered = suggestions.filter(s => 
        s.toLowerCase().includes(input.toLowerCase())
      ).slice(0, 6);
      setFilteredSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setShowSuggestions(false);
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSuggestions(false);
    onSearch(input);
  };

  const handleClear = () => {
    setInput('');
    setShowSuggestions(false);
    onSearch('');
    inputRef.current?.focus();
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
    setShowSuggestions(false);
    onSearch(suggestion);
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto relative">
      <div className="relative flex items-center">
        <Search className="absolute left-4 text-gray-400" size={20} />
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => input.length > 0 && setShowSuggestions(filteredSuggestions.length > 0)}
          placeholder="Search videos... try 'hammock', 'beach', 'family', 'UGC'"
          className="w-full pl-12 pr-12 py-4 rounded-2xl bg-white text-gray-800 placeholder-gray-400 shadow-lg focus:outline-none focus:ring-2 focus:ring-white/50 text-base"
        />
        {input && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-14 text-gray-400 hover:text-gray-600 cursor-pointer"
          >
            <X size={18} />
          </button>
        )}
        <button
          type="submit"
          className="absolute right-3 bg-nakie-green text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-nakie-green/90 transition-colors cursor-pointer"
        >
          Search
        </button>
      </div>

      {/* Autocomplete suggestions */}
      {showSuggestions && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-50">
          {filteredSuggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => handleSuggestionClick(suggestion)}
              className="w-full px-4 py-3 text-left text-gray-700 hover:bg-gray-50 flex items-center gap-3 cursor-pointer transition-colors"
            >
              <Search size={16} className="text-gray-400" />
              <span>{suggestion}</span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
