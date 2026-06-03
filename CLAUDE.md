# CLAUDE.md

Instructions for building the Hours PWA. Read README.md first for full architecture and data model.

## What to build

A single-page PWA that displays local business hours. Vanilla HTML/CSS/JS — no frameworks, no build step, no npm dependencies on the frontend. The app must work as a standalone home-screen app on iPhone.

## Implementation priorities

1. **Speed above all else.** The localStorage read → render path should feel instant. No loading spinners, no skeleton screens. If localStorage has data, paint it immediately.
2. **Information density.** This is a utility, not a showcase. Small text, tight rows, no wasted space. Think of it as a personal reference card, not a consumer app.
3. **Tactile swipe interaction.** The swipe-to-reveal-tomorrow must feel native — smooth, with momentum, and a snap-back.

## Frontend details

### HTML structure

Single `index.html` with:
- A fixed top bar with filter buttons (Libraries, Restaurants, Shops, Clear)
- A scrollable list below it
- No hamburger menus, no navbars, no footers

### Each list row

Two lines per business, tightly packed:

```
Business Name
Open · Closes 9:00 PM
```

or

```
Business Name
Closed · Opens 9:00 AM tomorrow
```

or

```
Business Name
Closed today
```

Status computation rules:
- Compare current device time against today's hours (check overrides first, then fall back to regular hours)
- If currently within open hours → "Open · Closes {close time}"
- If closed now but opens later today → "Closed · Opens {open time} today"
- If closed for the rest of today → "Closed · Opens {open time} {day}" where {day} is "tomorrow" or the next open day name
- If a business has no hours data at all → "Hours unavailable"
- Use 12-hour format with AM/PM, no leading zeros. Drop ":00" when minutes are zero (show "9 AM" not "9:00 AM").

Color coding:
- "Open" text is green
- "Closed" text is a muted red/warm gray — not alarming, just informational

### Swipe interaction

Each row is horizontally swipeable. Swiping right (finger moves left-to-right) reveals tomorrow's hours on the right side:

```
                              Tomorrow: 10 AM – 5 PM
```

or

```
                              Tomorrow: Closed
```

Implementation: use touch events (touchstart, touchmove, touchend). The row content translates horizontally. The "tomorrow" info is positioned behind/beside the main content and revealed as the row slides. Snap back on release if the swipe is less than ~30% of row width. If swiped far enough, hold in the revealed position until tapped or swiped back.

"Tomorrow" means the next calendar day — compute this from the hours data the same way as today's status, but for tomorrow's day-of-week, checking overrides first.

### Filters

Filter buttons styled as small pills/chips at the top. When active, they get a filled background. When inactive, they are outlined/muted.

- Tapping an inactive filter activates it and hides non-matching businesses
- Tapping an active filter deactivates it
- Multiple filters can be active simultaneously (OR logic)
- The Clear button deactivates all filters and shows everything
- Clear button is only visible when at least one filter is active
- Filter transitions should not be animated — just instant show/hide

### Offline behavior

The service worker should cache:
- `index.html`
- `style.css`
- `app.js`
- `hours.json`

Use a cache-first strategy for the app shell (html, css, js) and a stale-while-revalidate strategy for `hours.json`. This means the app works fully offline with whatever data was last cached.

### PWA manifest

```json
{
  "name": "Hours",
  "short_name": "Hours",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff"
}
```

Use `display: standalone` so it looks like a native app (no Safari chrome). Provide a simple favicon/icon — a minimal clock or just the letter "H" is fine. Generate as 192x192 and 512x512 PNGs.

### CSS approach

- System font stack: `-apple-system, BlinkMacSystemFont, sans-serif` — this is a utility app for iPhone, not a design statement. System fonts load instantly and feel native.
- Base font size: 14px for business names, 12px for hours/status
- Row padding: 10px vertical, 16px horizontal
- No borders between rows — use subtle background alternation or a thin 1px separator, whatever produces higher density
- The entire viewport should be usable. No max-width container. The list goes edge-to-edge.
- Support dark mode via `prefers-color-scheme` media query
- Safe area insets for iPhone notch: `env(safe-area-inset-top)` etc.
- No scrollbars visible (use `-webkit-scrollbar: none` plus `scrollbar-width: none`)
- Prevent overscroll bounce on the filter bar (it should stay fixed)

### Data loading (app.js)

```
On page load:
  1. const cached = localStorage.getItem('hours_data')
  2. if (cached) → parse and render immediately
  3. fetch('hours.json')
     → on success:
        - compare with cached data
        - if different, update localStorage and re-render
        - update 'hours_updated' timestamp in localStorage
     → on failure (offline, network error):
        - silently do nothing (cached data is already displayed)
  4. if (!cached && fetch failed) → show "No data available. Connect to the internet to load hours."
```

