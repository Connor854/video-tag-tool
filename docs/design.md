# Nakie Video Search - Design Document

**Project:** Nakie Video Search  
**Version:** 1.0  
**Date:** 2025-07-13

---

## 1. UI/UX Design

### 1.1 Design Principles

- **Clean & Minimal:** Whitespace-heavy, no visual clutter
- **Fast:** Instant search results, minimal loading states
- **Video-First:** Video thumbnails as primary visual element
- **Functional:** Every element serves a purpose

### 1.2 Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER (fixed, 64px)                                           │
│  [Logo] [Search Bar (centered)]              [Sync] [Settings] │
├─────────────────────────────────────────────────────────────────┤
│  FILTERS SIDEBAR (240px)    │  MAIN CONTENT                     │
│                             │                                    │
│  ○ Status                   │  ┌─────┐ ┌─────┐ ┌─────┐         │
│    ○ All                    │  │thumb│ │thumb│ │thumb│         │
│    ○ Processing             │  │     │ │     │ │     │         │
│    ○ Completed              │  └─────┘ └─────┘ └─────┘         │
│    ○ Failed                 │  Title     Title     Title       │
│                             │  Tags...   Tags...   Tags...     │
│  ○ Location                 │                                    │
│    □ Beach                  │  ┌─────┐ ┌─────┐ ┌─────┐         │
│    □ Forest                 │  │thumb│ │thumb│ │thumb│         │
│    □ Mountain               │  │     │ │     │ │     │         │
│    □ Indoor                 │  └─────┘ └─────┘ └─────┘         │
│                             │                                    │
│  ○ Activity                 │  (infinite scroll)                │
│    □ Camping                │                                    │
│    □ Surfing                │                                    │
│    □ Hiking                 │                                    │
│    □ Relaxing               │                                    │
│                             │                                    │
│  ○ Products                 │                                    │
│    □ Hammock                │                                    │
│    □ Beach Towel            │                                    │
│    □ Picnic Blanket         │                                    │
│    □ Tote Bag               │                                    │
│                             │                                    │
├─────────────────────────────────────────────────────────────────┤
│  FOOTER: Total X videos • Last sync: Y                         │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 Page Views

#### Search View (Default)
- Full-width search bar with auto-focus
- Real-time results as you type (debounced 300ms)
- Results in responsive grid (1-4 columns based on viewport)

#### Video Detail Modal
- Opens on video click
- Contains:
  - Video player (top, 16:9)
  - Title + metadata
  - Tags (chips, clickable to filter)
  - Detected products with SKU links
  - Transcript (collapsible, searchable)
  - Scene thumbnails (clickable to jump)

### 1.4 Visual Style

| Element | Style |
|---------|-------|
| **Colors** | Background: `#FAFAFA`, Cards: `#FFFFFF`, Primary: `#1A1A1A`, Accent: `#006B5A` (Nakie green), Text: `#333333`, Muted: `#888888` |
| **Typography** | Headings: `Satoshi` (bold), Body: `Inter` (regular), Monospace: `JetBrains Mono` (for SKUs) |
| **Spacing** | Base unit: 8px, Card padding: 16px, Grid gap: 24px |
| **Shadows** | Cards: `0 2px 8px rgba(0,0,0,0.06)`, Hover: `0 4px 16px rgba(0,0,0,0.1)` |
| **Border Radius** | Cards: 12px, Buttons: 8px, Tags: 16px (pill) |
| **Animations** | Hover: 150ms ease, Modal: 200ms fade + scale |

### 1.5 Component States

**Search Bar**
- Default: Gray border `#E5E5E5`, placeholder "Search videos..."
- Focused: Accent border, subtle shadow
- Loading: Subtle spinner inside

**Video Card**
- Default: White background, subtle shadow
- Hover: Elevated shadow, slight scale (1.02)
- Playing: Green accent border

**Filter Checkbox**
- Unchecked: Gray outline
- Checked: Filled accent color + checkmark
- Hover: Slight background tint

---

## 2. Database Schema

### 2.1 Core Tables

```sql
-- Videos: Main video metadata
CREATE TABLE videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_file_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    mime_type TEXT,
    size_bytes BIGINT,
    duration_seconds FLOAT,
    thumbnail_url TEXT,
    drive_web_view_link TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    processing_error TEXT,
    created_time TIMESTAMPTZ,
    modified_time TIMESTAMPTZ,
    last_synced_at TIMESTAMPTZ DEFAULT NOW(),
    transcript JSONB,
    transcript_full TEXT,
    tags JSONB,
    scene_count INTEGER,
    frame_count INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scenes: Key frames extracted from videos
CREATE TABLE scenes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    scene_index INTEGER NOT NULL,
    start_time FLOAT NOT NULL,
    end_time FLOAT NOT NULL,
    frame_url TEXT,
    frame_thumbnail_url TEXT,
    analysis JSONB,
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products: Shopify product catalog
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shopify_product_id TEXT UNIQUE,
    shopify_variant_id TEXT UNIQUE,
    title TEXT NOT NULL,
    handle TEXT,
    description TEXT,
    sku TEXT,
    price DECIMAL(10,2),
    currency TEXT DEFAULT 'AUD',
    product_type TEXT,
    tags TEXT[],
    images JSONB,
    vendor TEXT,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video-Product Mappings: Links videos to products
CREATE TABLE video_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    match_source TEXT CHECK (match_source IN ('vision', 'transcript', 'manual')),
    match_confidence FLOAT,
    timestamps JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(video_id, product_id, match_source)
);

-- Search History: For analytics
CREATE TABLE search_queries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_text TEXT NOT NULL,
    results_count INTEGER,
    filters JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.2 Indexes

```sql
-- Performance indexes
CREATE INDEX idx_videos_status ON videos(status);
CREATE INDEX idx_videos_name_search ON videos USING gin(to_tsvector('english', name));
CREATE INDEX idx_videos_tags ON videos USING gin(tags);
CREATE INDEX idx_videos_created ON videos(created_time DESC);

