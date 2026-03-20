import 'dotenv/config';

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? '';
const BASE = 'http://localhost:3001/api/trpc';

async function getStats() {
  const [scan, stats] = await Promise.all([
    fetch(`${BASE}/admin.scanStatus`, { headers: { 'x-admin-secret': ADMIN_SECRET } }).then(r => r.json()),
    fetch(`${BASE}/admin.pipelineStats`, { headers: { 'x-admin-secret': ADMIN_SECRET } }).then(r => r.json()),
  ]);
  return {
    scan: scan.result?.data?.json,
    stats: stats.result?.data?.json,
  };
}

async function main() {
  const checks = 6; // 6 checks, 60s apart = 5 minutes
  const results: Array<{ t: number; progress: number; analyzed: number; fv: number; ra: number; err: number; analyzing: number; file: string }> = [];
  
  for (let i = 0; i < checks; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 60000));
    
    const { scan, stats } = await getStats();
    const entry = {
      t: i * 60,
      progress: scan?.progress ?? 0,
      analyzed: stats?.counts?.analyzed ?? 0,
      fv: stats?.modes?.full_video ?? 0,
      ra: stats?.counts?.reanalysis_needed ?? 0,
      err: stats?.counts?.error ?? 0,
      analyzing: stats?.counts?.analyzing ?? 0,
      file: scan?.currentFile ?? '?',
    };
    results.push(entry);
    
    console.log(
      `[t+${String(entry.t).padStart(3)}s] progress=${entry.progress} analyzed=${entry.analyzed} fv=${entry.fv} ` +
      `ra=${entry.ra} err=${entry.err} analyzing=${entry.analyzing} file=${entry.file}`
    );
  }
  
  // Summary
  const first = results[0];
  const last = results[results.length - 1];
  const deltaAnalyzed = last.analyzed - first.analyzed;
  const deltaFv = last.fv - first.fv;
  const deltaRa = first.ra - last.ra; // should decrease
  const deltaErr = last.err - first.err;
  const deltaProgress = last.progress - first.progress;
  const elapsedMin = (last.t - first.t) / 60;
  
  console.log('\n=== 5-MINUTE VALIDATION SUMMARY ===');
  console.log(`Elapsed: ${elapsedMin} minutes`);
  console.log(`Scan progress: ${first.progress} → ${last.progress} (+${deltaProgress})`);
  console.log(`DB analyzed: ${first.analyzed} → ${last.analyzed} (+${deltaAnalyzed})`);
  console.log(`DB full_video: ${first.fv} → ${last.fv} (+${deltaFv})`);
  console.log(`DB reanalysis_needed: ${first.ra} → ${last.ra} (-${deltaRa})`);
  console.log(`DB error: ${first.err} → ${last.err} (+${deltaErr})`);
  console.log(`Throughput: ${Math.round(deltaAnalyzed / elapsedMin * 60)} analyzed/hr (measured)`);
  console.log(`Queue drain rate: ${Math.round(deltaRa / elapsedMin * 60)}/hr`);
  
  if (deltaAnalyzed > 0 && deltaRa > 0) {
    const remainingHrs = last.ra / (deltaRa / elapsedMin * 60);
    const eta = new Date(Date.now() + remainingHrs * 3600000);
    console.log(`ETA at current rate: ${remainingHrs.toFixed(1)}h → ${eta.toISOString()}`);
  }
  
  console.log(`\nVerdict: ${deltaAnalyzed > 0 ? 'COMPLETIONS VERIFIED ✓' : 'NO COMPLETIONS — PROBLEM'}`);
}
main().catch(console.error);
