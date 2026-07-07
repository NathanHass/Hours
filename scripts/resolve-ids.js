#!/usr/bin/env node
// Resolves Google Place IDs for any business in businesses.json missing one.
// For each entry without a placeId, searches Google Places (New) by name,
// takes the top result, and writes back the placeId + canonical displayName.
// Usage: node scripts/resolve-ids.js  (reads GOOGLE_PLACES_API_KEY from .env)
//
// Re-runnable and safe: entries that already have a placeId are left untouched.
// Review the printed matches (and businesses.json) before running build.js.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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

// Bias searches toward Andover, MA so ambiguous names resolve locally.
const LOCATION_BIAS = {
  circle: {
    center: { latitude: 42.6583, longitude: -71.1368 },
    radius: 8000.0,
  },
};

async function searchTopMatch(query) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress",
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 1,
      locationBias: LOCATION_BIAS,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.places?.[0] ?? null;
}

async function main() {
  const bizPath = join(ROOT, "businesses.json");
  if (!existsSync(bizPath)) {
    console.error("Error: businesses.json not found in project root.");
    process.exit(1);
  }

  const businesses = JSON.parse(readFileSync(bizPath, "utf8"));
  let resolved = 0;
  let unresolved = 0;

  for (const biz of businesses) {
    if (biz.placeId) {
      console.log(`  keep   ${biz.name} (already has placeId)`);
      continue;
    }

    const query = `${biz.name} Andover MA`;
    try {
      process.stdout.write(`  find   ${biz.name}... `);
      const match = await searchTopMatch(query);
      if (!match) {
        console.log("NO MATCH");
        unresolved++;
      } else {
        biz.placeId = match.id;
        const canonical = match.displayName?.text;
        if (canonical) biz.name = canonical;
        console.log(`ok → ${canonical ?? biz.name}  [${match.formattedAddress ?? ""}]`);
        resolved++;
      }
    } catch (err) {
      console.log(`WARN: ${err.message}`);
      unresolved++;
    }

    // Be polite to the API
    await new Promise((r) => setTimeout(r, 200));
  }

  writeFileSync(bizPath, JSON.stringify(businesses, null, 2) + "\n");
  console.log(
    `\nResolved ${resolved}, unresolved ${unresolved}. Wrote businesses.json.`
  );
  if (unresolved > 0) {
    console.log(
      "Review any NO MATCH / WARN entries above and fix the name or add a placeId by hand."
    );
  }
  console.log("Verify the matched names/addresses look right, then run: npm run build");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
