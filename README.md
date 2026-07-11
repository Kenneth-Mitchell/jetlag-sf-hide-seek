# SF Jet Lag Hide & Seek Adjudicator

Mobile-first local web app for the San Francisco homebrew *Jet Lag: Hide & Seek* game. It freezes the provided SF spreadsheet into a bundled snapshot, answers hider-side nearest/distance questions from that snapshot, and lets seekers apply conservative station-zone constraints to shrink the finite list of valid hiding stations.

## Current Scope

Implemented:

- Vite + React + TypeScript app with Leaflet map UI.
- Map view is constrained to the San Francisco playable area with padded game bounds.
- Build-time workbook ingestion from `JLH&S Sheets San Francisco.xlsx`.
- Generated snapshot with authoritative curated tabs:
  - 193 valid hiding stations
  - 35 measuring rail stations
  - mountains, dog parks, aquariums, golf courses, museums, movie theaters, libraries, hospitals, foreign consulates, farmers markets
  - All Muni Stops as reference-only data
- Museum coordinate recovery from Google Maps redirects, with Nominatim address fallback for rows whose Maps redirect lacks coordinates.
- DataSF supervisor district and trimmed playable-area geometry:
  - `https://data.sfgov.org/resource/f2zs-jevy.geojson`
  - `https://data.sfgov.org/resource/hcgx-vtsb.geojson`
- DataSF coastline, water body, and park polygon geometry for geometry-backed measuring:
  - `https://data.sfgov.org/resource/txuc-3kzm.geojson`
  - `https://data.sfgov.org/resource/xgse-mjer.geojson`
  - `https://data.sfgov.org/resource/gtr9-ntp6.geojson`
- Frozen sea-level/elevation samples from Open-Elevation for the Sea Level measuring question.
- SFMTA GTFS per-route stop ingestion for transit-line checks near valid hiding stations.
- Seeker constraints for radius, thermometer, nearest-POI matching, measuring, tentacles, supervisorial district, and transit line.
- Vector geometry overlays on the map after applying questions, alongside in/out candidate station zones:
  - circles for radius and measuring thresholds
  - half-plane and bisector for thermometer
  - Voronoi cells for matching and tentacles
  - district polygons for supervisorial district questions
- Per-question overlay colors with editable color swatches in the question stack.
- Question builder shows the possible answer set before asking.
- Tentacles possible answers render as a colored Voronoi legend on the map and answer chips.
- Question stack supports editing existing questions without duplicating them.
- Map-based question setup uses draggable draft handles:
  - one draggable ask point for radar, matching, measuring, tentacles, and district questions
  - draggable A/B points for thermometer questions
  - draft geometry, coordinates, copyable question text, and possible answers preview while dragging
  - drag release commits the final question point
  - matching and tentacles show the full category Voronoi while dragging, then the selected cell after release
- One-tap current-location reference point using the browser geolocation API.
- Copyable plain-English question text in the seeker flow.
- Hider mode canonical nearest answers from the same frozen snapshot.
- Local persistence and copyable state links.
- PWA manifest and service worker for app shell caching.

Still incomplete or intentionally deferred:

- Street/path: official street geometry source is identified, but the trace/photo-style question still needs UI and adjudication rules before bundling the large layer.
- Sea-level uses a frozen sample grid rather than full contour geometry; refine later if contour-grade precision is required.
- Station hiding zones are displayed as ¼-mile circles and filtered conservatively; clipping against the playable area is shown as boundary context but not yet persisted as clipped zone polygons.
- Basemap tiles come from OpenStreetMap at runtime and are cached opportunistically after viewing; fully bundled offline tiles are not included yet.
- Hosted deployment: `https://kenneth-mitchell.github.io/jetlag-sf-hide-seek/`

## Source-Of-Truth Decision

The spreadsheet wins over OpenStreetMap for all curated POI categories and valid hiding stations. OpenStreetMap/Nominatim is used only as a coordinate recovery fallback for specific museum rows whose Google Maps short link did not expose coordinates. Those fallbacks are cached in `scripts/build-data/geocode-cache.json`.

Known snapshot caveats are surfaced in the app:

- Dog Parks: sheet has 33 rows; rules prose says 36. The app uses the sheet.
- Farmers Markets are ingested and enabled from the frozen sheet data, but the rule is marked untested.
- All Muni Stops are reference-only; valid hiding stations remain the finite 193-row sheet tab.

## Run Locally

```bash
npm install
npm run build:data
npm run dev
```

By default the data builder reads:

```bash
/Users/kenneth/Downloads/JLH&S Sheets San Francisco.xlsx
```

Override it with:

```bash
JETLAG_SF_XLSX=/path/to/workbook.xlsx npm run build:data
```

## Verification

```bash
npm run lint
npm test
npm run build
```

Current tests cover:

- authoritative tab counts and snapshot warnings
- DataSF geometry presence
- canonical nearest-answer fixtures
- radius soundness around station zones
- constraint commutativity
- sampled truthful hider soundness for matching and measuring constraints

## Deployment

This is a static Vite app after `npm run build`. The current public deployment is:

```text
https://kenneth-mitchell.github.io/jetlag-sf-hide-seek/
```
