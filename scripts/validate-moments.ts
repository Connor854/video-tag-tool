import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

const PRODUCT_FAMILIES = [
  { label: 'Hammock', pattern: 'hammock' },
  { label: 'Picnic Blanket', pattern: 'picnic blanket' },
  { label: 'Puffy Blanket', pattern: 'puffy blanket' },
  { label: 'Single Beach Towel', pattern: 'beach towel' },
  { label: 'Hooded Towel', pattern: 'hooded towel' },
  { label: 'Travel Backpack', pattern: 'travel backpack' },
  { label: 'Cooler Backpack', pattern: 'cooler backpack' },
  { label: 'Tote Bag', pattern: 'tote bag' },
];

// Presentation-style labels to EXCLUDE from product moment analysis
const PRESENTATION_LABELS = new Set([
  'talking-to-camera', 'montage', 'voiceover', 'dialogue',
  'ambient', 'audio', 'offer-intro',
]);

// Candidate moment buckets with keyword matchers per product
// Each matcher: [keywords that must ALL appear] OR function
type Matcher = { any?: string[][]; fn?: (d: string) => boolean };

const CANDIDATES: Record<string, Record<string, Matcher>> = {
  Hammock: {
    'Relaxing in hammock': { any: [['relax', 'hammock'], ['lying', 'hammock'], ['sits', 'hammock'], ['lounging', 'hammock'], ['resting', 'hammock'], ['chilling', 'hammock'], ['reading', 'hammock'], ['enjoying', 'hammock']] },
    'Setting up hammock': { any: [['set up', 'hammock'], ['setting up', 'hammock'], ['sets up', 'hammock'], ['install', 'hammock'], ['hang', 'hammock'], ['hanging', 'hammock'], ['attach', 'hammock'], ['hook', 'hammock']] },
    'Straps around tree': { any: [['strap', 'tree'], ['strap', 'trunk'], ['wrap', 'tree'], ['loop', 'tree'], ['tie', 'tree']] },
    'Clipping carabiners': { any: [['carabiner'], ['clip', 'hook'], ['clips the'], ['clipping']] },
    'Packing into pouch': { any: [['pack', 'pouch'], ['stuff', 'pouch'], ['fold', 'pouch'], ['compress', 'pouch'], ['roll', 'pouch'], ['pack', 'bag'], ['stuff', 'bag'], ['compact', 'hammock'], ['fold', 'hammock', 'small'], ['packing', 'hammock']] },
    'Hammock swinging': { any: [['swing', 'hammock'], ['sway', 'hammock'], ['rock', 'hammock'], ['gently', 'hammock'], ['swinging'], ['swaying']] },
    'Group in hammock': { any: [['couple', 'hammock'], ['group', 'hammock'], ['people', 'hammock'], ['friends', 'hammock'], ['family', 'hammock'], ['children', 'hammock'], ['kids', 'hammock'], ['two', 'hammock'], ['three', 'hammock'], ['together', 'hammock']] },
    'Scenic hammock setup': { any: [['scenic', 'hammock'], ['sunset', 'hammock'], ['overlook', 'hammock'], ['view', 'hammock'], ['landscape', 'hammock'], ['mountain', 'hammock'], ['forest', 'hammock'], ['between', 'tree'], ['between', 'palm']] },
    'Sleeping in hammock': { any: [['sleep', 'hammock'], ['nap', 'hammock'], ['doze', 'hammock'], ['asleep', 'hammock'], ['peacefully', 'hammock']] },
    'Beach / lookout setup': { any: [['beach', 'hammock'], ['ocean', 'hammock'], ['shore', 'hammock'], ['lookout', 'hammock'], ['cliff', 'hammock'], ['waterfall', 'hammock'], ['lake', 'hammock'], ['coastal', 'hammock'], ['seaside', 'hammock']] },
  },
  'Picnic Blanket': {
    'Relaxing on blanket': { any: [['relax', 'blanket'], ['lying', 'blanket'], ['sits', 'blanket'], ['lounging', 'blanket'], ['resting', 'blanket'], ['relaxes', 'blanket'], ['sitting', 'blanket'], ['lie', 'blanket'], ['lay', 'blanket'], ['relaxing', 'blanket']] },
    'Picnic setup scene': { any: [['picnic', 'blanket'], ['picnic', 'setup'], ['picnic', 'spread'], ['outdoor', 'blanket', 'food'], ['park', 'blanket']] },
    'Throwing blanket onto ground': { any: [['throw', 'blanket'], ['toss', 'blanket'], ['unfurl', 'blanket'], ['unfold', 'blanket'], ['spread', 'blanket'], ['lay', 'blanket', 'ground'], ['lay', 'blanket', 'grass'], ['lay', 'blanket', 'sand'], ['opens', 'blanket'], ['unroll', 'blanket']] },
    'Folding with carry strap': { any: [['fold', 'blanket'], ['carry strap'], ['strap', 'blanket'], ['roll', 'blanket'], ['folding'], ['adjustable', 'strap']] },
    'Waterproof backing demo': { any: [['waterproof', 'blanket'], ['waterproof', 'backing'], ['water-resistant', 'blanket'], ['water', 'backing'], ['moisture', 'blanket'], ['wet', 'ground']] },
    'Blanket size demonstration': { any: [['size', 'blanket'], ['large', 'blanket'], ['2m', 'blanket'], ['extra-large', 'blanket'], ['generous', 'size'], ['xl', 'blanket'], ['huge', 'blanket'], ['big', 'blanket']] },
    'Group on blanket': { any: [['couple', 'blanket'], ['group', 'blanket'], ['people', 'blanket'], ['friends', 'blanket'], ['family', 'blanket'], ['children', 'blanket'], ['kids', 'blanket'], ['together', 'blanket'], ['three', 'blanket']] },
    'Food spread on blanket': { any: [['food', 'blanket'], ['snack', 'blanket'], ['drink', 'blanket'], ['eat', 'blanket'], ['cheese', 'blanket'], ['fruit', 'blanket'], ['wine', 'blanket']] },
    'Campfire / sunset blanket scene': { any: [['campfire', 'blanket'], ['sunset', 'blanket'], ['fire', 'blanket'], ['evening', 'blanket'], ['bonfire', 'blanket'], ['dusk', 'blanket'], ['sunset']] },
    'Blanket packed away': { any: [['pack', 'blanket'], ['compact', 'blanket'], ['pouch', 'blanket'], ['roll up', 'blanket'], ['folded', 'blanket'], ['store', 'blanket'], ['portability']] },
  },
  'Puffy Blanket': {
    'Wrapped in blanket outdoors': { any: [['wrap', 'blanket'], ['wrapped', 'blanket'], ['wearing', 'blanket'], ['draped', 'blanket'], ['around', 'shoulder'], ['cape', 'blanket'], ['huddled', 'blanket'], ['cocooned'], ['bundled']] },
    'Showing blanket features': { any: [['feature', 'blanket'], ['showing', 'blanket'], ['present', 'blanket'], ['holds up', 'blanket'], ['display', 'blanket'], ['demonstrate', 'blanket'], ['highlight', 'blanket']] },
    'Compressing into stuff sack': { any: [['compress', 'blanket'], ['stuff sack'], ['stuff', 'pouch'], ['pack', 'blanket'], ['roll', 'blanket'], ['compact', 'blanket'], ['fold', 'blanket']] },
    'Water beading on fabric': { any: [['water', 'bead'], ['water', 'droplet'], ['water-resistant'], ['water resistant'], ['rain', 'blanket'], ['water', 'rolls off'], ['water', 'repel'], ['waterproof']] },
    'Close-up of quilted texture': { any: [['close-up', 'blanket'], ['quilted'], ['texture', 'blanket'], ['pattern', 'blanket'], ['detail', 'blanket'], ['fabric', 'blanket'], ['material', 'blanket']] },
    'Cozy indoor use': { any: [['couch', 'blanket'], ['sofa', 'blanket'], ['indoor', 'blanket'], ['bed', 'blanket'], ['home', 'blanket'], ['living room', 'blanket'], ['cozy', 'blanket'], ['movie', 'blanket']] },
    'Blanket in snow / cold': { any: [['snow', 'blanket'], ['cold', 'blanket'], ['winter', 'blanket'], ['freezing', 'blanket'], ['snowy'], ['icy']] },
    'Scenic outdoor blanket scene': { any: [['scenic', 'blanket'], ['landscape', 'blanket'], ['mountain', 'blanket'], ['forest', 'blanket'], ['sunset', 'blanket'], ['overlook', 'blanket'], ['beach', 'blanket'], ['nature', 'blanket'], ['outdoor', 'blanket']] },
    'Sharing blanket with others': { any: [['couple', 'blanket'], ['share', 'blanket'], ['sharing', 'blanket'], ['together', 'blanket'], ['two', 'blanket'], ['group', 'blanket'], ['family', 'blanket'], ['cuddle', 'blanket']] },
    'Blanket packed on campsite': { any: [['camp', 'blanket'], ['campsite', 'blanket'], ['tent', 'blanket'], ['camping', 'blanket'], ['hike', 'blanket'], ['backpack', 'blanket']] },
  },
  'Single Beach Towel': {
    'Lying on towel at beach': { any: [['lying', 'towel'], ['lie', 'towel'], ['sunbath', 'towel'], ['relaxing', 'towel'], ['relaxes', 'towel'], ['resting', 'towel'], ['lounging', 'towel'], ['lay', 'towel']] },
    'Sand shaking off towel': { any: [['sand', 'shake'], ['sand', 'free'], ['sand-free'], ['sand', 'slides off'], ['sand', 'sticks'], ['sand', 'easily'], ['shaking', 'towel'], ['shake', 'towel']] },
    'Towel rolled into pouch': { any: [['roll', 'towel'], ['pouch', 'towel'], ['rolled', 'pouch'], ['compact', 'towel'], ['packed', 'towel'], ['fold', 'towel'], ['folded', 'towel']] },
    'Size vs standard towel': { any: [['size', 'towel'], ['larger', 'towel'], ['bigger', 'towel'], ['15%', 'larger'], ['standard', 'towel'], ['average', 'towel'], ['compare', 'towel'], ['comparison']] },
    'Quick-dry demonstration': { any: [['dry', 'quick'], ['quick-dry'], ['dries', 'fast'], ['dries', 'quick'], ['fast-dry'], ['drying', 'towel'], ['hung', 'dry'], ['hang', 'dry']] },
    'Group on towel': { any: [['couple', 'towel'], ['group', 'towel'], ['people', 'towel'], ['friends', 'towel'], ['family', 'towel'], ['children', 'towel'], ['kids', 'towel'], ['together', 'towel'], ['child', 'towel']] },
    'Towel hung / drying': { any: [['hung', 'towel'], ['hanging', 'towel'], ['hangs', 'towel'], ['drying', 'line'], ['towel', 'truck'], ['pegged']] },
    'Wrapping in towel': { any: [['wrap', 'towel'], ['wrapped', 'towel'], ['wearing', 'towel'], ['drape', 'towel'], ['around', 'towel'], ['covering', 'towel']] },
    'Towel laid out on beach': { any: [['laid out', 'towel'], ['spread', 'towel'], ['unfolded', 'towel'], ['flat', 'towel', 'sand'], ['towel', 'on the sand'], ['towel', 'beach'], ['beach towel', 'sand']] },
    'Close-up of towel texture / print': { any: [['close-up', 'towel'], ['pattern', 'towel'], ['texture', 'towel'], ['design', 'towel'], ['print', 'towel'], ['detail', 'towel'], ['fabric', 'towel'], ['colour', 'towel'], ['color', 'towel']] },
  },
  'Hooded Towel': {
    'Wearing hooded towel': { any: [['wearing', 'towel'], ['wears', 'towel'], ['puts on', 'towel'], ['dressed in', 'towel'], ['wrapped in', 'towel'], ['modeling', 'towel'], ['models', 'towel'], ['standing', 'towel'], ['posing', 'towel']] },
    'Pulling hood up': { any: [['hood', 'up'], ['hood', 'on'], ['pulls', 'hood'], ['putting', 'hood'], ['places', 'hood'], ['flips', 'hood'], ['adjusts', 'hood']] },
    'Showing pockets / hood / buttons': { any: [['pocket', 'towel'], ['button', 'towel'], ['feature', 'towel'], ['side button'], ['snap', 'towel'], ['pocket'], ['buttons']] },
    'Changing underneath towel': { any: [['chang', 'towel'], ['chang', 'underneath'], ['chang', 'under'], ['dress', 'under'], ['getting dressed'], ['discreet'], ['swimwear', 'towel'], ['bikini', 'towel']] },
    'Kids in hooded towel': { any: [['kid', 'towel'], ['child', 'towel'], ['children', 'towel'], ['toddler', 'towel'], ['boy', 'towel'], ['girl', 'towel'], ['baby', 'towel'], ['little', 'towel']] },
    'Walking from beach / pool': { any: [['walk', 'beach'], ['walk', 'pool'], ['walking', 'beach'], ['walking', 'pool'], ['leaving', 'beach'], ['leaving', 'pool'], ['heads', 'beach'], ['from the water'], ['car park']] },
    'Adult and kids matching towels': { any: [['matching', 'towel'], ['adult', 'kid'], ['parent', 'child'], ['mum', 'kid'], ['mom', 'kid'], ['dad', 'kid'], ['family', 'matching'], ['adult and kid'], ['adult and child']] },
    'Towel wrapped around body': { any: [['wrapped', 'body'], ['wrap', 'body'], ['around', 'body'], ['around', 'waist'], ['towel dress'], ['like a dress'], ['sarong']] },
    'Drying off in towel': { any: [['drying', 'towel'], ['dries', 'towel'], ['dry off'], ['after swim'], ['after surf'], ['coming out', 'water'], ['post-swim'], ['towel off']] },
    'Close-up of towel pattern / details': { any: [['close-up', 'towel'], ['pattern', 'towel'], ['design', 'towel'], ['detail', 'towel'], ['fabric', 'towel'], ['texture', 'towel'], ['logo', 'towel'], ['colour', 'towel']] },
  },
  'Travel Backpack': {
    'Showing compartments / pockets': { any: [['compartment', 'backpack'], ['pocket', 'backpack'], ['compartment'], ['pocket'], ['zipper'], ['interior'], ['section'], ['organiz']] },
    'Packing items into bag': { any: [['pack', 'backpack'], ['packing', 'bag'], ['putting', 'bag'], ['places', 'bag'], ['fits', 'bag'], ['stuff', 'bag'], ['loading', 'bag'], ['pack', 'bag']] },
    'Wearing while walking / hiking': { any: [['wearing', 'backpack'], ['wears', 'backpack'], ['walk', 'backpack'], ['hiking', 'backpack'], ['carrying', 'backpack'], ['on', 'back'], ['wearing', 'bag']] },
    'Laptop sleeve demo': { any: [['laptop', 'sleeve'], ['laptop', 'compartment'], ['laptop', 'pocket'], ['laptop'], ['computer']] },
    'Water bottle pocket': { any: [['water bottle', 'pocket'], ['water bottle', 'holder'], ['bottle', 'side'], ['water bottle']] },
    'Airport / travel scene': { any: [['airport'], ['travel'], ['suitcase'], ['luggage'], ['flight'], ['plane'], ['train'], ['transit'], ['journey']] },
    'Close-up of zippers / straps': { any: [['close-up', 'zipper'], ['close-up', 'strap'], ['strap', 'detail'], ['padded', 'strap'], ['shoulder strap'], ['buckle'], ['zipper']] },
    'Bag opened flat for packing': { any: [['open', 'flat'], ['clamshell'], ['opens', 'fully'], ['laid flat'], ['unzip', 'fully'], ['180', 'degree']] },
    'Taking items out of bag': { any: [['pull', 'out'], ['takes', 'out'], ['removes', 'from'], ['unpack'], ['retriev'], ['grab', 'from']] },
    'Backpack on-body fit shot': { any: [['on body'], ['fit', 'back'], ['wearing it'], ['how it fits'], ['shoulder'], ['ergonomic'], ['comfortable', 'wear']] },
  },
  'Cooler Backpack': {
    'Showing insulated interior': { any: [['insulated'], ['interior', 'cooler'], ['inside', 'cooler'], ['lining'], ['thermal'], ['foil']] },
    'Packing food / drinks': { any: [['pack', 'food'], ['pack', 'drink'], ['put', 'drink'], ['put', 'food'], ['loading', 'cooler'], ['filling', 'cooler'], ['store', 'food'], ['store', 'drink'], ['beer'], ['snack'], ['ice']] },
    'Carrying to beach / park': { any: [['carry', 'cooler'], ['carrying', 'cooler'], ['walk', 'cooler'], ['wearing', 'cooler'], ['beach', 'cooler'], ['park', 'cooler'], ['heading', 'beach']] },
    'Cooler capacity demo': { any: [['capacity', 'cooler'], ['fits', 'cooler'], ['how much', 'cooler'], ['hold', 'cooler'], ['fit', 'inside'], ['room', 'inside']] },
    'Ice packed into cooler': { any: [['ice', 'cooler'], ['ice', 'pack'], ['cold', 'cooler'], ['frozen']] },
    'Drinks pulled from cooler': { any: [['pull', 'drink'], ['grab', 'drink'], ['takes', 'drink'], ['retriev', 'cooler'], ['opens', 'cooler', 'drink'], ['beer', 'out']] },
    'Close-up of zippers / straps': { any: [['close-up', 'zipper'], ['close-up', 'strap'], ['strap', 'detail'], ['zipper', 'cooler'], ['buckle', 'cooler'], ['padded strap']] },
    'Cooler opened at destination': { any: [['open', 'cooler'], ['opens', 'cooler'], ['unzip', 'cooler'], ['reveal', 'cooler']] },
    'Group outdoor scene with cooler': { any: [['group', 'cooler'], ['friends', 'cooler'], ['family', 'cooler'], ['people', 'cooler'], ['couple', 'cooler'], ['together', 'cooler'], ['picnic', 'cooler']] },
    'Cooler set down for picnic / beach use': { any: [['set down', 'cooler'], ['places', 'cooler'], ['sits', 'cooler'], ['cooler on', 'sand'], ['cooler on', 'grass'], ['cooler', 'blanket'], ['cooler', 'towel']] },
  },
  'Tote Bag': {
    'Tote-to-backpack conversion': { any: [['convert', 'backpack'], ['switch', 'backpack'], ['transform', 'backpack'], ['backpack', 'strap'], ['tote', 'backpack'], ['removable strap'], ['convert']] },
    'Folding into compact pouch': { any: [['fold', 'compact'], ['fold', 'pouch'], ['fold', 'pocket'], ['compact', 'form'], ['folding', 'bag'], ['compact storage'], ['fold', 'down'], ['folds', 'into']] },
    'Showing interior pockets': { any: [['interior', 'pocket'], ['internal', 'pocket'], ['inside', 'pocket'], ['compartment'], ['zippered pocket'], ['open pocket'], ['organiz']] },
    'Packing items into bag': { any: [['pack', 'bag'], ['packing', 'bag'], ['putting', 'bag'], ['places', 'bag'], ['fit', 'bag'], ['loading', 'bag'], ['stuff', 'bag']] },
    'Expandable base demo': { any: [['expand', 'base'], ['extendable', 'base'], ['unzip', 'base'], ['zipper', 'base'], ['extra', 'storage'], ['20%', 'extra'], ['extend', 'base'], ['bigger', 'bag']] },
    'Luggage sleeve demo': { any: [['luggage', 'sleeve'], ['suitcase', 'handle'], ['luggage handle'], ['travel', 'sleeve'], ['slide', 'over', 'suitcase']] },
    'Carrying bag on shoulder': { any: [['shoulder', 'bag'], ['tote', 'shoulder'], ['carrying', 'shoulder'], ['over', 'shoulder'], ['on shoulder']] },
    'Carrying bag as backpack': { any: [['wearing', 'backpack'], ['backpack', 'on'], ['on her back'], ['on his back'], ['carries', 'backpack'], ['puts on', 'backpack']] },
    'Pulling items from bag': { any: [['pull', 'from', 'bag'], ['pulls', 'from'], ['takes', 'out', 'bag'], ['removes', 'from', 'bag'], ['retriev', 'bag'], ['unpack', 'bag']] },
    'Close-up of bag details / pattern': { any: [['close-up', 'bag'], ['pattern', 'bag'], ['design', 'bag'], ['detail', 'bag'], ['logo', 'bag'], ['fabric', 'bag'], ['material', 'bag'], ['texture', 'bag'], ['brand', 'bag']] },
  },
};

