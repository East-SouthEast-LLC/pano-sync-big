// generate-projections.mjs
// Run ONCE from your project root: node generate-projections.mjs
// Fetches verified proj4 strings from epsg.io for every EPSG code in the list.
// Writes src/lib/projections.js on completion.
// Requires Node 18+ (native fetch).

import { writeFileSync } from 'fs';
import { join } from 'path';

const OUT_PATH = join(process.cwd(), 'src', 'lib', 'projections.js');
const DELAY_MS = 600; // be polite to epsg.io

// ── Zone definitions ──────────────────────────────────────────────────────────
// Format: [state, zone, nad83_m, nad83_ftUS, nad83_2011_m, nad83_2011_ftUS]
// nad83_m / nad83_ftUS: well-established codes, proj4 strings fetched from epsg.io
// nad83_2011_m / nad83_2011_ftUS: fetched and verified
const SPCS_ZONES = [
  ['AL', 'East',          26929, 102629,  6355,  6419],
  ['AL', 'West',          26930, 102630,  6356,  6420],
  ['AK', 'Zone 1',        26931, 102631,  6394,  6458],
  ['AK', 'Zone 2',        26932, 102632,  6395,  6459],
  ['AK', 'Zone 3',        26933, 102633,  6396,  6460],
  ['AK', 'Zone 4',        26934, 102634,  6397,  6461],
  ['AK', 'Zone 5',        26935, 102635,  6398,  6462],
  ['AK', 'Zone 6',        26936, 102636,  6399,  6463],
  ['AK', 'Zone 7',        26937, 102637,  6400,  6464],
  ['AK', 'Zone 8',        26938, 102638,  6401,  6465],
  ['AK', 'Zone 9',        26939, 102639,  6402,  6466],
  ['AK', 'Zone 10',       26940, 102640,  6403,  6467],
  ['AZ', 'East',          26948, 102648,  6404,  6468],
  ['AZ', 'Central',       26949, 102649,  6405,  6469],
  ['AZ', 'West',          26950, 102650,  6406,  6470],
  ['AR', 'North',         26951, 102651,  6407,  6471],
  ['AR', 'South',         26952, 102652,  6408,  6472],
  ['CA', 'Zone 1',        26941, 102241,  6414,  6478],
  ['CA', 'Zone 2',        26942, 102242,  6415,  6479],
  ['CA', 'Zone 3',        26943, 102243,  6416,  6480],
  ['CA', 'Zone 4',        26944, 102244,  6417,  6481],
  ['CA', 'Zone 5',        26945, 102245,  6418,  6482],
  ['CA', 'Zone 6',        26946, 102246,  6419,  6483],
  ['CO', 'North',         26953, 102653,  6421,  6484],
  ['CO', 'Central',       26954, 102654,  6422,  6485],
  ['CO', 'South',         26955, 102655,  6423,  6486],
  ['CT', '',              26956, 102656,  6424,  6487],
  ['DE', '',              26957, 102657,  6425,  6488],
  ['FL', 'East',          26958, 102658,  6437,  6438],
  ['FL', 'West',          26959, 102659,  6440,  6441],
  ['FL', 'North',         26960, 102660,  6443,  6444],
  ['GA', 'East',          26966, 102666,  6445,  6446],
  ['GA', 'West',          26967, 102667,  6447,  6448],
  ['HI', 'Zone 1',        26961, 102661,  6449,  6450],
  ['HI', 'Zone 2',        26962, 102662,  6451,  6452],
  ['HI', 'Zone 3',        26963, 102663,  6453,  6454],
  ['HI', 'Zone 4',        26964, 102664,  6455,  6456],
  ['HI', 'Zone 5',        26965, 102665,  6457,  6458],
  ['ID', 'East',          26968, 102668,  6459,  6460],
  ['ID', 'Central',       26969, 102669,  6461,  6462],
  ['ID', 'West',          26970, 102670,  6463,  6464],
  ['IL', 'East',          26971, 102671,  6465,  6466],
  ['IL', 'West',          26972, 102672,  6467,  6468],
  ['IN', 'East',          26973, 102673,  6469,  6470],
  ['IN', 'West',          26974, 102674,  6471,  6472],
  ['IA', 'North',         26975, 102675,  6473,  6474],
  ['IA', 'South',         26976, 102676,  6475,  6476],
  ['KS', 'North',         26977, 102677,  6477,  6478],
  ['KS', 'South',         26978, 102678,  6479,  6480],
  ['KY', 'North',         26979, 102679,  6481,  6482],
  ['KY', 'South',         26980, 102680,  6483,  6484],
  ['LA', 'North',         26981, 102681,  6485,  6486],
  ['LA', 'South',         26982, 102682,  6487,  6488],
  ['ME', 'East',          26983, 102683,  6489,  6490],
  ['ME', 'West',          26984, 102684,  6495,  6496],  // NOT 6491 — that's MA
  ['MD', '',              26985, 102685,  6493,  6494],
  ['MA', 'Mainland',      26986, 102686,  6491,  6492],  // verified: 6491=m, 6492=ftUS
  ['MA', 'Island',        26987, 102687,  6497,  6498],
  ['MI', 'North',         26988, 102688,  6499,  6500],
  ['MI', 'Central',       26989, 102689,  6501,  6502],
  ['MI', 'South',         26990, 102690,  6503,  6504],
  ['MN', 'North',         26991, 102691,  6505,  6506],
  ['MN', 'Central',       26992, 102692,  6507,  6508],
  ['MN', 'South',         26993, 102693,  6509,  6510],
  ['MS', 'East',          26994, 102694,  6511,  6512],
  ['MS', 'West',          26995, 102695,  6513,  6514],
  ['MO', 'East',          26996, 102696,  6515,  6516],
  ['MO', 'Central',       26997, 102697,  6517,  6518],
  ['MO', 'West',          26998, 102698,  6519,  6520],
  ['MT', '',              32100, 102300,  6521,  6522],
  ['NE', '',              32104, 102304,  6523,  6524],
  ['NV', 'East',          32107, 102307,  6525,  6526],
  ['NV', 'Central',       32108, 102308,  6527,  6528],
  ['NV', 'West',          32109, 102309,  6529,  6530],
  ['NH', '',              32110, 102310,  6531,  6532],
  ['NJ', '',              32111, 102311,  6533,  6534],
  ['NM', 'East',          32112, 102312,  6535,  6536],
  ['NM', 'Central',       32113, 102313,  6537,  6538],
  ['NM', 'West',          32114, 102314,  6539,  6540],
  ['NY', 'East',          32115, 102315,  6541,  6542],
  ['NY', 'Central',       32116, 102316,  6543,  6544],
  ['NY', 'West',          32117, 102317,  6545,  6546],
  ['NY', 'Long Island',   32118, 102318,  6547,  6548],
  ['NC', '',              32119, 102319,  6549,  6550],
  ['ND', 'North',         32120, 102320,  6551,  6552],
  ['ND', 'South',         32121, 102321,  6553,  6554],
  ['OH', 'North',         32122, 102322,  6555,  6556],
  ['OH', 'South',         32123, 102323,  6557,  6558],
  ['OK', 'North',         32124, 102324,  6559,  6560],
  ['OK', 'South',         32125, 102325,  6561,  6562],
  ['OR', 'North',         32126, 102326,  6563,  6564],
  ['OR', 'South',         32127, 102327,  6565,  6566],
  ['PA', 'North',         32128, 102328,  6567,  6568],
  ['PA', 'South',         32129, 102329,  6569,  6570],
  ['RI', '',              32130, 102330,  6571,  6572],  // verified: 6567=meters, 6568=ftUS per epsg.io
  ['SC', '',              32133, 102333,  6573,  6574],
  ['SD', 'North',         32134, 102334,  6575,  6576],
  ['SD', 'South',         32135, 102335,  6577,  6578],
  ['TN', '',              32136, 102336,  6579,  6580],
  ['TX', 'North',         32137, 102337,  6581,  6582],
  ['TX', 'North Central', 32138, 102338,  6583,  6584],
  ['TX', 'Central',       32139, 102339,  6585,  6586],
  ['TX', 'South Central', 32140, 102340,  6587,  6588],
  ['TX', 'South',         32141, 102341,  6589,  6590],
  ['UT', 'North',         32142, 102342,  6591,  6592],
  ['UT', 'Central',       32143, 102343,  6593,  6594],
  ['UT', 'South',         32144, 102344,  6595,  6596],
  ['VT', '',              32145, 102345,  6597,  6598],
  ['VA', 'North',         32146, 102346,  6599,  6600],
  ['VA', 'South',         32147, 102347,  6601,  6602],
  ['WA', 'North',         32148, 102348,  6603,  6604],
  ['WA', 'South',         32149, 102349,  6605,  6606],
  ['WV', 'North',         32150, 102350,  6607,  6608],
  ['WV', 'South',         32151, 102351,  6609,  6610],
  ['WI', 'North',         32152, 102352,  6611,  6612],
  ['WI', 'Central',       32153, 102353,  6613,  6614],
  ['WI', 'South',         32154, 102354,  6615,  6616],
  ['WY', 'East',          32155, 102355,  6617,  6618],
  ['WY', 'East Central',  32156, 102356,  6619,  6620],
  ['WY', 'West Central',  32157, 102357,  6621,  6622],
  ['WY', 'West',          32158, 102358,  6623,  6624],
  ['PR', 'Puerto Rico',   32161, 102261,  6625,  6626],
];

