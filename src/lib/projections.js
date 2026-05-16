// src/lib/projections.js
// Supported coordinate systems for pano-sync-big.
// Each entry includes a proj4 definition string and expected raw coordinate
// ranges so we can sanity-check incoming CSV data before converting.

export const PROJECTIONS = [
  {
    code: 'EPSG:6491',
    label: 'EPSG:6491 — MA State Plane (US ft)',
    proj4def: '+proj=tmerc +lat_0=41 +lon_0=-71.5 +k=0.9999666667 +x_0=200000.0001016002 +y_0=750000.0001016002 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=us-ft +no_defs',
    // Expected raw X (easting) and Y (northing) ranges in US survey feet
    xRange: [600000, 1000000],
    yRange: [2400000, 3000000],
    hint: 'MA State Plane eastings ~600k–1000k ft, northings ~2.4M–3.0M ft',
  },
  {
    code: 'EPSG:6492',
    label: 'EPSG:6492 — RI State Plane (US ft)',
    proj4def: '+proj=tmerc +lat_0=41.08333333333334 +lon_0=-71.5 +k=0.99999375 +x_0=99999.99998983997 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=us-ft +no_defs',
    xRange: [200000, 500000],
    yRange: [0, 400000],
    hint: 'RI State Plane eastings ~200k–500k ft, northings ~0–400k ft',
  },
  {
    code: 'EPSG:32619',
    label: 'EPSG:32619 — UTM Zone 19N (meters)',
    proj4def: '+proj=utm +zone=19 +datum=WGS84 +units=m +no_defs',
    xRange: [166000, 834000],
    yRange: [0, 9400000],
    hint: 'UTM Zone 19N eastings ~166k–834k m, northings ~0–9.4M m',
  },
  {
    code: 'EPSG:32618',
    label: 'EPSG:32618 — UTM Zone 18N (meters)',
    proj4def: '+proj=utm +zone=18 +datum=WGS84 +units=m +no_defs',
    xRange: [166000, 834000],
    yRange: [0, 9400000],
    hint: 'UTM Zone 18N eastings ~166k–834k m, northings ~0–9.4M m',
  },
  {
    code: 'EPSG:4326',
    label: 'EPSG:4326 — WGS84 (lat/lon, no conversion)',
    proj4def: null, // no conversion needed
    xRange: [-180, 180],
    yRange: [-90, 90],
    hint: 'Already lat/lon — X should be longitude (-180 to 180), Y should be latitude (-90 to 90)',
  },
];

export const AUTO_DETECT_CODE = 'AUTO';

export const ALL_OPTIONS = [
  { code: AUTO_DETECT_CODE, label: 'Auto-detect from coordinates' },
  ...PROJECTIONS,
];

/**
 * Given a sample X and Y value, returns the best-matching projection
 * from PROJECTIONS, or null if nothing matches.
 */
export const detectProjection = (x, y) => {
  // Check WGS84 first — if it looks like decimal degrees
  if (x >= -180 && x <= 180 && y >= -90 && y <= 90) {
    return PROJECTIONS.find(p => p.code === 'EPSG:4326');
  }

  // Try each projection's expected ranges
  for (const proj of PROJECTIONS) {
    if (proj.code === 'EPSG:4326') continue;
    if (
      x >= proj.xRange[0] && x <= proj.xRange[1] &&
      y >= proj.yRange[0] && y <= proj.yRange[1]
    ) {
      return proj;
    }
  }

  return null;
};

/**
 * Checks whether a given X/Y pair falls within the expected range
 * for a projection. Returns { ok, message }.
 */
export const validateCoords = (x, y, projCode) => {
  const proj = PROJECTIONS.find(p => p.code === projCode);
  if (!proj) return { ok: false, message: `Unknown projection: ${projCode}` };

  const xOk = x >= proj.xRange[0] && x <= proj.xRange[1];
  const yOk = y >= proj.yRange[0] && y <= proj.yRange[1];

  if (xOk && yOk) {
    return { ok: true, message: `Coordinates match ${proj.code}` };
  }

  return {
    ok: false,
    message: `Coordinates (X=${x.toFixed(1)}, Y=${y.toFixed(1)}) are outside the expected range for ${proj.code}. ${proj.hint}`,
  };
};
