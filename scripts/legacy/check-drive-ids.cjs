const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://juejixwrwtvmjqhxssvm.supabase.co',
  'sb_publishable_aWKOwjsqsEHyftAlbRiFQw_0KB5uzUX'
);

async function check() {
  const { count: withDriveId } = await supabase.from('videos').select('*', { count: 'exact', head: true }).not('drive_id', 'is', null);
  const { count: withoutDriveId } = await supabase.from('videos').select('*', { count: 'exact', head: true }).is('drive_id', null);
  
  console.log(`Videos with drive_id: ${withDriveId}`);
  console.log(`Videos without drive_id: ${withoutDriveId}`);
}

check().catch(console.error);