function matchesBucket(description: string, matcher: Matcher): boolean {
  const d = description.toLowerCase();
  if (matcher.any) {
    return matcher.any.some(keywords => keywords.every(kw => d.includes(kw)));
  }
  if (matcher.fn) return matcher.fn(d);
  return false;
}

async function main() {
  // Get all analyzed videos with products (paginated)
  const allVideos: Array<{ id: string; products: string[] }> = [];
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from('videos')
      .select('id, products')
      .eq('status', 'analyzed')
      .not('products', 'is', null)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    allVideos.push(...(data as any[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Total analyzed videos: ${allVideos.length}`);

  // Classify videos by product family
  const familyVideoIds: Record<string, string[]> = {};
  for (const fam of PRODUCT_FAMILIES) familyVideoIds[fam.label] = [];
  for (const v of allVideos) {
    const text = (v.products ?? []).join(' ').toLowerCase();
    for (const fam of PRODUCT_FAMILIES) {
      if (text.includes(fam.pattern)) familyVideoIds[fam.label].push(v.id);
    }
  }

  // For each product family, fetch all moments and classify
  for (const fam of PRODUCT_FAMILIES) {
    const videoIds = familyVideoIds[fam.label];
    if (videoIds.length === 0) {
      console.log(`\n=== ${fam.label} === (0 videos, skipping)`);
      continue;
    }

    // Fetch all moments (exclude presentation labels)
    const allMoments: Array<{ label: string; description: string }> = [];
    const CHUNK = 200;
    for (let i = 0; i < videoIds.length; i += CHUNK) {
      const chunk = videoIds.slice(i, i + CHUNK);
      const { data } = await supabase
        .from('video_moments')
        .select('label, description')
        .in('video_id', chunk);
      if (data) {
        for (const m of data) {
          if (!PRESENTATION_LABELS.has(m.label)) {
            allMoments.push(m);
          }
        }
      }
    }

    console.log(`\n=== ${fam.label} === (${videoIds.length} videos, ${allMoments.length} product moments)`);

    const candidates = CANDIDATES[fam.label];
    if (!candidates) { console.log('  No candidate matchers defined'); continue; }

    // Classify each moment
    const bucketCounts: Record<string, number> = {};
    const bucketExamples: Record<string, string[]> = {};
    const unmatched: string[] = [];

    for (const bucket of Object.keys(candidates)) {
      bucketCounts[bucket] = 0;
      bucketExamples[bucket] = [];
    }

    for (const m of allMoments) {
      const desc = m.description ?? '';
      let matched = false;
      for (const [bucket, matcher] of Object.entries(candidates)) {
        if (matchesBucket(desc, matcher)) {
          bucketCounts[bucket]++;
          if (bucketExamples[bucket].length < 4) {
            bucketExamples[bucket].push(desc.slice(0, 150));
          }
          matched = true;
          break; // first match wins
        }
      }
      if (!matched) {
        unmatched.push(desc);
      }
    }

    // Rank by count descending
    const ranked = Object.entries(bucketCounts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);

    const totalMatched = ranked.reduce((s, [, c]) => s + c, 0);

    for (const [i, [bucket, count]] of ranked.entries()) {
      const pct = ((count / allMoments.length) * 100).toFixed(1);
      console.log(`  ${i + 1}. ${bucket}: ${count} (${pct}%)`);
      for (const ex of bucketExamples[bucket]) {
        console.log(`     → ${ex}`);
      }
    }

    console.log(`\n  MATCHED: ${totalMatched} / ${allMoments.length} (${((totalMatched / allMoments.length) * 100).toFixed(1)}%)`);
    console.log(`  UNMATCHED: ${unmatched.length} (${((unmatched.length / allMoments.length) * 100).toFixed(1)}%)`);

    // Show top unmatched patterns (sample)
    if (unmatched.length > 0) {
      console.log(`\n  UNMATCHED SAMPLES (first 20):`);
      for (const u of unmatched.slice(0, 20)) {
        console.log(`     - ${u.slice(0, 150)}`);
      }
    }
  }
}

main().catch(console.error);
