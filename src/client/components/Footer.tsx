import { Video, Brain, HardDrive, Sparkles } from 'lucide-react';

interface FooterProps {
  totalAnalyzed: number;
  totalVideos: number;
  totalSizeGb: number;
}

export default function Footer({ totalAnalyzed, totalVideos, totalSizeGb }: FooterProps) {
  return (
    <footer className="border-t border-gray-200/60 mt-8">
      {/* Metrics at bottom */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-gray-600">
            <div className="flex items-center gap-1.5">
              <Video size={16} className="text-nakie-teal" />
              <span><strong className="text-gray-800">{totalVideos.toLocaleString()}</strong> videos</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Brain size={16} className="text-nakie-teal" />
              <span><strong className="text-gray-800">{totalAnalyzed.toLocaleString()}</strong> AI-analyzed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <HardDrive size={16} className="text-nakie-teal" />
              <span><strong className="text-gray-800">{totalSizeGb}</strong> GB total</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer branding */}
      <div className="max-w-[1600px] mx-auto px-6 py-6 flex flex-col items-center gap-2">
        <p className="text-sm text-gray-500 font-medium">
          Nakie Video Search · AI-Powered
        </p>
        <p className="flex items-center gap-1.5 text-xs text-gray-400">
          <Sparkles size={12} />
          Powered by Gemini 2.5 Flash · {totalAnalyzed.toLocaleString()} of {totalVideos.toLocaleString()} videos analyzed
        </p>
      </div>
    </footer>
  );
}