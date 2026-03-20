const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://juejixwrwtvmjqhxssvm.supabase.co',
  'sb_publishable_aWKOwjsqsEHyftAlbRiFQw_0KB5uzUX'
);

async function main() {
  // Get videos between 0.5 and 0.8 seconds
  const { data, error } = await supabase
    .from('videos')
    .select('id')
    .gte('duration_seconds', 0.5)
    .lte('duration_seconds', 0.8);
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log(`Found ${data.length} videos between 0.5-0.8 seconds`);
  
  // Update them to excluded
  const ids = data.map(v => v.id);
  
  const { error: updateError } = await supabase
    .from('videos')
    .update({ status: 'excluded' })
    .in('id', ids);
  
  if (updateError) {
    console.error('Update error:', updateError);
    return;
  }
  
  console.log('Done!');
}

main().catch(console.error);
