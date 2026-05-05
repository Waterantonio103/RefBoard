# Image Search Plan

## Goal

Add an in-app Google Image Search asset-browser view for Reference Board. Users should be able to search online, preview results, inspect source context, and import selected images as stable local board images.

## Confirmed Direction

- Use Google Custom Search JSON API with image search.
- Do not scrape Google Images result pages.
- Support hybrid credentials:
  - Prefer runtime environment configuration.
  - Fall back to compact setup fields inside the Image Search panel.
- Add two entry points:
  - Sidebar image-search tool.
  - Canvas context-menu action.
- Import selected results as local copies through the existing image import path.
- Place imported images at the user's intent location:
  - Context-menu launch: clicked canvas point.
  - Sidebar launch: current viewport center.
- Show title, source domain, and source link, but do not restrict v1 results by licensing.
- Include user-controlled SafeSearch.
- Use manual "More" pagination to control quota use.
- Show human-readable API and import errors.

## Non-goals

- No unofficial Google scraping.
- No full asset manager or persistent collections feature.
- No required licensing acknowledgement before each import.
- No local quota counter in v1.
- No automated infinite scroll.

## Phase 1: Provider and Runtime API Foundation

Build the Google Image Search provider behind local runtime boundaries.

Tasks:

- Add a normalized image-search API shape for frontend use:
  - Query text.
  - SafeSearch mode.
  - Page/start index.
  - Result title.
  - Source page URL.
  - Image URL.
  - Thumbnail URL.
  - Source domain.
- Add Google Custom Search requests with `searchType=image`.
- Read environment credentials first:
  - `GOOGLE_SEARCH_API_KEY`.
  - `GOOGLE_SEARCH_ENGINE_ID`.
- Add credential fallback payload support for user-entered values.
- Map Google/API failures to human-readable errors:
  - Missing config.
  - Invalid credentials.
  - Quota exceeded.
  - Network failure.
  - No results.
- Implement this in both runtime paths:
  - Electron main/IPC.
  - `server.js` web/dev API.

Acceptance checks:

- Searching never exposes environment credentials to `public/app.js`.
- Missing config produces a clear setup-required response.
- SafeSearch and pagination parameters are passed intentionally.
- Google response shape is normalized before reaching the UI.

## Phase 2: Search Panel UI

Create an asset-browser style Image Search panel visually aligned with the Open Board dialog.

Tasks:

- Add a search dialog/panel with:
  - Query input.
  - Search action.
  - SafeSearch control.
  - Results grid.
  - Selected-result preview.
  - Title, source domain, and source link.
  - Recent searches.
  - Manual "More" button.
  - Loading, empty, and error states.
- Add compact credential setup fields inside the panel when runtime config is unavailable.
- Store fallback credentials and recent searches using existing IndexedDB prefs.
- Keep API-key UI visibly scoped to local setup, not source attribution or board content.

Acceptance checks:

- The panel works without resizing or overlapping existing app chrome.
- Empty, loading, error, and result states are distinct.
- Recent searches are useful but do not dominate the workflow.
- SafeSearch is user-controlled from v1.

## Phase 3: Entry Points and Placement Intent

Wire Image Search into the existing app workflow.

Tasks:

- Add a sidebar button for general image search.
- Add a canvas context-menu action for image search.
- Track launch intent:
  - Sidebar launch imports to viewport center.
  - Context-menu launch imports to clicked board coordinates.
- Preserve this placement intent while the panel is open.
- Add menu/action plumbing where needed for Electron and web parity.

Acceptance checks:

- Sidebar launch and context-menu launch both open the same search experience.
- Import placement is predictable in zoomed and panned board states.
- Context-menu placement does not drift after searching or paging.

## Phase 4: Import and Source Metadata

Connect selected search results to the existing local image import flow.

Tasks:

- Import selected result image URLs as local copies.
- Reuse existing image loading, downscale, persistence, and board dirty-state behavior.
- Store source metadata on image records where cleanly supported:
  - Search result title.
  - Source page URL.
  - Source domain.
  - Original image URL.
- On failed import:
  - Show a clear error.
  - Keep the result selected.
  - Leave source link available.
- Avoid hotlink fallback in v1.

Acceptance checks:

- Imported images survive reload/export like existing local board images.
- Failed imports do not clear search results or lose selection context.
- Source metadata does not break old board imports or existing saved boards.

## Phase 5: Verification

Use focused automated checks for risky API behavior plus manual QA for the Electron/web UI workflow.

Automated or focused checks:

- Missing credential behavior.
- Environment credential precedence.
- Fallback credential payload handling.
- SafeSearch parameter mapping.
- Pagination/start-index mapping.
- Google error mapping.
- Normalized result shape.

Manual QA checklist:

- Open Image Search from sidebar.
- Open Image Search from canvas context menu.
- Search with valid credentials.
- Search with missing/invalid credentials.
- Toggle SafeSearch and verify request behavior.
- Load more results manually.
- Select results and inspect preview/source information.
- Import a successful result.
- Try a result that fails download and verify clear failure state.
- Confirm imported image placement from both entry points.
- Reload board and confirm imported image persistence.

## Risks and Mitigations

- API quota and cost: use manual pagination and human-readable quota errors.
- API key exposure from fallback settings: explain setup scope and prefer environment variables.
- Broken or blocked image URLs: keep failed results selectable and expose source link.
- Licensing ambiguity: show source metadata, but avoid claiming reuse rights.
- UI sprawl: keep v1 to preview, source, recent searches, SafeSearch, and More.

## First Concrete Next Step

Implement Phase 1 by adding normalized search endpoints in Electron and `server.js`, then test them with mocked or manually supplied Google API responses before building the panel UI.