Do not show any loading state if cached data exists. The user should never perceive a loading moment on a warm launch.

### Timestamp display

Show a small, muted "Updated {relative time}" at the very bottom of the list. Example: "Updated 3 hours ago" or "Updated yesterday". This helps the user know if their data might be stale. Use the `hours_updated` localStorage timestamp for this.

## Build script (scripts/build.js)

Node.js script. Dependencies: only `node-fetch` (or use Node 18+ built-in fetch).

### Input

Reads `businesses.json` from the project root. This file contains the list of businesses with their placeIds and categories:

```json
[
  { "id": "robbins-library", "name": "Robbins Library", "category": "library", "placeId": "ChIJ..." },
  { "id": "cafe-nero", "name": "Café Nero", "category": "restaurant", "placeId": "ChIJ..." }
]
```

### Process

For each business:
1. Call Google Places API (New) Place Details endpoint
2. Request fields: `displayName,regularOpeningHours,currentOpeningHours`
3. This triggers the Enterprise SKU (highest of the three field tiers)
4. Parse the response into the data model described in README.md
5. Merge: start with `regularOpeningHours` as the baseline, then overlay any `currentOpeningHours.specialDays` as overrides

### API call format

```
GET https://places.googleapis.com/v1/places/{PLACE_ID}
Headers:
  X-Goog-Api-Key: {API_KEY}
  X-Goog-FieldMask: displayName,regularOpeningHours,currentOpeningHours
```

### Output

Writes `hours.json` to the project root. The format is defined in README.md.

### Error handling

- If a single business fails, log a warning and skip it — don't fail the entire run
- If the API key is missing, exit with a clear error message
- Rate limit: add a 200ms delay between API calls to be polite

### Running

```bash
GOOGLE_PLACES_API_KEY=xxx node scripts/build.js
```

## Sample data for development

Before the Google API is wired up, use this hardcoded `hours.json` for frontend development. These are real Arlington, MA businesses with plausible hours:

