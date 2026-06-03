# Hours — Local Business Hours PWA

A lightweight PWA that displays open hours for a curated list of local businesses. Designed to be faster than checking Google Maps, Yelp, or Apple Maps for the one thing you actually need: "are they open right now, and when do they close?"

Installable on iPhone via Safari → Share → Add to Home Screen.

## Why this exists

Looking up hours for a local business takes 15–30 seconds in a maps app: launch, search, scroll past photos and reviews, find the hours section. This app shows you hours for every business you care about in under 1 second with a single glance.

## Architecture

Three layers, all simple:

```
┌─────────────────────────────────────────────┐
│  1. Build script (Node.js)                  │
│     - Weekly: regularOpeningHours            │
│     - Daily: currentOpeningHours (7-day)     │
│     - Writes hours.json                      │
├─────────────────────────────────────────────┤
│  2. Static hosting (GitHub Pages / Netlify)  │
│     - hours.json (the data)                  │
│     - index.html / app.js / sw.js            │
│     - manifest.json                          │
├─────────────────────────────────────────────┤
│  3. PWA frontend (vanilla JS)               │
│     - Reads from localStorage on load        │
│     - Background-fetches hours.json          │
│     - Service worker for offline support     │
└─────────────────────────────────────────────┘
```

### Data build strategy

Google Places API offers two relevant fields:

- **`regularOpeningHours`**: Static weekly template (Mon–Sun). Doesn't reflect holidays. Rarely changes. Built weekly.
- **`currentOpeningHours`**: Actual hours for the next 7 days from the date of the request. Includes a `special_days` sub-field that flags holiday closures or modified hours. Built daily.

Both fields are in the Enterprise SKU of Places API (New), which provides 1,000 free calls/month. At ~30 businesses with a daily build, that's ~900 calls/month — just under the free cap.

The build script merges both: it overlays any `currentOpeningHours` special-day overrides on top of the `regularOpeningHours` baseline, producing a single clean `hours.json` for the frontend.

### Budget

$0/month at current scale (~30 businesses). The 1,000 free Enterprise SKU calls accommodate daily builds. If the list grows beyond ~33 businesses, the daily build would exceed the free tier and we'd need to either reduce build frequency or accept a small monthly charge.

## Data model

`hours.json` contains an array of business objects:

```json
[
  {
    "id": "robbins-library",
    "name": "Robbins Library",
    "category": "library",
    "placeId": "ChIJExample123",
    "hours": {
      "regular": {
        "mon": { "open": "09:00", "close": "21:00" },
        "tue": { "open": "09:00", "close": "21:00" },
        "wed": { "open": "09:00", "close": "21:00" },
        "thu": { "open": "09:00", "close": "21:00" },
        "fri": { "open": "09:00", "close": "17:00" },
        "sat": { "open": "10:00", "close": "17:00" },
        "sun": null
      },
      "overrides": [
        {
          "date": "2026-05-25",
          "hours": null,
          "reason": "Memorial Day"
        }
      ]
    },
    "lastUpdated": "2026-05-05T06:00:00Z"
  }
]
```

Field details:

- `id`: URL-safe slug, used as a stable key in localStorage
- `name`: Display name, from Google's `displayName` field
- `category`: One of `"library"`, `"restaurant"`, `"shop"`. Manually assigned in the business list config (not from Google).
- `placeId`: Google Place ID. Used by the build script to fetch hours.
- `hours.regular`: Keyed by 3-letter lowercase day abbreviation. Value is `{ open, close }` in 24h `"HH:MM"` format, or `null` for closed.
- `hours.overrides`: Array of date-specific exceptions from `currentOpeningHours` special days. `hours` is either `{ open, close }` or `null` (closed). `reason` is optional and may not always be available from Google.
- `lastUpdated`: ISO 8601 timestamp of the last successful build for this business.

## Frontend behavior

### First load
1. Fetch `hours.json` from the server.
2. Render the list.
3. Store data in localStorage under key `hours_data`.
4. Store a timestamp under key `hours_updated`.

### Subsequent loads
1. Read `hours_data` from localStorage and render immediately (target: <100ms to first paint of business list).
2. In the background, fetch `hours.json`. Compare `lastUpdated` timestamps. If newer data exists, update localStorage and re-render.

### Display logic

Each row shows two lines:

```
Robbins Library
Open · Closes 9 PM          ← or "Closed · Opens 9 AM tomorrow"
```

The status line is computed client-side from the hours data + the device's current time.

**Swipe right** on a row to reveal tomorrow's hours:

```
                              Tomorrow: 10 AM – 5 PM
```

### Filters

Three filter buttons at the top: **Libraries**, **Restaurants**, **Shops**, plus a **Clear** button. Filters are toggles (tap to activate, tap again to deactivate). Multiple filters can be active at once (OR logic — shows businesses matching any active filter). Active filter state is purely in-memory; not persisted.

### Sort

Always alphabetical by `name`.

## Project structure

```
/
├── app/                    # Frontend (deployed as static site)
│   ├── index.html          # Single page app shell
│   ├── app.js              # All frontend logic
│   ├── style.css           # Styles
│   ├── sw.js               # Service worker
│   ├── manifest.json       # PWA manifest
│   ├── hours.json          # Data (generated by build script)
│   └── icon-*.png          # PWA icons
├── scripts/
│   ├── build.js            # Fetches hours from Google API and writes app/hours.json
│   └── search-server.js    # Local server for looking up Google Place IDs
├── tools/
│   └── search.html         # Place ID search UI (served by search-server.js)
├── businesses.json         # Config: list of placeIds + categories
├── .env                    # GOOGLE_PLACES_API_KEY (not committed)
├── CLAUDE.md
└── README.md
```

## Setup

### Prerequisites

- Node.js 18+
- A Google Cloud project with Places API (New) enabled
- A Google API key with Places API access

### Configuration

1. Create a `.env` file in the project root:

```
GOOGLE_PLACES_API_KEY=your_key_here
```

2. Populate `businesses.json` with your businesses. Each entry needs a Google Place ID — use the search tool (below) to find them:

```json
[
  {
    "id": "robbins-library",
    "name": "Robbins Library",
    "category": "library",
    "placeId": "ChIJExample123"
  }
]
```

3. Run the build script to fetch hours from Google and write `app/hours.json`:

```bash
node scripts/build.js
```

4. Serve the `app/` directory (any static server works):

```bash
npx serve app/
```

5. Open in Safari on iPhone → Share → Add to Home Screen.

### Finding Place IDs

Use the included search tool to look up Google Place IDs without leaving the terminal:

```bash
node scripts/search-server.js
# → Place ID search → http://localhost:3456
```

Open that URL, search by business name and ZIP code, and copy the Place ID directly into `businesses.json`. The server reads `GOOGLE_PLACES_API_KEY` from `.env` — no browser-side API key needed.

### Automated build

Set up a cron job or GitHub Action to run `node scripts/build.js` daily and commit/deploy the updated `hours.json`.
