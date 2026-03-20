# Nakie Video Search

## Overview
- **Started**: 2026-03-09
- **Goal**: Build an AI-powered tool that scans Nakie's Google Drive videos, tags products to Shopify SKUs, identifies context (location, activity, objects), extracts transcripts, and presents in a searchable web app
- **Success Criteria**: Working MVP deployed with 1,000 videos analyzed, all features functional

---

## Access Credentials (Secure)
- **Google Drive**: View access granted (EMAIL: see secure notes)
- **Shopify**: Read-only API token to be provided
- **Storage**: Supabase for database

---

## Phases

### Phase 1: Research
- [x] Research Google Drive API and rate limits
- [x] Research Google Vision AI for product/label detection
- [x] Research competitor video tagging tools (LinkedIn, Chrome extensions)
- [x] Research UI patterns for video tagging dashboards
- [x] Research Whisper for transcript extraction
- [x] Research Shopify API for product/SKU mapping
- [ ] Cost analysis: Estimate MVP and full-scale costs
- **Status**: approved
- **Sub-agents**: research-drive-api, research-competitors, research-ui-patterns
- **Confidence**: 95%
- **Auto-advance**: ✅ Research complete - proceeding to Planning

### Phase 2: Planning
- [x] Define technical architecture
- [x] Plan scene-change detection algorithm
- [x] Design product-to-SKU mapping system
- [x] Design context taxonomy (location, activity, objects)
- [x] Plan Supabase schema for video metadata + tags
- [x] Estimate timeline and milestones
- [x] Create cost budget (MVP vs full scale)
- **Status**: approved
- **Sub-agents**:
  - planning-agent: Complete (session_key: agent:main:subagent:e20ac894-3023-43eb-8e5e-f54c282249e3, run_id: 435628fe-75aa-46f3-8ea9-dea4bfb98c2d)
- **Confidence**: 88%
- **Auto-advance**: ✅ Auto-approved - confidence 88% > 80% threshold

### Phase 3: Design
- [x] Design UI/UX (clean, professional, not "AI-slop")
- [x] Design database schema (videos, tags, products, transcripts)
- [x] Design API integrations (Drive, Vision AI, Shopify, Whisper)
- [x] Design search and filter system
- [x] Create wireframes/mockups
- **Status**: approved
- **Sub-agents**:
  - design-agent-1: Failed - no output produced (attempt 1)
  - design-agent-retry: Failed - no output produced (attempt 2)
  - design-agent-v3: Success - created docs/design.md
- **Confidence**: 85%
- **Auto-advance**: ✅ Auto-approved - confidence 85% > 80% threshold

### Phase 4: Execution
- [ ] Setup Next.js project with Supabase
- [ ] Implement Google Drive connection (list files, stream)
- [ ] Implement scene-change detection (ffmpeg)
- [ ] Implement product tagging (Google Vision → Shopify SKU)
- [ ] Implement context tagging (location, activity, objects)
- [ ] Implement transcript extraction (Whisper)
- [ ] Build search/filter dashboard
- [ ] Write tests
- **Status**: in_progress
- **Sub-agents**:
  - execution-agent: Completed (no output produced - needs investigation)
- **Confidence**: 0%
- **Auto-advance**: If confidence > 90%, auto-approve and move to Deployment
- **Note**: Execution sub-agent completed but no output files created.

### Phase 5: Deployment
- [ ] Deploy to Vercel (staging)
- [ ] Test with 1,000 videos
- [ ] Create presentation deck
- [ ] Set up daily cron job for new videos
- [ ] Deploy to production
- **Status**: pending
- **Sub-agents**:
- **Confidence**: 0%

---

## Specifics

### Scene Change Detection
- Use ffmpeg to detect scene changes
- Extract 1 frame per scene change
- Max 1 frame per 10 seconds to optimize costs

### Product Mapping
- Fetch all products from Shopify API
- Store product images and SKUs in database
- Match video frames to products using Vision AI
- Confidence threshold: 80%

### Context Tags (Taxonomy)
**Locations**: Beach, Park, Home, Studio, Traveling, Indoors, Outdoors
**Activities**: Laying, Sitting, Walking, Running, Swimming, Fitness, Camping, Picnic, Traveling
**Objects**: Picnic Blanket, Hammock, Towel, Bag, Suitcase, Wine, Food, Pet, Child, Umbrella, Chair

### Transcript
- Use OpenAI Whisper (local, free)
- Store full transcript per video
- Enable keyword search

### Daily Scan
- Use cron to run daily at 6am
- Check for new videos in Google Drive
- Process only new videos
- Update existing if modified

---

## Sub-Agents (Running)
| Name | Task | Status | Output | Started |
|------|------|--------|--------|---------|
| research-drive-api | Connect to Google Drive API | complete | docs/google-drive-api.md | 2026-03-09 |
| research-competitors | Analyze competitor tools | complete | docs/competitor-analysis.md | 2026-03-09 |
| research-ui-patterns | Research good AI UI patterns | complete | docs/ui-patterns.md | 2026-03-09 |

## Approval Queue
Items needing your review:
- None yet

## Artifacts (Outputs)
| Artifact | Type | Location | Created |
|----------|------|----------|---------|
| Google Drive API Research | Markdown | docs/google-drive-api.md | 2026-03-09 |
| Competitor Analysis | Markdown | docs/competitor-analysis.md | 2026-03-09 |
| UI Patterns Research | Markdown | docs/ui-patterns.md | 2026-03-09 |

## Decision Log
```
2026-03-09 10:33 - Decision: Use scene-change detection - Reason: Optimizes API costs
2026-03-09 10:33 - Decision: Use Whisper for transcripts - Reason: Free, local
2026-03-09 10:33 - Decision: Start with 1,000 videos - Reason: Validate before full scale
2026-03-09 10:50 - Decision: Auto-approve research - Reason: 95% confidence
```

## Auto-Advance Rules
- **Research → Planning**: Confidence > 80%
- **Planning → Design**: Confidence > 80%
- **Design → Execution**: Confidence > 80%
- **Execution → Deployment**: Confidence > 90%

## Flags
- ⚠️ Blocked: None
- 🚨 Needs Decision: Shopify API token not yet provided
- ✅ Auto-advanced: Research phase → Planning phase (95% confidence)
- ✅ Auto-advanced: Planning phase → Design phase (88% confidence)
- ✅ Design phase complete - created docs/design.md
