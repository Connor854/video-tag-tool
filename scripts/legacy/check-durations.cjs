const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://juejixwrwtvmjqhxssvm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1ZWppeHdyd3R2bWpxaHhzc3ZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjY3NTEsImV4cCI6MjA4ODQ0Mjc1MX0.m7zUYlccqz-qN-99ZnH03-T0fbyUdXumKBuylywCtO8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  // Check duration stats
  const { data: durations } = await supabase
    .from('videos')
    .select('duration_seconds')
    .limit(20);
  
  console.log('Sample durations:');
  durations?.forEach((v, i) => console.log(`${i+1}.`, v.duration_seconds));
  
  // Count zero durations
  const { count: zeroCount } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .eq('duration_seconds', 0);
  
  const { count: nullCount } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .is('duration_seconds', null);
  
  const { count: totalCount } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true });
  
  console.log(`\nTotal videos: ${totalCount}`);
  console.log(`Zero durations: ${zeroCount}`);
  console.log(`Null durations: ${nullCount}`);
  console.log(`Non-zero durations: ${totalCount - zeroCount - nullCount}`);
}

main().catch(console.error);
