const fs = require('fs');

async function fetchPage(page, pageSize = 100) {
  const input = encodeURIComponent(JSON.stringify({
    "0": {
      json: {
        query: "",
        product: "",
        sceneBackground: "",
        shotType: "",
        audioType: "",
        groupType: "",
        hasLogo: false,
        sortBy: "relevance",
        page: page,
        pageSize: pageSize
      },
      meta: { values: {} }
    }
  }));
  
  const url = `https://nakievideo-rjsrbn2a.manus.space/api/trpc/video.search?batch=1&input=${input}`;
  const res = await fetch(url);
  const data = await res.json();
  return data[0]?.result?.data?.json || {};
}

async function main() {
  // Check total first
  const first = await fetchPage(1, 1);
  console.log(`Manus API reports total: ${first.total} videos`);
  
  const allVideos = [];
  let page = 1;
  const pageSize = 100;
  
  while (true) {
    process.stdout.write(`Page ${page}...`);
    const result = await fetchPage(page, pageSize);
    const videos = result.videos || [];
    if (videos.length === 0) break;
    allVideos.push(...videos);
    console.log(` ${videos.length} (total: ${allVideos.length}/${first.total})`);
    if (videos.length < pageSize) break;
    page++;
    await new Promise(r => setTimeout(r, 150));
  }
  
  console.log(`\nFetched ${allVideos.length} of ${first.total} videos`);
  fs.writeFileSync('manus-export.json', JSON.stringify(allVideos, null, 2));
  console.log('Saved to manus-export.json');
}

main().catch(console.error);
