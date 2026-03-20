const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://juejixwrwtvmjqhxssvm.supabase.co',
  'sb_publishable_aWKOwjsqsEHyftAlbRiFQw_0KB5uzUX'
);

async function check() {
  const { count: total } = await supabase.from('videos').select('*', { count: 'exact', head: true });
  const { count: withDuration } = await supabase.from('videos').select('*', { count: 'exact', head: true }).gt('duration_seconds', 0);
  const { count: zeroDuration } = await supabase.from('videos').select('*', { count: 'exact', head: true }).eq('duration_seconds', 0);
  const { count: nullDuration } = await supabase.from('videos').select('*', { count: 'exact', head: true }).is('duration_seconds', null);
  
  console.log(`Total videos: ${total}`);
  console.log(`With duration: ${withDuration}`);
  console.log(`Zero duration: ${zeroDuration}`);
  console.log(`Null duration: ${nullDuration}`);
  
  // Sample some with durations
  const { data } = await supabase.from('videos').select('name, duration_seconds').gt('duration_seconds', 0).limit(5);
  console.log('\nSample durations:');
  data?.forEach(v => console.log(`  ${v.name}: ${v.duration_seconds}s`));
}

check().catch(console.error);
