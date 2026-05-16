// src/lib/projections.js

export const PROJECTIONS = [
  {
    code: 'EPSG:6491',
    label: 'EPSG:6491 — MA State Plane (US ft)',
    proj4def: '+proj=tmerc +lat_0=41 +lon_0=-71.5 +k=0.9999666667 +x_0=200000.0001016002 +y_0=750000.0001016002 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=us-ft +no_defs',
    xRange: [600000, 1000000],  // easting (US ft)
    yRange: [2400000, 3000000], // northing (US ft)
    hint: 'MA State Plane: easting ~600k–1000k ft, northing ~2.4M–3.0M ft',
  },
  {
    code: 'EPSG:6492',
    label: 'EPSG:6492 — RI State Plane (US ft)',
    proj4def: '+proj=tmerc +lat_0=41.08333333333334 +lon_0=-71.5 +k=0.99999375 +x_0=99999.99998983997 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=us-ft +no_defs',
    xRange: [200000, 500000],
    yRange: [0, 400000],
    hint: 'RI State Plane: easting ~200k–500k ft, northing ~0–400k ft',
  },
  {
    code: 'EPSG:32619',
    label: 'EPSG:32619 — UTM Zone 19N (meters)',
    proj4def: '+proj=utm +zone=19 +datum=WGS84 +units=m +no_defs',
    xRange: [166000, 834000],
    yRange: [0, 9400000],
    hint: 'UTM Zone 19N: easting ~166k–834k m, northing ~0–9.4M m',
  },
  {
    code: 'EPSG:32618',
    label: 'EPSG:32618 — UTM Zone 18N (meters)',
    proj4def: '+proj=utm +zone=18 +datum=WGS84 +units=m +no_defs',
    xRange: [166000, 834000],
    yRange: [0, 9400000],
    hint: 'UTM Zone 18N: easting ~166k–834k m, northing ~0–9.4M m',
  },
  {
    code: 'EPSG:4326',
    label: 'EPSG:4326 — WGS84 (lat/lon, no conversion)',
    proj4def: null,
    xRange: [-180, 180],  // longitude
    yRange: [-90, 90],    // latitude
    hint: 'WGS84: X=longitude (-180 to 180), Y=latitude (-90 to 90)',
  },
];

export const AUTO_DETECT_CODE = 'AUTO';

export const ALL_OPTIONS = [
  { code: AUTO_DETECT_CODE, label: 'AUTO — Auto-detect from coordinates' },
  ...PROJECTIONS,
];

/**
 * Given a sample X and Y, returns the best-matching projection or null.
 * Tries normal orientation first, then swapped.
 * Returns { projection, swapped }
 */
export const detectProjection = (x, y) => {
  // Check WGS84 first
  if (x >= -180 && x <= 180 && y >= -90 && y <= 90) {
    return { projection: PROJECTIONS.find(p => p.code === 'EPSG:4326'), swapped: false };
  }

  for (const proj of PROJECTIONS) {
    if (proj.code === 'EPSG:4326') continue;
    if (x >= proj.xRange[0] && x <= proj.xRange[1] &&
        y >= proj.yRange[0] && y <= proj.yRange[1]) {
      return { projection: proj, swapped: false };
    }
  }

  // Try swapped
  for (const proj of PROJECTIONS) {
    if (proj.code === 'EPSG:4326') continue;
    if (y >= proj.xRange[0] && y <= proj.xRange[1] &&
        x >= proj.yRange[0] && x <= proj.yRange[1]) {
      return { projection: proj, swapped: true };
    }
  }

  return null;
};

/**
 * Validates X/Y against a projection's expected ranges.
 * @param {number} x - raw CSV pano_pos_x
 * @param {number} y - raw CSV pano_pos_y
 * @param {string} projCode
 * @param {boolean} swapped - if true, check y against xRange and x against yRange
 * @returns {{ ok: boolean, message: string }}
 */
export const validateCoords = (x, y, projCode, swapped = false) => {
  const proj = PROJECTIONS.find(p => p.code === projCode);
  if (!proj) return { ok: false, message: `Unknown projection: ${projCode}` };

  const easting  = swapped ? y : x;
  const northing = swapped ? x : y;

  const xOk = easting  >= proj.xRange[0] && easting  <= proj.xRange[1];
  const yOk = northing >= proj.yRange[0] && northing <= proj.yRange[1];

  if (xOk && yOk) {
    return { ok: true, message: `Coordinates match ${proj.code}${swapped ? ' (X/Y swapped)' : ''}` };
  }

  return {
    ok: false,
    message: `X=${x.toFixed(1)}, Y=${y.toFixed(1)} are outside the expected range for ${proj.code}. ${proj.hint}`,
  };
};

/**
 * Checks both normal and swapped orientation for a given projection.
 * Returns { normalOk, swapOk }
 */
export const checkBothOrientations = (x, y, projCode) => {
  const normal = validateCoords(x, y, projCode, false);
  const swapped = validateCoords(x, y, projCode, true);
  return { normalOk: normal.ok, swapOk: swapped.ok };
};