CREATE INDEX idx_scenes_video ON scenes(video_id);
CREATE INDEX idx_scenes_tags ON scenes USING GIN(tags);

CREATE INDEX idx_video_products_video ON video_products(video_id);
CREATE INDEX idx_video_products_product ON video_products(product_id);

CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_title ON products USING gin(to_tsvector('english', title));
```

### 2.3 Row Level Security

```sql
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read videos" ON videos FOR SELECT USING (true);
CREATE POLICY "Service can write videos" ON videos FOR INSERT WITH CHECK (true);
CREATE POLICY "Service can update videos" ON videos FOR UPDATE USING (true);

-- Similar for other tables (read-only for frontend)
ALTER TABLE scenes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read scenes" ON scenes FOR SELECT USING (true);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read products" ON products FOR SELECT USING (true);

ALTER TABLE video_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read video_products" ON video_products FOR SELECT USING (true);
```

---

## 3. API Endpoints

### 3.1 Videos

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/videos` | List videos with filters & pagination |
| `GET` | `/api/videos/:id` | Get single video details |
| `GET` | `/api/videos/:id/scenes` | Get scenes for a video |
| `GET` | `/api/videos/:id/products` | Get products in a video |
| `POST` | `/api/videos/sync` | Trigger Google Drive sync |

**GET `/api/videos` Query Parameters:**
```
?search=beach&status=completed&location=beach&activity=camping&product=hammock
&page=1&limit=24&sort=created_at&order=desc
```

### 3.2 Search

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/search` | Full-text search across videos |

**GET `/api/search` Query Parameters:**
```
?q=hammock beach&filters={"location":["beach"]}&page=1&limit=24
```

**Response:**
```json
{
  "results": [
    {
      "id": "uuid",
      "name": "Beach Day Vlog",
      "thumbnail_url": "https://...",
      "duration_seconds": 320,
      "status": "completed",
      "tags": {
        "location": "beach",
        "activity": "surfing",
        "products": ["hammock", "towel"]
      },
      "matched_on": "transcript"
    }
  ],
  "total": 42,
  "page": 1,
  "total_pages": 2
}
```

### 3.3 Products

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/products` | List all Shopify products |
| `GET` | `/api/products/:id` | Get product details |
| `POST` | `/api/products/sync` | Trigger Shopify sync |

### 3.4 System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/stats` | Get sync stats, video counts |

---

## 4. Search & Filter Functionality

### 4.1 Search Types

| Type | Implementation | Use Case |
|------|---------------|----------|
| **Full-text** | PostgreSQL `to_tsvector` | Search titles, transcripts |
| **Tag filtering** | JSONB containment (`@>`) | Filter by location, activity |
| **Semantic** | pgvector (future) | "Similar products" recommendations |

### 4.2 Filter Logic

**Location Filter:**
```sql
SELECT * FROM videos 
WHERE tags->'location' @> '"beach"'
AND status = 'completed';
```

**Multi-select Filter (OR within category):**
```sql
-- Any of: beach OR forest OR mountain
SELECT * FROM videos 
WHERE tags->'location' ?| array['beach', 'forest', 'mountain']
AND status = 'completed';
```

**Combined Filters (AND across categories):**
```sql
-- Location: beach AND Activity: surfing
SELECT * FROM videos 
WHERE tags->'location' @> '"beach"'
AND tags->'activity' @> '"surfing"'
AND status = 'completed';
```

### 4.3 Search Query Flow

```
User types query
      │
      ▼
Debounce (300ms)
      │
      ▼
Full-text search on name, transcript
      │
      ▼
Apply filters (status, location, activity, product)
      │
      ▼
Return paginated results
      │
      ▼
Log search to search_queries table
```

### 4.4 Auto-complete

- On search input focus: Show recent searches
- On typing: Show product tag suggestions
- On empty search: Show recent videos

### 4.5 URL State

Search state persisted to URL for shareability:
```
/?q=hammock&location=beach&status=completed&page=2
```

---

## 5. Summary

| Section | Key Points |
|---------|------------|
| **UI/UX** | Clean, video-first design with sidebar filters, responsive grid, modal for details |
| **Schema** | Videos, Scenes, Products, Video-Products tables with proper indexes and RLS |
| **API** | RESTful endpoints for videos, search, products with pagination & filtering |
| **Search** | Full-text search + tag filtering + future semantic search via pgvector |
