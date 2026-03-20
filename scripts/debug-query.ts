import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';

async function main() {
  // Basic count
  const { count, error } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'analyzed');
  console.log('Count query:', { count, error: error?.message });

  // Try different select
  const { data, error: e2 } = await supabase
    .from('videos')
    .select('id, status')
    .eq('status', 'analyzed')
    .limit(5);
  console.log('Sample query:', { data, error: e2?.message });

  // Check if RLS is blocking
  const { data: d2, error: e3 } = await supabase
    .from('videos')
    .select('id, status')
    .limit(5);
  console.log('No-filter query:', { data: d2, error: e3?.message });

  // Check env
  console.log('URL set:', !!process.env.SUPABASE_URL);
  console.log('Key set:', !!process.env.SUPABASE_ANON_KEY);
  console.log('Key starts with:', process.env.SUPABASE_ANON_KEY?.slice(0, 20));
}

main().catch(console.error);
