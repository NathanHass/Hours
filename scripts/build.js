#!/usr/bin/env node
// Fetches hours from Google Places API (New) and writes hours.json.
// Usage: node scripts/build.js  (reads GOOGLE_PLACES_API_KEY from .env)

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Load .env without any external dependencies
const envPath = join(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) {
  console.error("Error: GOOGLE_PLACES_API_KEY is not set.");
  console.error("  Add it to .env: GOOGLE_PLACES_API_KEY=your_key_here");
  process.exit(1);
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatTime(hour, minute) {
  return `${pad(hour)}:${pad(minute)}`;
}

// Maps Google's regularOpeningHours.periods → { mon: {open,close}|null, ... }
function parseRegularHours(regularOpeningHours) {
  const result = {
    sun: null,
    mon: null,
    tue: null,
    wed: null,
    thu: null,
    fri: null,
    sat: null,
  };
  const periods = regularOpeningHours?.periods;
  if (!periods) return result;

  // Google encodes "open 24/7" as a single period at day 0 with no close.
  if (periods.length === 1 && periods[0].open && !periods[0].close) {
    for (const d of DAYS) result[d] = { open: "00:00", close: "24:00" };
    return result;
  }

  for (const period of periods) {
    const dayKey = DAYS[period.open?.day];
    if (!dayKey) continue;
    if (!period.close) {
      // Open 24 hours on this day (period with no close)
      result[dayKey] = { open: "00:00", close: "24:00" };
      continue;
    }
    result[dayKey] = {
      open: formatTime(period.open.hour ?? 0, period.open.minute ?? 0),
      close: formatTime(period.close.hour ?? 0, period.close.minute ?? 0),
    };
  }
  return result;
}

// Maps currentOpeningHours specialDays + periods → override array
function parseOverrides(currentOpeningHours) {
  if (!currentOpeningHours?.specialDays?.length) return [];

  const periods = currentOpeningHours.periods ?? [];
  const overrides = [];

  for (const specialDay of currentOpeningHours.specialDays) {
    const { year, month, day } = specialDay.date;
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;

    // Find periods whose open.date matches this special day
    const match = periods.find((p) => {
      const d = p.open?.date;
      return d && d.year === year && d.month === month && d.day === day;
    });

    if (!match) {
      // Special day with no open period = closed
      overrides.push({ date: dateStr, hours: null });
    } else {
      overrides.push({
        date: dateStr,
        hours: {
          open: formatTime(match.open.hour ?? 0, match.open.minute ?? 0),
          close: formatTime(match.close.hour ?? 0, match.close.minute ?? 0),
        },
      });
    }
  }

  return overrides;
}

async function fetchPlace(placeId) {
  const url = `https://places.googleapis.com/v1/places/${placeId}`;
  const res = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask":
        "displayName,nationalPhoneNumber,shortFormattedAddress,location,websiteUri,regularOpeningHours,currentOpeningHours",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

async function main() {
  const bizPath = join(ROOT, "businesses.json");
  if (!existsSync(bizPath)) {
    console.error("Error: businesses.json not found in project root.");
    process.exit(1);
  }

  const businesses = JSON.parse(readFileSync(bizPath, "utf8"));
  const results = [];

  for (const biz of businesses) {
    if (!biz.placeId) {
      console.warn(`  skip  ${biz.name} (no placeId)`);
      continue;
    }

    try {
      process.stdout.write(`  fetch ${biz.name}... `);
      const data = await fetchPlace(biz.placeId);

      results.push({
        id: biz.id,
        name: biz.name,
        category: biz.category,
        placeId: biz.placeId,
        phone: data.nationalPhoneNumber ?? null,
        address: data.shortFormattedAddress ?? null,
        lat: data.location?.latitude ?? null,
        lng: data.location?.longitude ?? null,
        website: data.websiteUri ?? null,
        hours: {
          regular: parseRegularHours(data.regularOpeningHours),
          overrides: parseOverrides(data.currentOpeningHours),
        },
        lastUpdated: new Date().toISOString(),
      });

      console.log("ok");
    } catch (err) {
      console.log(`WARN: ${err.message}`);
    }

    // Be polite to the API
    await new Promise((r) => setTimeout(r, 200));
  }

  const outPath = join(ROOT, "app", "hours.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
  console.log(`\nWrote ${results.length} businesses to app/hours.json`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
