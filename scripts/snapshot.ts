import 'dotenv/config';
import { supabase } from '../src/lib/supabase.js';
import { getDefaultWorkspaceId } from '../src/lib/workspace.js';
async function main() {
  const wid = getDefaultWorkspaceId();
  const cq = async (f: (q: any) => any) => {
    const { count, error } = await f(supabase.from('videos').select('*', { count: 'exact', head: true }).eq('workspace_id', wid));
    return error ? `ERR` : count;
  };
  const analyzed = await cq(q => q.eq('status', 'analyzed'));
  const fullVideo = await cq(q => q.eq('status', 'analyzed').eq('analysis_mode', 'full_video'));
  const reanalysis = await cq(q => q.eq('status', 'reanalysis_needed'));
  const errors = await cq(q => q.eq('status', 'error'));
  const analyzing = await cq(q => q.eq('status', 'analyzing'));
  console.log(`analyzed=${analyzed} full_video=${fullVideo} reanalysis_needed=${reanalysis} error=${errors} analyzing=${analyzing} time=${new Date().toISOString()}`);
}
main().catch(console.error);
