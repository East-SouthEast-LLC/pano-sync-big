// src/lib/fileUtils.js
import Papa from 'papaparse';
import JSZip from 'jszip';
import proj4 from 'proj4';
import { PROJECTIONS } from './projections';

// Register all projection definitions with proj4
PROJECTIONS.forEach(p => {
  if (p.proj4def) {
    proj4.defs(p.code, p.proj4def);
  }
});

/**
 * Converts a projected coordinate pair to WGS84 [lon, lat].
 * If projCode is EPSG:4326, returns x/y as-is (already lon/lat).
 */
export const projectToWgs84 = (x, y, projCode) => {
  if (projCode === 'EPSG:4326') {
    return { lon: x, lat: y };
  }
  const [lon, lat] = proj4(projCode, 'EPSG:4326', [x, y]);
  return { lon, lat };
};

// ── Convex hull (Graham scan) on [lon, lat] points ───────────────────────────
function convexHull(points) {
  if (points.length < 3) {
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

  lower.pop();
  upper.pop();
  return [...lower, ...upper, lower[0]];
}

// ── Centroid from [lon, lat] points ──────────────────────────────────────────
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
 * Reads a CSV file and returns raw parsed rows plus a sample coordinate
 * for projection detection/validation — without doing any conversion yet.
 *
 * @param {File} csvFile
 * @returns {Promise<{ rows: object[], sampleX: number, sampleY: number }>}
 */
export const parseCsvRaw = (csvFile) => {
  return new Promise((resolve, reject) => {
    Papa.parse(csvFile, {
      delimiter: ';',
      header: false,
      skipEmptyLines: true,
      comments: '#',
      complete: (results) => {
        try {
          const col_names = [
            'ID', 'filename', 'timestamp', 'pano_pos_x', 'pano_pos_y', 'pano_pos_z',
            'pano_ori_w', 'pano_ori_x', 'pano_ori_y', 'pano_ori_z'
          ];

          const rows = results.data.map(rowArray =>
            col_names.reduce((obj, key, index) => {
              obj[key] = rowArray[index] ? rowArray[index].trim() : undefined;
              return obj;
            }, {})
          ).filter(row => row.filename);

          if (rows.length === 0) {
            return reject(new Error('CSV contains no valid rows.'));
          }

          const sampleX = parseFloat(rows[0].pano_pos_x);
          const sampleY = parseFloat(rows[0].pano_pos_y);

          resolve({ rows, sampleX, sampleY });
        } catch (err) {
          reject(err);
        }
      },
      error: (err) => reject(err),
    });
  });
};

/**
 * Converts pre-parsed CSV rows into a GeoJSON FeatureCollection,
 * using the supplied projection code for coordinate conversion.
 *
 * @param {object[]} rows - from parseCsvRaw
 * @param {string} prefix - e.g. "RIDGEVALE_20250626_"
 * @param {string} projCode - e.g. "EPSG:6491"
 * @param {Map} urlMap - filename → public URL
 * @returns {{ projectGeoJson: object, wgs84Points: number[][] }}
 */
export const buildProjectGeoJson = (rows, prefix, projCode, urlMap = new Map()) => {
  const features = [];
  const wgs84Points = [];

  rows.forEach((row) => {
    const shot_number = String(row.filename).split('-')[0];
    const key = `${prefix}${shot_number.padStart(5, '0')}.jpg`;
    const publicUrl = urlMap.get(key) || null;

    const x = parseFloat(row.pano_pos_x);
    const y = parseFloat(row.pano_pos_y);

    const { lat, lon } = projectToWgs84(x, y, projCode);
    wgs84Points.push([lon, lat]);

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [lon, lat],
      },
      properties: {
        id: parseInt(row.ID, 10),
        key,
        url: publicUrl,
        timestamp: parseFloat(row.timestamp),
        position: { x, y, z: parseFloat(row.pano_pos_z) },
        orientation: {
          w: parseFloat(row.pano_ori_w),
          x: parseFloat(row.pano_ori_x),
          y: parseFloat(row.pano_ori_y),
          z: parseFloat(row.pano_ori_z),
        },
      },
    });
  });

  return {
    projectGeoJson: { type: 'FeatureCollection', features },
    wgs84Points,
  };
};

/**
 * Builds a GeoJSON Feature for the master index (pano_index.geojson).
 */
export const buildIndexFeature = (folder, imageCount, wgs84Points, metadata, publicUrl) => {
  const hullCoords = convexHull(wgs84Points);
  const center = centroid(wgs84Points);

  const dateMatch = folder.match(/(\d{4}-\d{2}-\d{2}|\d{8})$/);
  let date = '';
  if (dateMatch) {
    const raw = dateMatch[1];
    date = raw.length === 8
      ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
      : raw;
  }

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [hullCoords],
    },
    properties: {
      id: folder,
      name: metadata.name || folder,
      town: metadata.town || '',
      owner: metadata.owner || 'ESE LLC',
      description: metadata.description || '',
      date,
      image_count: imageCount,
      centroid: center,
      data_url: `${publicUrl}/${folder}/pano_data.geojson`,
    },
  };
};

/**
 * Merges a new Feature into an existing GeoJSON FeatureCollection.
 * Replaces any existing feature with the same properties.id.
 */
export const mergeIndexFeature = (existingCollection, newFeature) => {
  const existing = Array.isArray(existingCollection)
    ? { type: 'FeatureCollection', features: [] }
    : existingCollection;

  const filtered = (existing.features || []).filter(
    f => f.properties?.id !== newFeature.properties.id
  );

  return {
    type: 'FeatureCollection',
    features: [...filtered, newFeature],
  };
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
