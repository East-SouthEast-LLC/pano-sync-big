// src/lib/r2Upload.js
// Uses the S3-compatible API with AWS Signature V4 for authentication.

const ACCOUNT_ID = import.meta.env.VITE_R2_ACCOUNT_ID;
const BUCKET_NAME = import.meta.env.VITE_R2_BUCKET_NAME;
const ACCESS_KEY_ID = import.meta.env.VITE_R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = import.meta.env.VITE_R2_SECRET_ACCESS_KEY;
const PUBLIC_URL = import.meta.env.VITE_R2_PUBLIC_URL;

const S3_ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const REGION = 'auto';

// --- AWS Signature V4 helpers ---

const encoder = new TextEncoder();

const toHex = (buffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const sha256 = async (data) => {
  const buf = typeof data === 'string' ? encoder.encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', buf));
};

const hmac = async (key, data) => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', typeof key === 'string' ? encoder.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
};

const getSigningKey = async (dateStamp) => {
  const kDate = await hmac(`AWS4${SECRET_ACCESS_KEY}`, dateStamp);
  const kRegion = await hmac(kDate, REGION);
  const kService = await hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
};

/**
 * Builds the Authorization header for an S3 PUT request.
 */
const buildAuthHeader = async (method, objectKey, contentType, bodyHash, amzDate, dateStamp) => {
  const host = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${BUCKET_NAME}/${objectKey}`;
  const canonicalQueryString = '';
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${bodyHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    method, canonicalUri, canonicalQueryString,
    canonicalHeaders, signedHeaders, bodyHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, credentialScope,
    await sha256(canonicalRequest),
  ].join('\n');

  const signingKey = await getSigningKey(dateStamp);
  const signature = toHex(await hmac(signingKey, stringToSign));

  return `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
};

/**
 * Core upload function — uploads any file/blob to R2 at the given object key.
 */
const uploadToR2 = async (objectKey, body, contentType) => {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const bodyArray = body instanceof Blob
    ? await body.arrayBuffer()
    : encoder.encode(body);

  const bodyHash = await sha256(bodyArray);
  const authHeader = await buildAuthHeader('PUT', objectKey, contentType, bodyHash, amzDate, dateStamp);

  const url = `${S3_ENDPOINT}/${BUCKET_NAME}/${objectKey}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': bodyHash,
      'Authorization': authHeader,
    },
    body: bodyArray,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload failed for ${objectKey}: ${response.status} ${errorText}`);
  }
};

// ── Public R2 URL helper ──────────────────────────────────────────────────────
export const getPublicUrl = () => PUBLIC_URL;

// ── Fetch functions ───────────────────────────────────────────────────────────

/**
 * Fetches the current pano_data.json (legacy master) from R2's public URL.
 * Returns an empty object if the file doesn't exist yet.
 */
export const fetchJsonFromR2 = async () => {
  const url = `${PUBLIC_URL}/pano_data.json?nocache=${Date.now()}`;
  const response = await fetch(url);
  if (response.status === 404) {
    console.warn('pano_data.json not found in R2 — starting fresh.');
    return {};
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch pano_data.json: ${response.status}`);
  }
  return response.json();
};

/**
 * Fetches the master project index (pano_index.json) from R2.
 * Returns an empty array if the file doesn't exist yet.
 */
export const fetchIndexFromR2 = async () => {
  const url = `${PUBLIC_URL}/pano_index.json?nocache=${Date.now()}`;
  const response = await fetch(url);
  if (response.status === 404) {
    console.warn('pano_index.json not found in R2 — starting fresh.');
    return [];
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch pano_index.json: ${response.status}`);
  }
  return response.json();
};

// ── Upload functions ──────────────────────────────────────────────────────────

/**
 * Uploads a single image file to R2 inside a folder named after the prefix.
 */
export const uploadFileToR2 = async (file, folder, onProgress) => {
  const objectKey = `${folder}/${file.name}`;
  if (onProgress) onProgress(file.name, 'uploading');
  await uploadToR2(objectKey, file, file.type || 'image/jpeg');
  if (onProgress) onProgress(file.name, 'done');
  return `${PUBLIC_URL}/${objectKey}`;
};

/**
 * Uploads an array of image files to R2 in parallel.
 */
export const uploadFilesToR2 = async (files, folder, onProgress) => {
  const urlMap = new Map();
  await Promise.all(
    files.map(async (file) => {
      const publicUrl = await uploadFileToR2(file, folder, onProgress);
      urlMap.set(file.name, publicUrl);
    })
  );
  return urlMap;
};

/**
 * Uploads a per-project pano_data.json to FOLDER/pano_data.json in R2.
 * @param {string} folder - e.g. "RIDGEVALE_20250626"
 * @param {object} projectJson - the project's image entries
 * @returns {Promise<string>} - public URL of the uploaded file
 */
export const uploadProjectJsonToR2 = async (folder, projectJson) => {
  const objectKey = `${folder}/pano_data.json`;
  const body = JSON.stringify(projectJson, null, 2);
  await uploadToR2(objectKey, body, 'application/json');
  return `${PUBLIC_URL}/${objectKey}`;
};

/**
 * Uploads the master project index to pano_index.json at bucket root.
 * @param {object[]} indexData - array of project index entries
 * @returns {Promise<string>} - public URL of the uploaded file
 */
export const uploadIndexToR2 = async (indexData) => {
  const objectKey = 'pano_index.json';
  const body = JSON.stringify(indexData, null, 2);
  await uploadToR2(objectKey, body, 'application/json');
  return `${PUBLIC_URL}/${objectKey}`;
};

/**
 * Uploads the legacy merged pano_data.json to root (kept during migration).
 * @param {object} jsonData - the full merged JSON object
 * @returns {Promise<string>} - public URL
 */
export const uploadJsonToR2 = async (jsonData) => {
  const objectKey = 'pano_data.json';
  const body = JSON.stringify(jsonData, null, 2);
  await uploadToR2(objectKey, body, 'application/json');
  return `${PUBLIC_URL}/${objectKey}`;
};
