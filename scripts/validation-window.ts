import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';

async function snapshot(label: string) {
  const wid = getDefaultWorkspaceId();
  const cq = async (f: (q: any) => any) => {
    const { count, error } = await f(supabase.from('videos').select('*', { count: 'exact', head: true }).eq('workspace_id', wid));
    return error ? -1 : (count ?? 0);
  };
  const analyzed = await cq(q => q.eq('status', 'analyzed'));
  const fullVideo = await cq(q => q.eq('status', 'analyzed').eq('analysis_mode', 'full_video'));
  const reanalysis = await cq(q => q.eq('status', 'reanalysis_needed'));
  const errors = await cq(q => q.eq('status', 'error'));
  const analyzing = await cq(q => q.eq('status', 'analyzing'));

  // Recent completions in last 15 min
  const since = new Date(Date.now() - 15*60000).toISOString();
  const { data: recent } = await supabase.from('videos')
    .select('name, size_bytes, updated_at, analysis_mode')
    .eq('workspace_id', wid).eq('status', 'analyzed').eq('analysis_mode', 'full_video')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false }).limit(5);

  console.log(`[${label}] analyzed=${analyzed} full_video=${fullVideo} reanalysis_needed=${reanalysis} error=${errors} analyzing=${analyzing}`);
  if (recent && recent.length > 0) {
    console.log(`  Recent completions (last 15m):`);
    for (const v of recent) {
      const mb = v.size_bytes ? (v.size_bytes/1024/1024).toFixed(1) : '?';
      console.log(`    ${v.name} | ${mb}MB | ${v.updated_at}`);
    }
  } else {
    console.log(`  No recent completions in last 15m`);
  }
}

async function main() {
  await snapshot('t+0m');
  
  // Wait 2 minutes
  await new Promise(r => setTimeout(r, 120000));
  await snapshot('t+2m');

  // Wait 3 more minutes (t+5m)
  await new Promise(r => setTimeout(r, 180000));
  await snapshot('t+5m');

  // Wait 5 more minutes (t+10m)
  await new Promise(r => setTimeout(r, 300000));
  await snapshot('t+10m');
}
main().catch(console.error);