```json
[
  {
    "id": "robbins-library",
    "name": "Robbins Library",
    "category": "library",
    "placeId": "",
    "hours": {
      "regular": {
        "mon": { "open": "09:00", "close": "21:00" },
        "tue": { "open": "09:00", "close": "21:00" },
        "wed": { "open": "09:00", "close": "21:00" },
        "thu": { "open": "09:00", "close": "21:00" },
        "fri": { "open": "09:00", "close": "17:00" },
        "sat": { "open": "10:00", "close": "17:00" },
        "sun": { "open": "14:00", "close": "17:00" }
      },
      "overrides": [
        { "date": "2026-05-25", "hours": null, "reason": "Memorial Day" }
      ]
    },
    "lastUpdated": "2026-05-05T06:00:00Z"
  },
  {
    "id": "fox-library",
    "name": "Fox Library",
    "category": "library",
    "placeId": "",
    "hours": {
      "regular": {
        "mon": { "open": "10:00", "close": "18:00" },
        "tue": { "open": "10:00", "close": "18:00" },
        "wed": { "open": "10:00", "close": "18:00" },
        "thu": { "open": "10:00", "close": "20:00" },
        "fri": { "open": "10:00", "close": "17:00" },
        "sat": { "open": "10:00", "close": "14:00" },
        "sun": null
      },
      "overrides": []
    },
    "lastUpdated": "2026-05-05T06:00:00Z"
  },
  {
    "id": "capitol-theatre",
    "name": "Capitol Theatre",
    "category": "shop",
    "placeId": "",
    "hours": {
      "regular": {
        "mon": null,
        "tue": { "open": "16:00", "close": "22:00" },
        "wed": { "open": "16:00", "close": "22:00" },
        "thu": { "open": "16:00", "close": "22:00" },
        "fri": { "open": "14:00", "close": "23:00" },
        "sat": { "open": "12:00", "close": "23:00" },
        "sun": { "open": "12:00", "close": "20:00" }
      },
      "overrides": []
    },
    "lastUpdated": "2026-05-05T06:00:00Z"
  },
  {
    "id": "menotomy-grill",
    "name": "Menotomy Grill & Tavern",
    "category": "restaurant",
    "placeId": "",
    "hours": {
      "regular": {
        "mon": { "open": "11:30", "close": "21:00" },
        "tue": { "open": "11:30", "close": "21:00" },
        "wed": { "open": "11:30", "close": "21:00" },
        "thu": { "open": "11:30", "close": "21:00" },
        "fri": { "open": "11:30", "close": "22:00" },
        "sat": { "open": "11:30", "close": "22:00" },
        "sun": { "open": "11:30", "close": "21:00" }
      },
      "overrides": []
    },
    "lastUpdated": "2026-05-05T06:00:00Z"
  },
  {
    "id": "tango-mango",
    "name": "Tango Mango",
    "category": "restaurant",
    "placeId": "",
    "hours": {
      "regular": {
        "mon": { "open": "11:00", "close": "21:00" },
        "tue": { "open": "11:00", "close": "21:00" },
        "wed": { "open": "11:00", "close": "21:00" },
        "thu": { "open": "11:00", "close": "21:00" },
        "fri": { "open": "11:00", "close": "21:30" },
        "sat": { "open": "11:00", "close": "21:30" },
        "sun": { "open": "12:00", "close": "21:00" }
      },
      "overrides": []
    },
    "lastUpdated": "2026-05-05T06:00:00Z"
  },
  {
    "id": "break-away",
    "name": "Break Away",
    "category": "restaurant",
    "placeId": "",
    "hours": {
      "regular": {
        "mon": { "open": "07:00", "close": "14:00" },
        "tue": { "open": "07:00", "close": "14:00" },
        "wed": { "open": "07:00", "close": "14:00" },
        "thu": { "open": "07:00", "close": "14:00" },
        "fri": { "open": "07:00", "close": "14:00" },
        "sat": { "open": "07:00", "close": "14:00" },
        "sun": { "open": "07:00", "close": "14:00" }
      },
      "overrides": []
    },
    "lastUpdated": "2026-05-05T06:00:00Z"
  },
  {
    "id": "arlington-five-and-dime",
    "name": "Arlington Five & Dime",
    "category": "shop",
    "placeId": "",
    "hours": {
      "regular": {
        "mon": { "open": "10:00", "close": "18:00" },
        "tue": { "open": "10:00", "close": "18:00" },
        "wed": { "open": "10:00", "close": "18:00" },
        "thu": { "open": "10:00", "close": "18:00" },
        "fri": { "open": "10:00", "close": "18:00" },
        "sat": { "open": "10:00", "close": "17:00" },
        "sun": null
      },
      "overrides": []
    },
    "lastUpdated": "2026-05-05T06:00:00Z"
  },
  {
    "id": "kelines",
    "name": "Keline's",
    "category": "restaurant",
    "placeId": "",
    "hours": {
      "regular": {
        "mon": null,
        "tue": { "open": "11:00", "close": "20:00" },
        "wed": { "open": "11:00", "close": "20:00" },
        "thu": { "open": "11:00", "close": "20:00" },
        "fri": { "open": "11:00", "close": "20:00" },
        "sat": { "open": "11:00", "close": "20:00" },
        "sun": { "open": "11:00", "close": "19:00" }
      },
      "overrides": []
    },
    "lastUpdated": "2026-05-05T06:00:00Z"
  },
  {
    "id": "arlington-pet-shop",
    "name": "Arlington Pet Shop",
    "category": "shop",
    "placeId": "",
    "hours": {
      "regular": {
        "mon": { "open": "10:00", "close": "18:00" },
        "tue": { "open": "10:00", "close": "18:00" },
        "wed": { "open": "10:00", "close": "18:00" },
        "thu": { "open": "10:00", "close": "18:00" },
        "fri": { "open": "10:00", "close": "18:00" },
        "sat": { "open": "10:00", "close": "17:00" },
        "sun": { "open": "11:00", "close": "16:00" }
      },
      "overrides": []
    },
    "lastUpdated": "2026-05-05T06:00:00Z"
  },
  {
    "id": "middlesex-bank",
    "name": "Middlesex Savings Bank",
    "category": "shop",
    "placeId": "",
    "hours": {
      "regular": {
        "mon": { "open": "08:30", "close": "16:00" },
        "tue": { "open": "08:30", "close": "16:00" },
        "wed": { "open": "08:30", "close": "16:00" },
        "thu": { "open": "08:30", "close": "18:00" },
        "fri": { "open": "08:30", "close": "16:00" },
        "sat": { "open": "08:30", "close": "12:00" },
        "sun": null
      },
      "overrides": [
        { "date": "2026-05-25", "hours": null, "reason": "Memorial Day" }
      ]
    },
    "lastUpdated": "2026-05-05T06:00:00Z"
  }
]
```

Start by building the frontend against this sample data. Get the swipe interaction, filters, and status computation working first. The build script is a separate task.

## Things to avoid

- No frameworks (React, Vue, Svelte, etc.)
- No build tools (Webpack, Vite, etc.)
- No CSS frameworks (Tailwind, Bootstrap)
- No icon libraries — use no icons at all. Text only.
- No skeleton loaders or loading spinners
- No modals, drawers, or overlays
- No maps
- No analytics or tracking
- No "last updated 5 minutes ago" toast notifications — the timestamp at the bottom is sufficient
- No animations on the list itself (filter show/hide is instant). The only animation is the swipe gesture.
