// src/lib/fileUtils.js
import Papa from 'papaparse';
import JSZip from 'jszip';

// ── EPSG:6491 → WGS84 conversion (Massachusetts State Plane, US Survey Feet)
// Uses a manual Transverse Mercator formula — no proj4 dependency needed.
const EPSG6491 = {
  a: 6378137.0,           // semi-major axis (m)
  f: 1 / 298.257222101,   // flattening
  k0: 0.9999666667,       // scale factor
  lon0: -71.5 * Math.PI / 180, // central meridian
  lat0: 41.0 * Math.PI / 180,  // latitude of origin
  fe: 200000.0 * 0.3048006096012192, // false easting (m, converted from US ft)
  fn: 750000.0 * 0.3048006096012192, // false northing (m, converted from US ft)
  ftToM: 0.3048006096012192,          // US survey foot to metre
};

function spcsToLatLon(xFt, yFt) {
  const { a, f, k0, lon0, lat0, fe, fn, ftToM } = EPSG6491;

  // Convert feet to metres
  const x = xFt * ftToM - fe;
  const y = yFt * ftToM - fn;

  const b = a * (1 - f);
  const e2 = 2 * f - f * f;
  const e = Math.sqrt(e2);
  const ep2 = e2 / (1 - e2);

  // Meridional arc at origin
  const n = (a - b) / (a + b);
  const n2 = n * n; const n3 = n2 * n; const n4 = n3 * n;
  const M0 = a * (
    (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * lat0
    - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * lat0)
    + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * lat0)
    - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * lat0)
  );

  const M = M0 + y / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));

  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
    + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu)
    + (1097 * e1 * e1 * e1 * e1 / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const T1 = Math.tan(phi1) * Math.tan(phi1);
  const C1 = ep2 * Math.cos(phi1) * Math.cos(phi1);
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = x / (N1 * k0);
  const D2 = D * D;

  const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (
    D2 / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D2 * D2 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D2 * D2 * D2 / 720
  );

  const lon = lon0 + (
    D
    - (1 + 2 * T1 + C1) * D2 * D / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D2 * D2 * D / 120
  ) / Math.cos(phi1);

  return {
    lat: lat * 180 / Math.PI,
    lon: lon * 180 / Math.PI,
  };
}

// ── Convex hull (Graham scan) on [lon, lat] points
function convexHull(points) {
  if (points.length < 3) {
    // Return a small buffer around the points for < 3 points
    if (points.length === 0) return [];
    const lons = points.map(p => p[0]);
    const lats = points.map(p => p[1]);
    const buf = 0.0001;
    const minLon = Math.min(...lons) - buf;
    const maxLon = Math.max(...lons) + buf;
    const minLat = Math.min(...lats) - buf;
    const maxLat = Math.max(...lats) + buf;
    return [[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]];
  }

  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const cross = (O, A, B) =>
    (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);

  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }

  const upper = [];
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }

  // Remove last point of each half (duplicates first of other half)
  lower.pop();
  upper.pop();
  return [...lower, ...upper, lower[0]]; // close the ring
}

// ── Build a centroid from an array of [lon, lat] points
function centroid(points) {
  const n = points.length;
  const lon = points.reduce((s, p) => s + p[0], 0) / n;
  const lat = points.reduce((s, p) => s + p[1], 0) / n;
  return [lon, lat];
}

/**
 * Renames uploaded image files based on a prefix.
 * Example: 001-pano.jpg -> MYPREFIX_001.jpg
 */
export const renameImageFiles = async (imageFiles, prefix) => {
  const renamedFiles = imageFiles.map((file) => {
    const match = file.name.match(/^(\d+)-pano\.jpg$/i);
    if (match && match[1]) {
      const originalNumber = match[1].padStart(5, '0');
      const newName = `${prefix}${originalNumber}.jpg`;
      return new File([file], newName, { type: file.type });
    }
    return null;
  });
  return renamedFiles.filter(file => file !== null);
};

/**
 * Parses a CSV file and converts it to a JSON object for this project only.
 * Returns { projectJson, wgs84Points } where wgs84Points is [[lon,lat], ...]
 * for hull computation.
 */
