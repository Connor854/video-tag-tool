# Deploy to Render

This app runs as a single Node.js web service (frontend + backend). Render serves the built client and API from one process.

---

## Build and Start

| Step | Command |
|------|---------|
| **Build** | `npm install && npm run build` |
| **Start** | `npm start` |

The server listens on `PORT` (set by Render).

---

## Required Environment Variables

Set these in the Render Dashboard → Service → Environment:

| Variable | Required | Notes |
|----------|----------|-------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `VITE_SUPABASE_URL` | Yes | Same as SUPABASE_URL (used at build time) |
| `VITE_SUPABASE_ANON_KEY` | Yes | Same as SUPABASE_ANON_KEY (used at build time) |
| `ADMIN_SECRET` | Yes | Admin secret for write operations |
| `DEFAULT_WORKSPACE_ID` | Yes | Fallback workspace UUID (e.g. `00000000-0000-0000-0000-000000000001`) |
| `JINA_API_KEY` | Yes | Jina API key for semantic search embeddings |

For thumbnail/video proxy and media routes:

| Variable | Required | Notes |
|----------|----------|-------|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | For media | Inline JSON string (full service account key). Not a file path. |

For Shopify OAuth (Connect Shopify flow):

| Variable | Required | Notes |
|----------|----------|-------|
| `SHOPIFY_CLIENT_ID` | For OAuth | Shopify app client ID from Partner Dashboard |
| `SHOPIFY_CLIENT_SECRET` | For OAuth | Shopify app client secret |
| `APP_URL` | For OAuth | Public base URL (e.g. `https://your-app.onrender.com`). Used for OAuth callback redirect. |

---

## ffmpeg Requirement

**ffmpeg** is used when Drive has no built-in thumbnail. The server extracts a frame from the video file.

- **Render default Node runtime:** Does not include ffmpeg.

**Options:**

1. **Deploy without ffmpeg** — The app runs. Thumbnail extraction for videos without Drive thumbnails will fail and fall back to placeholders. Search and analysis work normally.

2. **Add ffmpeg via Dockerfile** — Use `runtime: docker` in `render.yaml` and add a Dockerfile that installs ffmpeg (e.g. `apt-get install -y ffmpeg`). See Render docs for Docker-based deploys.

---

## Blueprint Deploy

If `render.yaml` is in the repo root:

1. Connect the repo to Render.
2. Render will detect the blueprint and create the web service.
3. Add env vars in the Dashboard.
4. Deploy.

---

## Manual Setup

If not using the blueprint:

1. New Web Service → Connect repo.
2. **Runtime:** Node.
3. **Build command:** `npm install && npm run build`
4. **Start command:** `npm start`
5. Add env vars.
