import 'dotenv/config';

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? '';
const BASE = 'http://localhost:3001/api/trpc';

async function getStats() {
  const [scan, stats] = await Promise.all([
    fetch(`${BASE}/admin.scanStatus`, { headers: { 'x-admin-secret': ADMIN_SECRET } }).then(r => r.json()),
    fetch(`${BASE}/admin.pipelineStats`, { headers: { 'x-admin-secret': ADMIN_SECRET } }).then(r => r.json()),
  ]);
  return { scan: scan.result?.data?.json, stats: stats.result?.data?.json };
}

async function main() {
  const intervalSec = 120;
  const checks = 6; // 6 checks × 2 min = 10 min
  const results: Array<{ t: number; progress: number; analyzed: number; ra: number; err: number; analyzing: number; file: string; throughput: number }> = [];
  
  for (let i = 0; i < checks; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, intervalSec * 1000));
    
    const { scan, stats } = await getStats();
    const entry = {
      t: i * intervalSec,
      progress: scan?.progress ?? -1,
      analyzed: stats?.counts?.analyzed ?? -1,
      ra: stats?.counts?.reanalysis_needed ?? -1,
      err: stats?.counts?.error ?? -1,
      analyzing: stats?.counts?.analyzing ?? -1,
      file: scan?.currentFile ?? '?',
      throughput: stats?.throughputPerHour ?? -1,
    };
    results.push(entry);
    
    console.log(
      `[t+${String(entry.t).padStart(3)}s] prog=${entry.progress} analyzed=${entry.analyzed} ` +
      `ra=${entry.ra} err=${entry.err} wkrs=${entry.analyzing} tput=${entry.throughput}/hr file=${entry.file}`
    );
  }
  
  // Filter out failed checks (analyzed=-1 or 0)
  const valid = results.filter(r => r.analyzed > 0);
  if (valid.length < 2) {
    console.log('\nINSUFFICIENT VALID DATA — cannot compute throughput');
    return;
  }
  
  const first = valid[0];
  const last = valid[valid.length - 1];
  const elapsedMin = (last.t - first.t) / 60;
  const deltaAnalyzed = last.analyzed - first.analyzed;
  const deltaRa = first.ra - last.ra;
  const deltaErr = last.err - first.err;
  
  console.log('\n=== 4-WORKER VALIDATION (10 min) ===');
  console.log(`Valid checks: ${valid.length}/${results.length}`);
  console.log(`Elapsed: ${elapsedMin} min`);
  console.log(`analyzed: ${first.analyzed} → ${last.analyzed} (+${deltaAnalyzed})`);
  console.log(`reanalysis_needed: ${first.ra} → ${last.ra} (-${deltaRa})`);
  console.log(`error: ${first.err} → ${last.err} (+${deltaErr})`);
  console.log(`Measured throughput: ${Math.round(deltaAnalyzed / elapsedMin * 60)}/hr`);
  console.log(`Success rate: ${((deltaAnalyzed / (deltaAnalyzed + deltaErr)) * 100).toFixed(1)}%`);
  
  if (deltaRa > 0) {
    const ratePerHr = deltaRa / elapsedMin * 60;
    const etaHrs = last.ra / ratePerHr;
    console.log(`Queue drain rate: ${Math.round(ratePerHr)}/hr`);
    console.log(`ETA: ${etaHrs.toFixed(1)}h → ${new Date(Date.now() + etaHrs * 3600000).toISOString()}`);
  }
}
main().catch(console.error);