export const convertCsvToJson = (csvFile, prefix, urlMap = new Map()) => {
  return new Promise((resolve, reject) => {
    Papa.parse(csvFile, {
      delimiter: ';',
      header: false,
      skipEmptyLines: true,
      comments: '#',
      complete: (results) => {
        try {
          const projectJson = {};
          const wgs84Points = [];

          const col_names = [
            'ID', 'filename', 'timestamp', 'pano_pos_x', 'pano_pos_y', 'pano_pos_z',
            'pano_ori_w', 'pano_ori_x', 'pano_ori_y', 'pano_ori_z'
          ];

          results.data.forEach((rowArray, rowIndex) => {
            const row = col_names.reduce((obj, key, index) => {
              obj[key] = rowArray[index] ? rowArray[index].trim() : undefined;
              return obj;
            }, {});

            if (!row.filename) {
              console.warn(`Skipping row ${rowIndex + 2} due to missing filename.`);
              return;
            }

            const shot_number = String(row.filename).split('-')[0];
            const key = `${prefix}${shot_number.padStart(5, '0')}.jpg`;
            const publicUrl = urlMap.get(key) || null;

            const x = parseFloat(row.pano_pos_x);
            const y = parseFloat(row.pano_pos_y);

            // Convert to WGS84 for hull/centroid
            const { lat, lon } = spcsToLatLon(x, y);
            wgs84Points.push([lon, lat]);

            projectJson[key] = {
              id: parseInt(row.ID, 10),
              url: publicUrl,
              timestamp: parseFloat(row.timestamp),
              position: {
                x,
                y,
                z: parseFloat(row.pano_pos_z),
              },
              orientation: {
                w: parseFloat(row.pano_ori_w),
                x: parseFloat(row.pano_ori_x),
                y: parseFloat(row.pano_ori_y),
                z: parseFloat(row.pano_ori_z),
              },
            };
          });

          resolve({ projectJson, wgs84Points });
        } catch (error) {
          reject(error);
        }
      },
      error: (error) => reject(error),
    });
  });
};

/**
 * Merges newly converted JSON data into existing master JSON data.
 * New data takes precedence and will overwrite existing keys.
 * Kept for backward compatibility during migration.
 */
export const mergeJsonData = (existingJson, newJson) => {
  return { ...existingJson, ...newJson };
};

/**
 * Builds a master index entry for this project.
 * @param {string} folder - e.g. "RIDGEVALE_20250626"
 * @param {object} projectJson - the per-project pano entries
 * @param {number[]} wgs84Points - [[lon,lat], ...] from CSV conversion
 * @param {object} metadata - { name, town, owner, description }
 * @param {string} publicUrl - R2 base URL
 * @returns {object} - one index entry
 */
export const buildIndexEntry = (folder, projectJson, wgs84Points, metadata, publicUrl) => {
  const hullCoords = convexHull(wgs84Points);
  const center = centroid(wgs84Points);

  // Parse date from folder name — expects PROJECTNAME_YYYYMMDD or PROJECTNAME_YYYY-MM-DD
  const dateMatch = folder.match(/(\d{4}-\d{2}-\d{2}|\d{8})$/);
  let date = '';
  if (dateMatch) {
    const raw = dateMatch[1];
    date = raw.length === 8
      ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
      : raw;
  }

  return {
    id: folder,
    name: metadata.name || folder,
    town: metadata.town || '',
    description: metadata.description || '',
    owner: metadata.owner || 'ESE LLC',
    date,
    image_count: Object.keys(projectJson).length,
    json_url: `${publicUrl}/${folder}/pano_data.json`,
    centroid: center,
    hull: {
      type: 'Polygon',
      coordinates: [hullCoords],
    },
  };
};

/**
 * Merges a new index entry into the existing master index array.
 * Replaces the entry with the same id if it exists.
 */
export const mergeIndexEntry = (existingIndex, newEntry) => {
  const filtered = existingIndex.filter(e => e.id !== newEntry.id);
  return [...filtered, newEntry];
};

/**
 * Creates a zip archive from an array of files.
 */
export const createZip = async (files, zipName) => {
  const zip = new JSZip();
  files.forEach((file) => {
    zip.file(file.name, file);
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  return blob;
};
