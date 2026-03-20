# Nakie Video Search - Build Brief

## Goal
Clone the exact functionality and UI of https://nakievideo-rjsrbn2a.manus.space/ — an AI-powered video library search tool for Nakie (Australian eco-outdoor brand).

## Reference App Analysis

### Tech Stack to Use
- **Frontend**: React + Vite + TypeScript
- **Backend**: Node.js with tRPC API
- **Database**: SQLite (for simplicity, can migrate to Supabase later)
- **Styling**: Tailwind CSS
- **Fonts**: Fraunces (headings) + Outfit (body) from Google Fonts
- **AI**: Google Gemini 2.5 Flash for video analysis

### UI Layout (match exactly)

#### Header
- Nakie logo (left) + "AI-Powered Search" badge (right)
- Large hero heading: "Video Library Search"
- Subtitle: "Search your entire video library using AI-generated tags. Find the perfect b-roll by product, scene, mood, or action."
- Ocean/beach hero background image
- Search bar with placeholder: "Search videos... try 'hammock', 'beach', 'family', 'UGC'"
- Quick tag buttons below search: hammock beach, family, UGC compilation, hiking, product demo, golden hour, talking head, sand-free

#### Stats Bar
- Total videos count
- AI-analyzed count
- Total size in GB
- Showing X results
- Sort dropdown (Relevance)
- Filters button

#### Video Grid (2 columns on desktop)
Each card shows:
- **Thumbnail** from Google Drive (with play icon overlay + duration badge)
- **AI-generated description** (2-3 sentences describing what happens in the video)
- **Product tags** (e.g., "Hammock", "Puffy Blanket", "Backpack") with icons
- **Scene/location tag** (e.g., "Beach", "Forest", "Indoor", "Mountains") with icon
- **Group tag** (e.g., "1 Solo", "3 Family", "4 Friends") with icon
- **Action buttons**: "Copy Drive link" + "Open in Drive"

#### Pagination
- Page X of Y at bottom
- Previous/Next buttons

#### Footer
- Nakie Video Search · AI-Powered
- "Powered by Gemini 2.5 Flash · X of Y videos analyzed"

### Color Scheme (from reference)
- Background: warm cream/beige (#f5f0e8 or similar)
- Cards: white with subtle shadow
- Product tags: warm brown/tan pills
- Scene tags: muted with icons
- Header: ocean teal gradient with beach imagery
- Accent: Nakie brand green

### API Endpoints (tRPC)
1. `video.search` - Search/filter videos
   - Params: query, product, sceneBackground, shotType, audioType, groupType, hasLogo, sortBy, page, pageSize
   - Returns: array of video objects with all metadata
   
2. `video.filters` - Get available filter options
   - Returns: lists of products, scenes, shot types, audio types, group types
   
3. `video.stats` - Dashboard stats
   - Returns: totalVideos, totalAnalyzed, totalSizeGb

4. `thumbnail/:driveFileId` - Proxy thumbnails from Google Drive
   - Params: size (e.g., 640)

### Video Data Model
```typescript
interface Video {
  id: string;
  driveFileId: string;
  fileName: string;
  description: string;        // AI-generated description
  products: string[];          // Product tags
  sceneBackground: string;     // Location/scene
  shotType: string;           // e.g., "talking head", "b-roll"
  audioType: string;          // e.g., "voiceover", "music"
  groupType: string;          // e.g., "Solo", "Family", "Friends"
  groupCount: number;         // Number of people
  hasLogo: boolean;
  duration: number;           // Video duration in seconds
  sizeBytes: number;
  thumbnailUrl: string;
  driveUrl: string;
  analyzedAt: Date;
  createdAt: Date;
}
```

### Google Drive Integration
- User inputs a Google Drive folder URL/ID
- App scans all video files in the folder (recursively)
- For each video:
  1. Extract thumbnail frame using Google Drive API
  2. Send to Gemini 2.5 Flash for analysis
  3. Get back: description, product tags, scene, shot type, audio type, group info
  4. Store in database
- Show progress during scanning
- Support incremental scanning (only new/modified videos)

### Admin/Settings Page
Add a simple settings page (not in Manus version) where user can:
- Enter Google Drive folder URL
- Connect Google Drive (OAuth or service account)
- Trigger a scan
- See scan progress
- Enter Gemini API key

## File Structure
```
nakie-video-search/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── .env.example          # GEMINI_API_KEY, GOOGLE_DRIVE_FOLDER_ID, etc.
├── src/
│   ├── client/           # React frontend
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── index.html
│   │   ├── components/
│   │   │   ├── Header.tsx
│   │   │   ├── SearchBar.tsx
│   │   │   ├── StatsBar.tsx
│   │   │   ├── VideoGrid.tsx
│   │   │   ├── VideoCard.tsx
│   │   │   ├── Filters.tsx
│   │   │   ├── Pagination.tsx
│   │   │   └── Footer.tsx
│   │   └── styles/
│   ├── server/           # tRPC backend
│   │   ├── index.ts
│   │   ├── router.ts
│   │   ├── trpc.ts
│   │   └── routers/
│   │       └── video.ts
│   ├── services/
│   │   ├── googleDrive.ts    # Drive API integration
│   │   ├── geminiAnalyzer.ts # Video analysis with Gemini
│   │   └── scanner.ts       # Orchestrates scanning
│   └── db/
│       ├── schema.ts
│       └── index.ts
└── public/
    └── nakie-logo.svg
```

## Priority
1. Get the UI pixel-perfect to match the Manus version
2. Get the search/filter/pagination working with mock data first
3. Then wire up Google Drive scanning + Gemini analysis
4. Make it deployable locally (npm run dev)

## Important Notes
- The Manus app has 6,284 videos already analyzed — we need to support scanning 10,000+
- Use batch processing for large Drive folders (don't try to analyze all at once)
- Rate limit Gemini API calls appropriately
- Store thumbnails locally or cache them to avoid hitting Drive API limits
- The app should work standalone — no dependency on the Manus platform
