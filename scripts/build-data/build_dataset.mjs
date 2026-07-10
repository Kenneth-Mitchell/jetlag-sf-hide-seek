import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import XLSX from "xlsx";

const ROOT = process.cwd();
const DEFAULT_WORKBOOK = "/Users/kenneth/Downloads/JLH&S Sheets San Francisco.xlsx";
const WORKBOOK_PATH = process.env.JETLAG_SF_XLSX ?? DEFAULT_WORKBOOK;
const OUT_PATH = path.join(ROOT, "src", "data", "sf-snapshot.json");
const CACHE_PATH = path.join(ROOT, "scripts", "build-data", "geocode-cache.json");
const SNAPSHOT_DATE = "2026-07-10";
const HIDE_RADIUS_MILES = 0.25;

const POINT_TABS = {
  validStations: {
    sheet: "Game Valid Stations",
    count: 193,
    name: "name",
    lat: "pin latitude",
    lng: "pin longitude",
    category: "valid-station",
    extra: ["stopID", "primary_system", "associated_lines", "other_systems", "GMaps pin", "notes"],
  },
  railStations: {
    sheet: "Rail Stations",
    count: 35,
    name: "name",
    lat: "pin latitude",
    lng: "pin longitude",
    category: "rail-station",
    extra: ["stopID", "primary_system", "associated_lines", "other_systems", "GMaps pin", "notes"],
  },
  mountains: {
    sheet: "Mountains (>400ft)",
    count: 18,
    coords: 16,
    name: "name",
    lat: "latitude",
    lng: "longitude",
    category: "mountain",
    extra: ["height", "maps_link"],
  },
  dogParks: {
    sheet: "Dog Parks",
    count: 33,
    name: "name",
    lat: "latitude",
    lng: "longitude",
    category: "dog-park",
    extra: ["gmaps_link"],
  },
  aquariums: {
    sheet: "Aquariums",
    count: 2,
    name: "name",
    lat: "latitude",
    lng: "longitude",
    category: "aquarium",
    extra: ["maps_link"],
  },
  golfCourses: {
    sheet: "Golf Courses",
    count: 8,
    name: "name",
    lat: "latitude",
    lng: "longitude",
    category: "golf-course",
    extra: [],
  },
  museums: {
    sheet: "Museums",
    count: 49,
    coords: 49,
    name: "name",
    lat: "latitude",
    lng: "longitude",
    category: "museum",
    extra: ["address", "maps_link", "notes"],
    geocode: true,
  },
  movieTheaters: {
    sheet: "Movie Theaters",
    count: 17,
    name: "name",
    lat: "latitude",
    lng: "longitude",
    category: "movie-theater",
    extra: ["address", "maps_link"],
  },
  libraries: {
    sheet: "Libraries",
    count: 29,
    name: "name",
    lat: "latitude",
    lng: "longitude",
    category: "library",
    extra: ["maps_link"],
  },
  hospitals: {
    sheet: "Hospitals",
    count: 16,
    name: "name",
    lat: "latitude",
    lng: "longitude",
    category: "hospital",
    extra: ["address", "gMaps_link"],
  },
  foreignConsulates: {
    sheet: "Foreign Consulates",
    count: 38,
    name: "name",
    lat: "latitude",
    lng: "longitude",
    category: "foreign-consulate",
    extra: ["flag", "address", "gmaps_link"],
  },
  farmersMarkets: {
    sheet: "Farmers Markets",
    count: 17,
    name: "name",
    lat: "latitude",
    lng: "longitude",
    category: "farmers-market",
    extra: ["dotw", "maps_link", "notes"],
    enabled: false,
  },
  muniStops: {
    sheet: "All Muni Stops (datasf)",
    minCount: 3200,
    name: "STOPNAME",
    lat: "LATITUDE",
    lng: "LONGITUDE",
    category: "muni-stop",
    extra: ["STOPID", "TRAPEZESTOPABBR", "ONSTREET", "ATSTREET", "SUPERVISOR_DISTRICT", "shape"],
    referenceOnly: true,
  },
};

const GEOMETRY_SOURCES = {
  playableArea:
    "https://data.sfgov.org/resource/hcgx-vtsb.geojson?$limit=5000",
  supervisorDistricts:
    "https://data.sfgov.org/resource/f2zs-jevy.geojson?$limit=5000",
};

