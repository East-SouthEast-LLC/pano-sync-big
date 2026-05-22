// src/App.jsx
import { useState, useEffect, useRef } from 'react';
import './App.css';
import JSZip from 'jszip';
import FileUploader from './components/FileUploader';
import PrefixInput from './components/PrefixInput';
import ActionPanel from './components/ActionPanel';
import Auth from './components/Auth';
import { supabase } from './lib/supabaseClient';
import {
  renameImageFiles,
  parseCsvRaw,
  buildProjectGeoJson,
  buildIndexFeature,
  mergeIndexFeature,
  projectToWgs84,
} from './lib/fileUtils';
import {
  uploadFilesToR2,
  uploadProjectGeoJsonToR2,
  uploadIndexToR2,
  fetchIndexFromR2,
  getPublicUrl,
} from './lib/r2Upload';
import {
  PROJECTIONS,
  ALL_OPTIONS,
  AUTO_DETECT_CODE,
  detectProjection,
  validateCoords,
} from './lib/projections';

const STAGES = {
  IDLE:       'idle',
  EXTRACTING: 'extracting',
  VALIDATING: 'validating',
  UPLOADING:  'uploading',
  GEOJSON:    'geojson',
  INDEX:      'index',
  DONE:       'done',
  CANCELLED:  'cancelled',
  ERROR:      'error',
};

