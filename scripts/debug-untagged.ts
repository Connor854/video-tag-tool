import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

const PRODUCT_FAMILIES = [
  'hammock',
  'picnic blanket',
  'tote bag',
  'travel backpack',
  'foldable backpack',
  'beach towel',
  'beach blanket',
  'hooded towel',
  'protein bar',
  'bug net',
  'tarp',
  'puffy blanket',
  'cooler backpack',
];

// Helper: fetch all rows with pagination to avoid the 1000-row limit
async function fetchAll<T = any>(
  buildQuery: (from: number, to: number) => any,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function pct(n: number, total: number): string {
  if (total === 0) return '0.0%';
  return ((n / total) * 100).toFixed(1) + '%';
}

async function main() {
  console.log('='.repeat(80));
  console.log('DEBUG: Investigating untagged (no-product) analyzed videos');
  console.log('='.repeat(80));

  // ── 1. Overall picture ──────────────────────────────────────────────────────
  console.log('\n── 1. OVERALL PICTURE ──────────────────────────────────────\n');

  const allAnalyzed = await fetchAll((from, to) =>
    supabase
      .from('videos')
      .select('id, products, analysis_mode')
      .eq('status', 'analyzed')
      .range(from, to),
  );

  const totalAnalyzed = allAnalyzed.length;

  const withProducts = allAnalyzed.filter(
    (v) => v.products !== null && Array.isArray(v.products) && v.products.length > 0,
  );
  const withoutProducts = allAnalyzed.filter(
    (v) => v.products === null || !Array.isArray(v.products) || v.products.length === 0,
  );

  console.log(`Total analyzed videos:            ${totalAnalyzed}`);
  console.log(
    `  WITH products:                  ${withProducts.length}  (${pct(withProducts.length, totalAnalyzed)})`,
  );
  console.log(
    `  WITHOUT products:               ${withoutProducts.length}  (${pct(withoutProducts.length, totalAnalyzed)})`,
  );

  // ── 2. Sample 20 videos WITHOUT products ────────────────────────────────────
  console.log('\n── 2. SAMPLE 20 ANALYZED VIDEOS WITHOUT PRODUCTS ──────────\n');

  const noProductIds = withoutProducts.slice(0, 20).map((v) => v.id);

  const { data: noProductSamples, error: sampleErr } = await supabase
    .from('videos')
    .select('id, name, status, analysis_mode, summary, scene, shot_type, content_tags, products')
    .in('id', noProductIds);

  if (sampleErr) throw sampleErr;

  for (const v of noProductSamples ?? []) {
    console.log(`  ID:            ${v.id}`);
    console.log(`  Name:          ${v.name ?? '(null)'}`);
    console.log(`  Status:        ${v.status}`);
    console.log(`  analysis_mode: ${v.analysis_mode ?? '(null)'}`);
    const desc = v.summary ? v.summary.slice(0, 200) : '(null)';
    console.log(`  Summary:       ${desc}`);
    console.log(`  Scene:         ${v.scene ?? '(null)'}`);
    console.log(`  Shot type:     ${v.shot_type ?? '(null)'}`);
    console.log(`  Content tags:  ${JSON.stringify(v.content_tags)}`);
    console.log(
      `  Products col:  ${v.products === null ? 'NULL' : JSON.stringify(v.products)}`,
    );
    console.log('  ---');
  }

  // ── 3. video_products junction table ────────────────────────────────────────
  console.log('\n── 3. VIDEO_PRODUCTS JUNCTION TABLE ───────────────────────\n');

  const allJunction = await fetchAll((from, to) =>
    supabase.from('video_products').select('video_id').range(from, to),
  );

  const totalJunctionRows = allJunction.length;
  const distinctJunctionVideoIds = new Set(allJunction.map((r) => r.video_id));

  console.log(
    `Total rows in video_products:                          ${totalJunctionRows}`,
  );
  console.log(
    `Distinct video_ids with >= 1 video_products row:       ${distinctJunctionVideoIds.size}`,
  );

  const analyzedWithNoJunction = allAnalyzed.filter(
    (v) => !distinctJunctionVideoIds.has(v.id),
  );
  console.log(
    `Analyzed videos with NO video_products row:            ${analyzedWithNoJunction.length}`,
  );

  const analyzedNullProductsButHasJunction = allAnalyzed.filter(
    (v) =>
      (v.products === null ||
        !Array.isArray(v.products) ||
        v.products.length === 0) &&
      distinctJunctionVideoIds.has(v.id),
  );
  console.log(
    `Analyzed videos: have video_products BUT null/empty products col: ${analyzedNullProductsButHasJunction.length}`,
  );

  // ── 4. Cross-ref: video_products rows but empty/null products on videos ─────
  console.log(
    '\n── 4. VIDEOS WITH video_products ENTRIES BUT NULL/EMPTY products COLUMN (sample 10) ──\n',
  );

  const crossRefIds4 = analyzedNullProductsButHasJunction
    .slice(0, 10)
    .map((v) => v.id);
  if (crossRefIds4.length === 0) {
    console.log('  (none found)');
  } else {
    const { data: cr4, error: cr4Err } = await supabase
      .from('videos')
      .select('id, name, products, analysis_mode')
      .in('id', crossRefIds4);
    if (cr4Err) throw cr4Err;

    for (const v of cr4 ?? []) {
      const { data: jRows } = await supabase
        .from('video_products')
        .select('product_id, confidence')
        .eq('video_id', v.id);

      console.log(`  ID: ${v.id}  |  Name: ${v.name ?? '(null)'}`);
      console.log(
        `    products col: ${v.products === null ? 'NULL' : JSON.stringify(v.products)}`,
      );
      console.log(`    analysis_mode: ${v.analysis_mode ?? '(null)'}`);
      console.log(`    video_products rows: ${JSON.stringify(jRows)}`);
      console.log('    ---');
    }
  }

  // ── 5. Cross-ref: non-null products on videos but ZERO video_products entries
  console.log(
    '\n── 5. VIDEOS WITH NON-NULL products COL BUT ZERO video_products ENTRIES ──\n',
  );

  const hasProductsNoJunction = withProducts.filter(
    (v) => !distinctJunctionVideoIds.has(v.id),
  );
  console.log(`  Count: ${hasProductsNoJunction.length}`);

  const sample5 = hasProductsNoJunction.slice(0, 10).map((v) => v.id);
  if (sample5.length > 0) {
    const { data: cr5, error: cr5Err } = await supabase
      .from('videos')
      .select('id, name, products, analysis_mode')
      .in('id', sample5);
    if (cr5Err) throw cr5Err;
    for (const v of cr5 ?? []) {
      console.log(`  ID: ${v.id}  |  Name: ${v.name ?? '(null)'}`);
      console.log(`    products col: ${JSON.stringify(v.products)}`);
      console.log(`    analysis_mode: ${v.analysis_mode ?? '(null)'}`);
      console.log('    ---');
    }
  } else {
    console.log('  (none found)');
  }

  // ── 6. Products that don't match any known product family pattern ───────────
  console.log(
    '\n── 6. PRODUCT STRINGS NOT MATCHING ANY KNOWN PRODUCT FAMILY (sample 20) ──\n',
  );

  const allProductValues = new Set<string>();
  for (const v of withProducts) {
    if (Array.isArray(v.products)) {
      for (const p of v.products) {
        if (typeof p === 'string') allProductValues.add(p);
      }
    }
  }

  const familyPatterns = PRODUCT_FAMILIES.map((f) => f.toLowerCase());
  const unmatched: string[] = [];
  for (const pv of allProductValues) {
    const lower = pv.toLowerCase();
    const matches = familyPatterns.some((fp) => lower.includes(fp));
    if (!matches) unmatched.push(pv);
  }

  console.log(`  Total distinct product strings: ${allProductValues.size}`);
  console.log(`  Unmatched strings:              ${unmatched.length}`);
  const unmatchedSample = unmatched.slice(0, 20);
  for (const u of unmatchedSample) {
    console.log(`    - "${u}"`);
  }

  // ── 7. For the 20 no-product samples, check junction entries ────────────────
  console.log(
    '\n── 7. DO THE 20 NO-PRODUCT SAMPLES HAVE video_products ENTRIES? ──\n',
  );

  for (const id of noProductIds) {
    const { data: jRows, error: jErr } = await supabase
      .from('video_products')
      .select('product_id, confidence')
      .eq('video_id', id);
    if (jErr) throw jErr;
    const name =
      noProductSamples?.find((v) => v.id === id)?.name ?? '(unknown)';
    console.log(
      `  ${id}  ${name}  =>  ${jRows && jRows.length > 0 ? JSON.stringify(jRows) : 'NO junction rows'}`,
    );
  }

  // ── 8. analysis_mode distribution ───────────────────────────────────────────
  console.log('\n── 8. ANALYSIS_MODE DISTRIBUTION ──────────────────────────\n');

  const modeWith: Record<string, number> = {};
  const modeWithout: Record<string, number> = {};

  for (const v of allAnalyzed) {
    const mode = String(v.analysis_mode ?? '(null)');
    const hasP =
      v.products !== null &&
      Array.isArray(v.products) &&
      v.products.length > 0;
    if (hasP) {
      modeWith[mode] = (modeWith[mode] ?? 0) + 1;
    } else {
      modeWithout[mode] = (modeWithout[mode] ?? 0) + 1;
    }
  }

  console.log('  WITH products:');
  for (const [mode, count] of Object.entries(modeWith).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`    ${mode.padEnd(25)} ${count}`);
  }

  console.log('  WITHOUT products:');
  for (const [mode, count] of Object.entries(modeWithout).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`    ${mode.padEnd(25)} ${count}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('Done.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