function normalizeHeader(value) {
  return String(value ?? "").trim();
}

function readRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Missing worksheet: ${sheetName}`);
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const headers = [];
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const ref = XLSX.utils.encode_cell({ r: range.s.r, c: col });
    headers.push(normalizeHeader(sheet[ref]?.v));
  }

  const rows = [];
  for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
    const record = { __row: row + 1, __links: {} };
    let hasValue = false;
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const header = headers[col - range.s.c];
      if (!header) continue;
      const ref = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[ref];
      const value = cell?.v;
      if (value !== undefined && value !== null && value !== "") {
        hasValue = true;
      }
      record[header] = value ?? "";
      if (cell?.l?.Target) {
        record.__links[header] = cell.l.Target;
      }
    }
    if (hasValue) rows.push(record);
  }
  return rows;
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function checksum(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function extractMapsCoordinates(url) {
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),/,
    /[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return { lat: Number(match[1]), lng: Number(match[2]) };
    }
  }
  return undefined;
}

async function resolveMapsLink(link, cache, cacheKey) {
  if (!link) throw new Error(`No maps link available for ${cacheKey}`);
  if (cache[cacheKey]?.lat && cache[cacheKey]?.lng) {
    return cache[cacheKey];
  }

  const response = await fetch(link, { method: "HEAD", redirect: "manual" });
  const location = response.headers.get("location") ?? response.url;
  const coords = extractMapsCoordinates(location);
  if (!coords) {
    throw new Error(`Could not extract coordinates for ${cacheKey} from ${location}`);
  }

  cache[cacheKey] = {
    ...coords,
    source: link,
    sourceKind: "google-maps-redirect",
    resolvedUrl: location,
    resolvedAt: SNAPSHOT_DATE,
  };
  return cache[cacheKey];
}

async function geocodeAddress(address, name, cache, cacheKey) {
  if (!address && !name) throw new Error(`No address or name available for ${cacheKey}`);
  const addressKey = `${cacheKey}:address`;
  if (cache[addressKey]?.lat && cache[addressKey]?.lng) {
    return cache[addressKey];
  }
  const queries = [
    address ? `${address}, San Francisco, CA` : undefined,
    address && name ? `${name}, ${address}, San Francisco, CA` : undefined,
    name ? `${name}, San Francisco, CA` : undefined,
  ].filter(Boolean);
  let first;
  let usedUrl;
  for (const query of queries) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("q", query);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "jetlag-sf-hide-seek-build/0.1 (local dataset builder)",
      },
    });
    if (!response.ok) {
      throw new Error(`Geocoder failed for ${cacheKey}: ${response.status} ${response.statusText}`);
    }
    const results = await response.json();
    if (results[0]?.lat && results[0]?.lon) {
      first = results[0];
      usedUrl = url;
      break;
    }
  }
  if (!first?.lat || !first?.lon) {
    throw new Error(`No geocoder result for ${cacheKey}: ${address}`);
  }
  cache[addressKey] = {
    lat: Number(first.lat),
    lng: Number(first.lon),
    source: address,
    sourceKind: "nominatim-address",
    resolvedUrl: usedUrl.toString(),
    displayName: first.display_name,
    resolvedAt: SNAPSHOT_DATE,
  };
  return cache[addressKey];
}

function pointFeature(record, config, lat, lng) {
  const idBase = record.objectID ?? record.OBJECTID ?? record[config.name];
  const properties = {
    id: `${config.category}:${slugify(idBase)}`,
    sourceId: String(idBase ?? ""),
    name: String(record[config.name] ?? "").trim(),
    category: config.category,
    sourceSheet: config.sheet,
    enabled: config.enabled ?? true,
    referenceOnly: config.referenceOnly ?? false,
  };

  for (const key of config.extra ?? []) {
    if (record[key] !== undefined && record[key] !== "") {
      properties[key] = record[key];
    }
    if (record.__links?.[key]) {
      properties[`${key}_href`] = record.__links[key];
    }
  }

  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties,
  };
}

async function buildPointLayer(workbook, key, config, cache, warnings) {
  const allRows = readRows(workbook, config.sheet);
  const rows = allRows.filter((row) => String(row[config.name] ?? "").trim());
  if (config.count !== undefined && rows.length !== config.count) {
    throw new Error(`${config.sheet}: expected ${config.count} rows, found ${rows.length}`);
  }
  if (config.minCount !== undefined && rows.length < config.minCount) {
    throw new Error(`${config.sheet}: expected at least ${config.minCount} rows, found ${rows.length}`);
  }

  const features = [];
  const missing = [];
  for (const row of rows) {
    let lat = asNumber(row[config.lat]);
    let lng = asNumber(row[config.lng]);
    if ((lat === undefined || lng === undefined) && config.geocode) {
      const link =
        row.__links?.maps_link ??
        row.__links?.gmaps_link ??
        row.__links?.gMaps_link ??
        row.maps_link ??
        row.gmaps_link ??
        row.gMaps_link;
      const cacheKey = `${config.sheet}:${row.objectID}:${row[config.name]}`;
      let resolved;
      try {
        resolved = await resolveMapsLink(link, cache, cacheKey);
      } catch (error) {
        resolved = await geocodeAddress(row.address, row[config.name], cache, cacheKey);
        warnings.push(`${config.sheet}: ${row[config.name]} geocoded by address fallback because Maps link lacked coordinates.`);
      }
      lat = resolved.lat;
      lng = resolved.lng;
    }
    if (lat === undefined || lng === undefined) {
      missing.push(`${row.__row}:${row[config.name]}`);
      continue;
    }
    features.push(pointFeature(row, config, lat, lng));
  }

  const expectedCoords = config.coords ?? rows.length;
  if (features.length !== expectedCoords) {
    const detail = missing.length ? ` Missing: ${missing.join(", ")}` : "";
    throw new Error(`${config.sheet}: expected ${expectedCoords} coordinate rows, found ${features.length}.${detail}`);
  }

  if (key === "dogParks") {
    warnings.push("Dog Parks: sheet has 33 rows; rules prose says 36. Using sheet as authoritative.");
  }
  if (key === "farmersMarkets") {
    warnings.push("Farmers Markets ingested but disabled; rules doc marks this homebrew question untested.");
  }
  if (key === "muniStops") {
    warnings.push("All Muni Stops ingested as reference-only data; Game Valid Stations remains the hiding-station universe.");
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

async function fetchGeoJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function main() {
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  const cache = JSON.parse(await fs.readFile(CACHE_PATH, "utf8").catch(() => "{}"));
  const workbook = XLSX.readFile(WORKBOOK_PATH, { cellDates: true });
  const warnings = [];
  const layers = {};
  const integrity = {};

  for (const [key, config] of Object.entries(POINT_TABS)) {
    const layer = await buildPointLayer(workbook, key, config, cache, warnings);
    layers[key] = layer;
    integrity[key] = {
      sheet: config.sheet,
      features: layer.features.length,
      checksum: checksum(JSON.stringify(layer)),
    };
  }

  const geometries = {};
  for (const [key, url] of Object.entries(GEOMETRY_SOURCES)) {
    const geojson = await fetchGeoJson(url);
    geometries[key] = geojson;
    integrity[key] = {
      source: url,
      features: geojson.features?.length ?? 0,
      checksum: checksum(JSON.stringify(geojson)),
    };
  }

  const snapshot = {
    schemaVersion: 1,
    generatedAt: `${SNAPSHOT_DATE}T00:00:00-07:00`,
    rulesVersion: "SF homebrew Beta v1.1, last updated 2026-06-05",
    hideRadiusMiles: HIDE_RADIUS_MILES,
    sourceWorkbook: WORKBOOK_PATH,
    sources: {
      workbook: "JLH&S Sheets San Francisco.xlsx",
      rules: "Jet Lag H&S SF Rules Modifications.md",
      playableArea: GEOMETRY_SOURCES.playableArea,
      supervisorDistricts: GEOMETRY_SOURCES.supervisorDistricts,
    },
    warnings,
    integrity,
    layers,
    geometries,
  };

  await fs.writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
  await fs.writeFile(OUT_PATH, `${JSON.stringify(snapshot)}\n`);

  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)}`);
  for (const warning of warnings) console.warn(`WARN ${warning}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