function App() {
  const [session, setSession] = useState(null);

  const [rawFiles, setRawFiles] = useState([]);
  const [hasZip, setHasZip]     = useState(false);

  const [masterIndex, setMasterIndex]       = useState(null);
  const [indexLoadError, setIndexLoadError] = useState(null);

  const [prefix, setPrefix]     = useState('');
  const [projCode, setProjCode] = useState('');

  const [projectName, setProjectName]               = useState('');
  const [projectTown, setProjectTown]               = useState('');
  const [projectOwner, setProjectOwner]             = useState('ESE LLC');
  const [projectDescription, setProjectDescription] = useState('');

  const [modalOpen, setModalOpen]             = useState(false);
  const [stage, setStage]                     = useState(STAGES.IDLE);
  const [extractProgress, setExtractProgress] = useState({ done: 0, total: 0 });
  const [uploadProgress, setUploadProgress]   = useState({ done: 0, total: 0 });
  const [resultUrl, setResultUrl]             = useState(null);
  const [errorMessage, setErrorMessage]       = useState(null);

  const [coordCheck, setCoordCheck] = useState(null);

  const pendingPipelineRef = useRef(null);
  const cancelledRef       = useRef(false);

  // ── Auth ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Load index from R2 ───────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    fetchIndexFromR2()
      .then(data => setMasterIndex(data))
      .catch(err => {
        console.error('Could not load pano_index.geojson from R2:', err);
        setIndexLoadError(err.message);
      });
  }, [session]);

  // ── Gate: show login if no session ───────────────────────────────────────
  if (!session) return <Auth />;

  const handleFileSelection = (selectedFiles) => {
    setRawFiles(selectedFiles);
    setHasZip(selectedFiles.some(f => f.name.toLowerCase().endsWith('.zip')));
  };

  const directCsv    = rawFiles.find(f => f.name.toLowerCase().endsWith('.csv'));
  const directImages = rawFiles.filter(f => f.name.toLowerCase().match(/\.jpe?g$/));

  const handleCancel = () => {
    cancelledRef.current = true;
    pendingPipelineRef.current = null;
    setStage(STAGES.CANCELLED);
  };

  const handleClose = () => {
    setModalOpen(false);
    setStage(STAGES.IDLE);
    setExtractProgress({ done: 0, total: 0 });
    setUploadProgress({ done: 0, total: 0 });
    setResultUrl(null);
    setErrorMessage(null);
    setCoordCheck(null);
    pendingPipelineRef.current = null;
    cancelledRef.current = false;
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  // ── Build coord check ────────────────────────────────────────────────────
  const buildCheck = (sampleX, sampleY, code, swapXY) => {
    const easting  = swapXY ? sampleY : sampleX;
    const northing = swapXY ? sampleX : sampleY;
    const validation = validateCoords(sampleX, sampleY, code, swapXY);
    let wgsPreview = null;
    try { wgsPreview = projectToWgs84(easting, northing, code); } catch (_) {}
    return { sampleX, sampleY, projCode: code, swapXY, valid: validation.ok, message: validation.message, wgsPreview };
  };

  const handleSwapToggle = (swapXY) => {
    if (!coordCheck) return;
    const updated = buildCheck(coordCheck.sampleX, coordCheck.sampleY, coordCheck.projCode, swapXY);
    setCoordCheck(updated);
  };

  const handleModalProjectionChange = (newCode) => {
    if (!coordCheck) return;
    const updated = buildCheck(coordCheck.sampleX, coordCheck.sampleY, newCode, coordCheck.swapXY);
    setCoordCheck(updated);
  };

  const handleProceed = () => {
    if (!coordCheck?.valid || !pendingPipelineRef.current) return;
    const { rows, folder, processingPrefix, imageFiles } = pendingPipelineRef.current;
    pendingPipelineRef.current = null;
    runUploadPhase(rows, folder, processingPrefix, imageFiles, coordCheck.projCode, coordCheck.swapXY);
  };

  // ── Main pipeline ────────────────────────────────────────────────────────
  const handleProcessFiles = async () => {
    if (!rawFiles.length || !prefix) {
      alert('Please upload files and provide a prefix.');
      return;
    }
    if (!projCode) {
      alert('Please select a coordinate system.');
      return;
    }
    if (masterIndex === null) {
      alert('Still loading project index from R2 — please wait a moment.');
      return;
    }

    cancelledRef.current = false;
    setExtractProgress({ done: 0, total: 0 });
    setUploadProgress({ done: 0, total: 0 });
    setResultUrl(null);
    setErrorMessage(null);
    setCoordCheck(null);
    pendingPipelineRef.current = null;
    setModalOpen(true);

    try {
      let imageFiles = [];
      let csvFile    = null;
      const zipFile  = rawFiles.find(f => f.name.toLowerCase().endsWith('.zip'));

      if (zipFile) {
        setStage(STAGES.EXTRACTING);
        const zip = await JSZip.loadAsync(zipFile);
        const entries = Object.values(zip.files).filter(e => {
          if (e.dir) return false;
          const n = e.name.split('/').pop().toLowerCase();
          return n.match(/\.jpe?g$/) || n.endsWith('.csv');
        });
        setExtractProgress({ done: 0, total: entries.length });
        const extracted = [];
        for (const entry of entries) {
          if (cancelledRef.current) return;
          const name = entry.name.split('/').pop();
          const blob = await entry.async('blob');
          const mime = name.toLowerCase().endsWith('.csv') ? 'text/csv' : 'image/jpeg';
          extracted.push(new File([blob], name, { type: mime }));
          setExtractProgress(p => ({ ...p, done: p.done + 1 }));
        }
        csvFile    = extracted.find(f => f.name.toLowerCase().endsWith('.csv'));
        imageFiles = extracted.filter(f => f.name.toLowerCase().match(/\.jpe?g$/));
      } else {
        csvFile    = directCsv;
        imageFiles = directImages;
      }

      if (cancelledRef.current) return;
      if (!csvFile || imageFiles.length === 0) {
        throw new Error('Could not find both JPG images and a CSV file.');
      }

      setStage(STAGES.VALIDATING);
      const { rows, sampleX, sampleY } = await parseCsvRaw(csvFile);

		const sanitized        = prefix.trim().replace(/\s+/g, '_');
		const processingPrefix = sanitized.endsWith('_') ? sanitized : `${sanitized}_`;
		const folder           = processingPrefix.replace(/_$/, '');

      let resolvedCode = projCode;
      if (projCode === AUTO_DETECT_CODE) {
        const detected = detectProjection(sampleX, sampleY);
        resolvedCode = detected ? detected.projection.code : 'EPSG:6491';
        setProjCode(resolvedCode);
      }

      const check = buildCheck(sampleX, sampleY, resolvedCode, false);
      setCoordCheck(check);

      if (!check.valid) {
        pendingPipelineRef.current = { rows, folder, processingPrefix, imageFiles };
        return;
      }

      await runUploadPhase(rows, folder, processingPrefix, imageFiles, resolvedCode, false);

    } catch (err) {
      if (!cancelledRef.current) {
        console.error('Pipeline error:', err);
        setErrorMessage(err.message);
        setStage(STAGES.ERROR);
      }
    }
  };

  // ── Upload phase ─────────────────────────────────────────────────────────
  const runUploadPhase = async (rows, folder, processingPrefix, imageFiles, resolvedCode, swapXY) => {
    try {
      const renamedImages = await renameImageFiles(imageFiles, processingPrefix);
      if (renamedImages.length === 0) {
        throw new Error("No images matched the expected naming format '###-pano.jpg'.");
      }
      if (cancelledRef.current) return;

      setStage(STAGES.UPLOADING);
      setUploadProgress({ done: 0, total: renamedImages.length });
      const urlMap = await uploadFilesToR2(
        renamedImages, folder,
        (_, status) => { if (status === 'done') setUploadProgress(p => ({ ...p, done: p.done + 1 })); }
      );
      if (cancelledRef.current) return;

      setStage(STAGES.GEOJSON);
      const { projectGeoJson, wgs84Points } = buildProjectGeoJson(rows, processingPrefix, resolvedCode, swapXY, urlMap);
      await uploadProjectGeoJsonToR2(folder, projectGeoJson);
      if (cancelledRef.current) return;

      setStage(STAGES.INDEX);
      const metadata = {
        name: projectName || folder, town: projectTown,
        owner: projectOwner || 'ESE LLC', description: projectDescription,
      };
      const newFeature = buildIndexFeature(folder, projectGeoJson.features.length, wgs84Points, metadata, getPublicUrl());
      const finalIndex = mergeIndexFeature(masterIndex, newFeature);
      const indexUrl   = await uploadIndexToR2(finalIndex);
      if (cancelledRef.current) return;

      setMasterIndex(finalIndex);
      setResultUrl(indexUrl);
      setCoordCheck(null);
      setStage(STAGES.DONE);

    } catch (err) {
      if (!cancelledRef.current) {
        console.error('Upload error:', err);
        setErrorMessage(err.message);
        setStage(STAGES.ERROR);
      }
    }
  };

  // ── Modal ────────────────────────────────────────────────────────────────
  const renderModalContent = () => {
    const isDone      = stage === STAGES.DONE;
    const isCancelled = stage === STAGES.CANCELLED;
    const isError     = stage === STAGES.ERROR;
    const isPaused    = stage === STAGES.VALIDATING && coordCheck && pendingPipelineRef.current;
    const isActive    = !isDone && !isCancelled && !isError && !isPaused;

    const coordPanel = coordCheck && (() => {
      const { valid, swapXY, sampleX, sampleY, wgsPreview, message, projCode: checkCode } = coordCheck;

      return (
        <div className={`rounded-md border p-3 text-sm ${
          valid ? 'bg-green-50 border-green-300 text-green-800'
                : 'bg-red-50 border-red-300 text-red-800'
        }`}>
          <p className="font-semibold mb-1">
            {valid ? '✓ Coordinates verified' : '⚠ Coordinate mismatch'}
          </p>
          <p className="text-xs mb-0.5">
            Raw CSV: X={sampleX.toFixed(2)}, Y={sampleY.toFixed(2)}
          </p>
          {wgsPreview && (
            <p className="text-xs mb-2">
              → {wgsPreview.lat.toFixed(6)}°N, {wgsPreview.lon.toFixed(6)}°E
            </p>
          )}
          <p className="text-xs mb-3">{message}</p>

          {isPaused && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className={`text-xs font-medium ${!swapXY ? 'text-gray-900' : 'text-gray-400'}`}>X,Y</span>
                <button
                  onClick={() => handleSwapToggle(!swapXY)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                    swapXY ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      swapXY ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className={`text-xs font-medium ${swapXY ? 'text-gray-900' : 'text-gray-400'}`}>Y,X</span>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Projection:</label>
                <select
                  value={checkCode}
                  onChange={e => handleModalProjectionChange(e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white text-gray-800"
                >
                  {ALL_OPTIONS.filter(p => p.code !== AUTO_DETECT_CODE).map(p => (
                    <option key={p.code} value={p.code}>
                      {p.code} — {p.label.split('—')[1]?.trim() ?? p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleProceed}
                  disabled={!valid}
                  className={`flex-1 px-3 py-1.5 rounded text-white text-xs font-medium transition-colors ${
                    valid ? 'bg-green-600 hover:bg-green-700 cursor-pointer'
                          : 'bg-gray-300 cursor-not-allowed text-gray-500'
                  }`}
                >
                  Proceed
                </button>
                <button
                  onClick={handleCancel}
                  className="px-3 py-1.5 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      );
    })();

    return (
      <div className="flex flex-col gap-4 min-w-[340px]">
        <ProgressRow
          label="Extracting ZIP"
          active={stage === STAGES.EXTRACTING}
          done={![STAGES.IDLE, STAGES.EXTRACTING].includes(stage) && hasZip}
          skipped={!hasZip}
          progress={extractProgress}
        />
        <ProgressRow
          label="Validating coordinates"
          active={stage === STAGES.VALIDATING}
          done={[STAGES.UPLOADING, STAGES.GEOJSON, STAGES.INDEX, STAGES.DONE].includes(stage)}
        />

        {coordPanel}

        <ProgressRow
          label="Uploading images to R2"
          active={stage === STAGES.UPLOADING}
          done={[STAGES.GEOJSON, STAGES.INDEX, STAGES.DONE].includes(stage)}
          progress={uploadProgress}
        />
        <ProgressRow
          label="Writing project GeoJSON"
          active={stage === STAGES.GEOJSON}
          done={[STAGES.INDEX, STAGES.DONE].includes(stage)}
        />
        <ProgressRow
          label="Updating project index"
          active={stage === STAGES.INDEX}
          done={stage === STAGES.DONE}
        />

        {isDone && (
          <div className="rounded-md bg-green-50 border border-green-200 p-3">
            <p className="text-sm font-semibold text-green-700 mb-1">✓ All done!</p>
            <a href={resultUrl} target="_blank" rel="noreferrer"
              className="text-xs text-blue-600 underline break-all">{resultUrl}</a>
          </div>
        )}
        {isCancelled && (
          <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md p-3">
            ✕ Cancelled. Any images already uploaded to R2 remain there.
          </p>
        )}
        {isError && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
            ⚠ Error: {errorMessage}
          </p>
        )}

        {!isPaused && (
          <div className="flex gap-2 justify-end mt-2">
            {isActive && (
              <button onClick={handleCancel}
                className="px-4 py-2 rounded-md border border-gray-300 text-sm text-gray-600 hover:bg-gray-100 transition-colors">
                Cancel
              </button>
            )}
            {!isActive && (
              <button onClick={handleClose}
                className="px-4 py-2 rounded-md bg-gray-600 text-white text-sm hover:bg-gray-700 transition-colors">
                Close
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const projectCount = masterIndex?.features?.length ?? 0;

  return (
    <>
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold text-[#2D2D31] mb-4">Processing Files</h2>
            {renderModalContent()}
          </div>
        </div>
      )}

      <main className="flex flex-col items-center p-5 space-y-4 max-w-2xl mx-auto">
        <div className="w-full flex items-center justify-between">
          <h1 className="text-3xl font-bold">Pano Sync Processor</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">{session.user.email}</span>
            <button onClick={handleSignOut}
              className="text-xs px-3 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors">
              Sign out
            </button>
          </div>
        </div>

        <div className={`w-full px-4 py-2 rounded-md border text-sm ${
          indexLoadError ? 'bg-red-50 border-red-200 text-red-600'
          : masterIndex === null ? 'bg-yellow-50 border-yellow-200 text-yellow-600'
          : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          {indexLoadError
            ? `⚠ Could not load project index: ${indexLoadError}`
            : masterIndex === null ? '⏳ Loading project index from R2...'
            : `✓ Project index loaded — ${projectCount} project${projectCount !== 1 ? 's' : ''}`}
        </div>

        {/* Step 1 */}
        <div className="w-full p-4 border rounded-lg bg-gray-50">
          <h2 className="text-xl font-light text-[#2D2D31] mb-2">1. Upload Files</h2>
          <FileUploader
            title="JPG Images & CSV File (or ZIP folder)"
            onFilesSelected={handleFileSelection}
            accept=".jpg,.jpeg,.csv,.zip"
            multiple
          />
          <div className="mt-2 space-y-1">
            {hasZip && <p className="text-sm text-pink-600">✓ ZIP ready: {rawFiles.find(f => f.name.toLowerCase().endsWith('.zip'))?.name}</p>}
            {!hasZip && directCsv && <p className="text-sm text-pink-600">✓ CSV: {directCsv.name}</p>}
            {!hasZip && directImages.length > 0 && <p className="text-sm text-pink-600">✓ {directImages.length} image(s) loaded.</p>}
          </div>
        </div>

        {/* Step 2 */}
        <PrefixInput value={prefix} onChange={setPrefix} />

        {/* Step 3 */}
        <div className="w-full p-4 border rounded-lg bg-gray-50">
          <h2 className="text-xl font-light text-[#2D2D31] mb-3">3. Project Details</h2>
          <div className="space-y-3">

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Project Name <span className="text-red-500">*</span>
              </label>
              <input type="text" value={projectName} onChange={e => setProjectName(e.target.value)}
                placeholder="e.g. Ridgevale Golf Course"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-pink-300" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Town</label>
              <input type="text" value={projectTown} onChange={e => setProjectTown(e.target.value)}
                placeholder="e.g. Chatham"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-pink-300" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
              <input type="text" value={projectOwner} onChange={e => setProjectOwner(e.target.value)}
                placeholder="e.g. ESE LLC"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-pink-300" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input type="text" value={projectDescription} onChange={e => setProjectDescription(e.target.value)}
                placeholder="e.g. Survey of fairways and cart paths"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-pink-300" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Coordinate System <span className="text-red-500">*</span>
              </label>
              <select
                value={projCode}
                onChange={e => setProjCode(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-pink-300 bg-white"
              >
                <option value="" disabled>Select Project EPSG or Auto-Detect</option>
                <option value={AUTO_DETECT_CODE}>AUTO — Auto-detect from coordinates</option>
                {PROJECTIONS.map(p => (
                  <option key={p.code} value={p.code}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

          </div>
        </div>

        <ActionPanel onProcess={handleProcessFiles} isLoading={false} />
      </main>
    </>
  );
}

function ProgressRow({ label, active, done, skipped, progress }) {
  if (skipped) return null;
  const icon = done
    ? <span className="text-green-600">✓</span>
    : active ? <span className="animate-spin inline-block">⏳</span>
    : <span className="text-gray-300">○</span>;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-sm">
        {icon}
        <span className={done ? 'text-green-700' : active ? 'text-gray-800 font-medium' : 'text-gray-400'}>
          {label}
        </span>
        {progress && active && <span className="ml-auto text-xs text-gray-500">{progress.done}/{progress.total}</span>}
        {progress && done  && <span className="ml-auto text-xs text-green-600">{progress.total} files</span>}
      </div>
      {active && progress?.total > 0 && (
        <div className="w-full bg-gray-200 rounded-full h-1.5 ml-5">
          <div className="bg-[#FD366E] h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

export default App;
