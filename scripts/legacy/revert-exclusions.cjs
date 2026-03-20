const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://juejixwrwtvmjqhxssvm.supabase.co';
// Using anon key - let's see if it works for updates
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1ZWppeHdyd3R2bWpxaHhzc3ZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NjY3NTEsImV4cCI6MjA4ODQ0Mjc1MX0.m7zUYlccqz-qN-99ZnH03-T0fbyUdXumKBuylywCtO8';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log('Resetting excluded videos to processed...');
  
  // First, count how many are excluded
  const { count: excludedCount } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'excluded');
  
  console.log(`Found ${excludedCount} excluded videos`);
  
  // Update all excluded to processed
  const { data, error } = await supabase
    .from('videos')
    .update({ status: 'processed' })
    .eq('status', 'excluded')
    .select();
  
  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
  
  console.log(`Successfully reset ${data?.length ?? excludedCount} videos to processed status`);
}

main().catch(console.error);