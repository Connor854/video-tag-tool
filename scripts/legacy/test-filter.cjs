const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://juejixwrwtvmjqhxssvm.supabase.co',
  'sb_publishable_aWKOwjsqsEHyftAlbRiFQw_0KB5uzUX'
);

async function test() {
  // Test without filter
  const { data: all } = await supabase.from('videos').select('id').limit(3);
  console.log('All:', all?.length);
  
  // Test with filter - not.is.drive_id,null
  const { data: withId } = await supabase.from('videos').select('id').not('drive_id', 'is', null).limit(3);
  console.log('With drive_id:', withId?.length);
  
  // Test combining filters
  const { data: combined } = await supabase.from('videos')
    .select('id, name, duration_seconds')
    .not('drive_id', 'is', null)
    .neq('status', 'excluded')
    .limit(5);
  console.log('Combined:', combined);
}

test().catch(console.error);