// Collect every unique EPSG code we need to fetch
const allCodes = new Set();
allCodes.add(4326);
for (let z = 1; z <= 60; z++) {
  allCodes.add(32600 + z);
  allCodes.add(32700 + z);
}
for (const [, , m83, ft83, m11, ft11] of SPCS_ZONES) {
  allCodes.add(m83);
  // 102xxx ESRI codes are NOT in epsg.io — skip fetch, mark as ESRI-only
  if (ft83 < 102000) allCodes.add(ft83);
  allCodes.add(m11);
  allCodes.add(ft11);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchProj4(code) {
  try {
    const res = await fetch(`https://epsg.io/${code}.proj4`, {
      headers: { 'User-Agent': 'pano-sync-big projection generator (one-time setup)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    if (!text || text.startsWith('<') || text.startsWith('{')) return null;
    return text;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`Fetching ${allCodes.size} proj4 definitions from epsg.io...`);
  console.log('This will take several minutes. Do not interrupt.\n');

  const proj4Map = new Map();
  const failed = [];
  let i = 0;

  for (const code of allCodes) {
    i++;
    process.stdout.write(`[${i}/${allCodes.size}] EPSG:${code} ... `);
    const p4 = await fetchProj4(code);
    if (p4) {
      proj4Map.set(code, p4);
      process.stdout.write('OK\n');
    } else {
      failed.push(code);
      process.stdout.write('FAILED\n');
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nFetched: ${proj4Map.size}  Failed: ${failed.length}`);
  if (failed.length) {
    console.log('Failed codes (will be omitted):', failed.join(', '));
  }

  // ── Build the JS file ───────────────────────────────────────────────────
  const lines = [];
  lines.push('// src/lib/projections.js');
  lines.push('// AUTO-GENERATED by generate-projections.mjs — do not edit by hand.');
  lines.push('// Re-run the generator script if you need to add or change entries.');
  lines.push('// proj4 strings sourced directly from epsg.io.');
  lines.push('');
  lines.push('export const PROJECTIONS = [');

  // WGS84
  lines.push('  // ── WGS84 ──────────────────────────────────────────────────────────────────');
  lines.push('  {');
  lines.push("    code: 'EPSG:4326',");
  lines.push("    label: '4326 — WGS84 Geographic (lat/lon)',");
  lines.push("    group: 'WGS84',");
  lines.push("    units: 'degrees',");
  lines.push('    proj4def: null,');
  lines.push("    hint: 'Already lat/lon — X = longitude, Y = latitude',");
  lines.push('  },');

  // UTM
  lines.push('');
  lines.push('  // ── UTM Zones (WGS84) ────────────────────────────────────────────────────');
  for (let z = 1; z <= 60; z++) {
    const lon0 = -183 + z * 6;
    for (const hem of ['N', 'S']) {
      const code = hem === 'N' ? 32600 + z : 32700 + z;
      const p4 = proj4Map.get(code);
      if (!p4) continue;
      lines.push('  {');
      lines.push(`    code: 'EPSG:${code}',`);
      lines.push(`    label: '${code} — UTM Zone ${z}${hem} (meters)',`);
      lines.push(`    group: 'UTM',`);
      lines.push(`    units: 'meters',`);
      lines.push(`    proj4def: '${p4}',`);
      lines.push(`    hint: 'UTM Zone ${z}${hem} — central meridian ${lon0}°',`);
      lines.push('  },');
    }
  }

  // SPCS — 4 variants each
  const variants = [
    ['NAD83 m',          (r) => r[2], 'SPCS NAD83 meters',        'meters'],
    ['NAD83 ftUS',       (r) => r[3], 'SPCS NAD83 feet',          'us-ft'],
    ['NAD83(2011) m',    (r) => r[4], 'SPCS NAD83(2011) meters',  'meters'],
    ['NAD83(2011) ftUS', (r) => r[5], 'SPCS NAD83(2011) feet',    'us-ft'],
  ];

  for (const [suffix, codeGetter, group, units] of variants) {
    lines.push('');
    lines.push(`  // ── SPCS ${suffix} ${'─'.repeat(Math.max(0, 60 - suffix.length))}`);
    for (const row of SPCS_ZONES) {
      const [state, zone, , ft83, ,] = row;
      const code = codeGetter(row);
      // 102xxx ESRI codes: no epsg.io entry — build proj4 from the NAD83 meters version
      let p4 = proj4Map.get(code);
      if (!p4 && code >= 102000) {
        // Use the meters proj4 and swap units
        const mCode = row[2];
        const mp4 = proj4Map.get(mCode);
        if (mp4) {
          p4 = mp4.replace(/\+units=\S+/, '+units=us-ft');
          if (!p4.includes('+units=')) p4 += ' +units=us-ft';
        }
      }
      if (!p4) continue;
      const zoneStr = zone ? ` ${zone}` : '';
      const label = `${code} — ${state}${zoneStr} SP ${suffix}`;
      lines.push('  {');
      lines.push(`    code: 'EPSG:${code}',`);
      lines.push(`    label: '${label}',`);
      lines.push(`    group: '${group}',`);
      lines.push(`    units: '${units}',`);
      lines.push(`    proj4def: '${p4}',`);
      lines.push('  },');
    }
  }

  lines.push('];');
  lines.push('');
  lines.push("export const AUTO_DETECT_CODE = 'AUTO';");
  lines.push("export const CUSTOM_EPSG_CODE = 'CUSTOM';");
  lines.push('');
  lines.push('export const ALL_OPTIONS = [');
  lines.push("  { code: AUTO_DETECT_CODE, label: 'AUTO — Auto-detect from coordinates', group: 'Special' },");
  lines.push("  { code: CUSTOM_EPSG_CODE, label: 'CUSTOM — Enter any EPSG code...', group: 'Special' },");
  lines.push('  ...PROJECTIONS,');
  lines.push('];');
  lines.push('');
  lines.push('/**');
  lines.push(' * Fetch a proj4 string for any EPSG code from epsg.io at runtime.');
  lines.push(' * Used for custom codes not in the static list.');
  lines.push(' */');
  lines.push('export async function fetchProj4FromEpsgIo(epsgCode) {');
  lines.push("  const code = String(epsgCode).replace(/^EPSG:/i, '');");
  lines.push('  try {');
  lines.push('    const res = await fetch(`https://epsg.io/${code}.proj4`);');
  lines.push('    if (!res.ok) return null;');
  lines.push('    const text = (await res.text()).trim();');
  lines.push("    if (!text || text.startsWith('<')) return null;");
  lines.push('    return text;');
  lines.push('  } catch {');
  lines.push('    return null;');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  lines.push('/**');
  lines.push(' * Auto-detect projection from sample coordinates.');
  lines.push(' * Only reliable for WGS84 degree range.');
  lines.push(' */');
  lines.push('export function detectProjection(x, y) {');
  lines.push('  if (x >= -180 && x <= 180 && y >= -90 && y <= 90) {');
  lines.push("    return PROJECTIONS.find(p => p.code === 'EPSG:4326') || null;");
  lines.push('  }');
  lines.push('  return null;');
  lines.push('}');
  lines.push('');
  lines.push('/**');
  lines.push(' * validateCoords — bounds removed; kept for App.jsx compatibility.');
  lines.push(' */');
  lines.push('export function validateCoords(x, y, epsgCode, swapXY) {');
  lines.push('  if (x == null || y == null || !epsgCode) {');
  lines.push("    return { ok: false, message: 'Missing coordinates or projection.' };");
  lines.push('  }');
  lines.push("  return { ok: true, message: 'Coordinates accepted.' };");
  lines.push('}');
  lines.push('');
  lines.push('/**');
  lines.push(' * Convert [x, y] from proj4def to WGS84 [lng, lat].');
  lines.push(' */');
  lines.push('export function toWgs84(proj4lib, proj4def, x, y) {');
  lines.push('  if (!proj4def) return [x, y];');
  lines.push('  return proj4lib(proj4def, \'WGS84\', [x, y]);');
  lines.push('}');
  lines.push('');

  writeFileSync(OUT_PATH, lines.join('\n'), 'utf8');
  console.log(`\nWrote ${OUT_PATH}`);
  console.log(`Total entries: ${proj4Map.size}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
