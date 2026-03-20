import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  // 1. Count by analysis_mode
  console.log('── SECTION 1: Analysis Mode Distribution ──\n');

  const modes: Record<string, number> = {};
  let from = 0;
  const allVideos: Array<{ id: string; analysis_mode: string | null; size_bytes: number | null; duration_seconds: number | null; name: string }> = [];

  while (true) {
    const { data } = await supabase
      .from('videos')
      .select('id, analysis_mode, size_bytes, duration_seconds, name')
      .eq('status', 'analyzed')
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    allVideos.push(...(data as any[]));
    if (data.length < 1000) break;
    from += 1000;
  }

  for (const v of allVideos) {
    const mode = v.analysis_mode ?? '(null)';
    modes[mode] = (modes[mode] ?? 0) + 1;
  }
  for (const [mode, count] of Object.entries(modes).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${mode}: ${count} (${(count / allVideos.length * 100).toFixed(1)}%)`);
  }

  // 2. For thumbnail videos — size distribution
  const thumbVideos = allVideos.filter(v => String(v.analysis_mode ?? '').includes('thumbnail'));
  const fullVideos = allVideos.filter(v => String(v.analysis_mode ?? '').includes('full_video'));

  console.log(`\n── SECTION 2: Size Distribution (thumbnail vs full_video) ──\n`);

  // Size buckets
  const sizeBuckets = [
    { label: '0 (null/zero)', test: (s: number | null) => !s || s === 0 },
    { label: '1B – 10MB', test: (s: number | null) => s !== null && s > 0 && s <= 10 * 1024 * 1024 },
    { label: '10MB – 50MB', test: (s: number | null) => s !== null && s > 10 * 1024 * 1024 && s <= 50 * 1024 * 1024 },
    { label: '50MB – 100MB', test: (s: number | null) => s !== null && s > 50 * 1024 * 1024 && s <= 100 * 1024 * 1024 },
    { label: '100MB – 200MB', test: (s: number | null) => s !== null && s > 100 * 1024 * 1024 && s <= 200 * 1024 * 1024 },
    { label: '200MB – 500MB', test: (s: number | null) => s !== null && s > 200 * 1024 * 1024 && s <= 500 * 1024 * 1024 },
    { label: '500MB+', test: (s: number | null) => s !== null && s > 500 * 1024 * 1024 },
  ];

  console.log('Thumbnail videos by size:');
  for (const bucket of sizeBuckets) {
    const count = thumbVideos.filter(v => bucket.test(v.size_bytes)).length;
    if (count > 0) console.log(`  ${bucket.label}: ${count}`);
  }

  console.log('\nFull-video videos by size:');
  for (const bucket of sizeBuckets) {
    const count = fullVideos.filter(v => bucket.test(v.size_bytes)).length;
    if (count > 0) console.log(`  ${bucket.label}: ${count}`);
  }

  // 3. Key question: how many thumbnail videos are actually <= 200MB?
  const thumbUnder200 = thumbVideos.filter(v => v.size_bytes && v.size_bytes > 0 && v.size_bytes <= 200 * 1024 * 1024);
  const thumbOver200 = thumbVideos.filter(v => v.size_bytes && v.size_bytes > 200 * 1024 * 1024);
  const thumbZeroSize = thumbVideos.filter(v => !v.size_bytes || v.size_bytes === 0);

  console.log(`\n── SECTION 3: WHY were these routed to thumbnail? ──\n`);
  console.log(`Thumbnail videos total: ${thumbVideos.length}`);
  console.log(`  size_bytes = 0 or null (→ fails sizeBytes > 0 check): ${thumbZeroSize.length}`);
  console.log(`  size_bytes > 200MB (→ too large for Gemini): ${thumbOver200.length}`);
  console.log(`  size_bytes 1-200MB (→ SHOULD have been full_video, likely download/upload failure): ${thumbUnder200.length}`);

  // 4. Duration distribution for thumbnail videos
  console.log(`\n── SECTION 4: Duration Distribution (thumbnail videos) ──\n`);
  const durBuckets = [
    { label: '0 or null', test: (d: number | null) => !d || d === 0 },
    { label: '< 5s', test: (d: number | null) => d !== null && d > 0 && d < 5 },
    { label: '5-30s', test: (d: number | null) => d !== null && d >= 5 && d <= 30 },
    { label: '30s-2m', test: (d: number | null) => d !== null && d > 30 && d <= 120 },
    { label: '2-5m', test: (d: number | null) => d !== null && d > 120 && d <= 300 },
    { label: '5-30m', test: (d: number | null) => d !== null && d > 300 && d <= 1800 },
    { label: '30m+', test: (d: number | null) => d !== null && d > 1800 },
  ];

  for (const bucket of durBuckets) {
    const count = thumbVideos.filter(v => bucket.test(v.duration_seconds)).length;
    if (count > 0) console.log(`  ${bucket.label}: ${count}`);
  }

  // 5. Sample 20 thumbnail videos with full details
  console.log(`\n── SECTION 5: Sample thumbnail-only videos (20) ──\n`);

  // Get a mix: some zero-size, some under-200MB, some over-200MB
  const samples = [
    ...thumbZeroSize.slice(0, 8),
    ...thumbUnder200.slice(0, 8),
    ...thumbOver200.slice(0, 4),
  ].slice(0, 20);

  for (const v of samples) {
    const sizeMB = v.size_bytes ? (v.size_bytes / 1024 / 1024).toFixed(1) : '0';
    const dur = v.duration_seconds ? `${v.duration_seconds.toFixed(1)}s` : 'null';
    console.log(`  ${v.name}`);
    console.log(`    size: ${sizeMB}MB | duration: ${dur} | mode: ${v.analysis_mode}`);
  }

  // 6. Check for processing_error on thumbnail videos (may indicate download failures)
  console.log(`\n── SECTION 6: Error patterns on thumbnail videos ──\n`);

  // Check if any thumbnail videos also have processing_error set
  // (They shouldn't if they succeeded, but let's check)
  const thumbIds = thumbUnder200.slice(0, 100).map(v => v.id);
  if (thumbIds.length > 0) {
    for (let i = 0; i < thumbIds.length; i += 50) {
      const batch = thumbIds.slice(i, i + 50);
      const { data } = await supabase
        .from('videos')
        .select('id, name, processing_error, size_bytes')
        .in('id', batch);
      if (data) {
        const withError = data.filter(v => v.processing_error);
        console.log(`Batch ${i}: ${data.length} checked, ${withError.length} have processing_error`);
        for (const v of withError.slice(0, 5)) {
          console.log(`  ${v.name}: ${v.processing_error}`);
        }
      }
    }
  }

  // 7. Summary statistics
  console.log(`\n── SECTION 7: Root Cause Summary ──\n`);
  const total = thumbVideos.length;
  console.log(`Total thumbnail-only: ${total}`);
  console.log(`  Root cause 1 - size_bytes=0/null (missing metadata): ${thumbZeroSize.length} (${(thumbZeroSize.length/total*100).toFixed(1)}%)`);
  console.log(`  Root cause 2 - genuinely over 200MB: ${thumbOver200.length} (${(thumbOver200.length/total*100).toFixed(1)}%)`);
  console.log(`  Root cause 3 - under 200MB but download/upload failed: ${thumbUnder200.length} (${(thumbUnder200.length/total*100).toFixed(1)}%)`);
}

main().catch(console.error);
