// src/App.jsx
import { useState, useEffect, useRef } from 'react';
import './App.css';
import JSZip from 'jszip';
import FileUploader from './components/FileUploader';
import PrefixInput from './components/PrefixInput';
import ActionPanel from './components/ActionPanel';
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

// Pipeline stages
const STAGES = {
  IDLE:       'idle',
  EXTRACTING: 'extracting',
  VALIDATING: 'validating',  // coord check — may pause here
  UPLOADING:  'uploading',
  GEOJSON:    'geojson',
  INDEX:      'index',
  DONE:       'done',
  CANCELLED:  'cancelled',
  ERROR:      'error',
};

function App() {
  const [rawFiles, setRawFiles] = useState([]);
  const [hasZip, setHasZip]     = useState(false);

  const [masterIndex, setMasterIndex]       = useState(null);
  const [indexLoadError, setIndexLoadError] = useState(null);

  const [prefix, setPrefix]   = useState('');
  const [projCode, setProjCode] = useState('EPSG:6491'); // default MA State Plane

  const [projectName, setProjectName]               = useState('');
  const [projectTown, setProjectTown]               = useState('');
  const [projectOwner, setProjectOwner]             = useState('ESE LLC');
  const [projectDescription, setProjectDescription] = useState('');

  // progress modal
  const [modalOpen, setModalOpen]             = useState(false);
  const [stage, setStage]                     = useState(STAGES.IDLE);
  const [extractProgress, setExtractProgress] = useState({ done: 0, total: 0 });
  const [uploadProgress, setUploadProgress]   = useState({ done: 0, total: 0 });
  const [resultUrl, setResultUrl]             = useState(null);
  const [errorMessage, setErrorMessage]       = useState(null);

  // coord validation state
  const [coordCheck, setCoordCheck] = useState(null);
  // coordCheck shape: { sampleX, sampleY, detectedCode, selectedCode, wgsPreview, valid, message }

  // stored pipeline data — held while waiting for user to confirm coord mismatch
  const pendingPipelineRef = useRef(null);
  const cancelledRef       = useRef(false);

  useEffect(() => {
    fetchIndexFromR2()
      .then(data => setMasterIndex(data))
      .catch(err => {
        console.error('Could not load pano_index.geojson from R2:', err);
        setIndexLoadError(err.message);
      });
  }, []);

  const handleFileSelection = (selectedFiles) => {
    setRawFiles(selectedFiles);
    setHasZip(selectedFiles.some(f => f.name.toLowerCase().endsWith('.zip')));
  };

  const directCsv    = rawFiles.find(f => f.name.toLowerCase().endsWith('.csv'));
  const directImages = rawFiles.filter(f =>
    f.name.toLowerCase().endsWith('.jpg') || f.name.toLowerCase().endsWith('.jpeg')
  );

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

  // ── Build coord check object from sampleX/Y and a projection code ─────────
  const buildCoordCheck = (sampleX, sampleY, resolvedCode) => {
    const validation = validateCoords(sampleX, sampleY, resolvedCode);
    let wgsPreview = null;
    try {
      wgsPreview = projectToWgs84(sampleX, sampleY, resolvedCode);
    } catch (_) {}
    return {
      sampleX,
      sampleY,
      selectedCode: resolvedCode,
      valid: validation.ok,
      message: validation.message,
      wgsPreview,
    };
  };

  // ── User changes projection in the mismatch modal ─────────────────────────
  const handleProjectionChange = (newCode) => {
    setProjCode(newCode);
    if (!coordCheck) return;
    const updated = buildCoordCheck(coordCheck.sampleX, coordCheck.sampleY, newCode);
    setCoordCheck(updated);
  };

  // ── User confirms coord mismatch and proceeds anyway ─────────────────────
  const handleConfirmAndProceed = () => {
    if (!pendingPipelineRef.current) return;
    const { rows, folder, processingPrefix, imageFiles } = pendingPipelineRef.current;
    setCoordCheck(null);
    runUploadPhase(rows, folder, processingPrefix, imageFiles, projCode);
  };

  // ── Main pipeline entry point ─────────────────────────────────────────────
  const handleProcessFiles = async () => {
    if (!rawFiles.length || !prefix) {
      alert('Please upload files and provide a prefix.');
      return;
    }
    if (masterIndex === null) {
      alert('Still loading project index from R2 — please wait a moment and try again.');
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
      // ── Step 1: extract ZIP or use files directly ────────────────────
      let imageFiles = [];
      let csvFile    = null;

      const zipFile = rawFiles.find(f => f.name.toLowerCase().endsWith('.zip'));

      if (zipFile) {
        setStage(STAGES.EXTRACTING);
        const zip = await JSZip.loadAsync(zipFile);
        const entries = Object.values(zip.files).filter(e => {
          if (e.dir) return false;
          const n = e.name.split('/').pop().toLowerCase();
          return n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.csv');
        });

        setExtractProgress({ done: 0, total: entries.length });
        const extracted = [];
        for (const entry of entries) {
          if (cancelledRef.current) return;
          const name  = entry.name.split('/').pop();
          const lower = name.toLowerCase();
          const blob  = await entry.async('blob');
          const mime  = lower.endsWith('.csv') ? 'text/csv' : 'image/jpeg';
          extracted.push(new File([blob], name, { type: mime }));
          setExtractProgress(p => ({ ...p, done: p.done + 1 }));
        }
        csvFile    = extracted.find(f => f.name.toLowerCase().endsWith('.csv'));
        imageFiles = extracted.filter(f =>
          f.name.toLowerCase().endsWith('.jpg') || f.name.toLowerCase().endsWith('.jpeg')
        );
      } else {
        csvFile    = directCsv;
        imageFiles = directImages;
      }

      if (cancelledRef.current) return;
      if (!csvFile || imageFiles.length === 0) {
        throw new Error('Could not find both JPG images and a CSV file in the uploaded files.');
      }

      // ── Step 2: parse CSV raw + validate coords ──────────────────────
      setStage(STAGES.VALIDATING);
      const { rows, sampleX, sampleY } = await parseCsvRaw(csvFile);

      const processingPrefix = prefix.endsWith('_') ? prefix : `${prefix}_`;
      const folder           = processingPrefix.replace(/_$/, '');

      // Auto-detect if selected
      let resolvedCode = projCode;
      if (projCode === AUTO_DETECT_CODE) {
        const detected = detectProjection(sampleX, sampleY);
        resolvedCode = detected ? detected.code : 'EPSG:6491';
        setProjCode(resolvedCode);
      }

      const check = buildCoordCheck(sampleX, sampleY, resolvedCode);
      setCoordCheck(check);

      if (!check.valid) {
        // Pause here — show blocking mismatch modal
        // Store pipeline state so we can resume after user confirms
        pendingPipelineRef.current = { rows, folder, processingPrefix, imageFiles };
        return; // pipeline paused — renderModalContent shows the mismatch UI
      }

      // Coords look good — proceed directly
      await runUploadPhase(rows, folder, processingPrefix, imageFiles, resolvedCode);

    } catch (err) {
      if (!cancelledRef.current) {
        console.error('Pipeline error:', err);
        setErrorMessage(err.message);
        setStage(STAGES.ERROR);
      }
    }
  };

  // ── Upload phase (runs after coord validation passes or user confirms) ────
  const runUploadPhase = async (rows, folder, processingPrefix, imageFiles, resolvedCode) => {
    try {
      const renamedImages = await renameImageFiles(imageFiles, processingPrefix);
      if (renamedImages.length === 0) {
        throw new Error("No images matched the expected naming format '###-pano.jpg'.");
      }

      if (cancelledRef.current) return;

      // ── Step 3: upload images ────────────────────────────────────────
      setStage(STAGES.UPLOADING);
      setUploadProgress({ done: 0, total: renamedImages.length });

      const urlMap = await uploadFilesToR2(
        renamedImages,
        folder,
        (fileName, status) => {
          if (status === 'done') setUploadProgress(p => ({ ...p, done: p.done + 1 }));
        }
      );

      if (cancelledRef.current) return;

      // ── Step 4: build + upload per-project GeoJSON ──────────────────
      setStage(STAGES.GEOJSON);
      const { projectGeoJson, wgs84Points } = buildProjectGeoJson(rows, processingPrefix, resolvedCode, urlMap);
      await uploadProjectGeoJsonToR2(folder, projectGeoJson);

      if (cancelledRef.current) return;

      // ── Step 5: rebuild master index ────────────────────────────────
      setStage(STAGES.INDEX);
      const metadata = {
        name:        projectName  || folder,
        town:        projectTown,
        owner:       projectOwner || 'ESE LLC',
        description: projectDescription,
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
        console.error('Upload phase error:', err);
        setErrorMessage(err.message);
        setStage(STAGES.ERROR);
      }
    }
  };

  // ── Modal content ─────────────────────────────────────────────────────────
  const renderModalContent = () => {
    const isDone      = stage === STAGES.DONE;
    const isCancelled = stage === STAGES.CANCELLED;
    const isError     = stage === STAGES.ERROR;
    const isPaused    = stage === STAGES.VALIDATING && coordCheck && !coordCheck.valid && pendingPipelineRef.current;
    const isActive    = !isDone && !isCancelled && !isError && !isPaused;

    // ── Coord validation panel (shown in all upload stages when coordCheck exists) ──
    const coordPanel = coordCheck && (
      <div className={`rounded-md border p-3 text-sm ${
        coordCheck.valid
          ? 'bg-green-50 border-green-300 text-green-800'
          : 'bg-red-50 border-red-300 text-red-800'
      }`}>
        <p className="font-semibold mb-1">
          {coordCheck.valid ? '✓ Coordinates match projection' : '⚠ Coordinate mismatch'}
        </p>
        <p className="text-xs mb-1">
          Sample raw: X={coordCheck.sampleX.toFixed(2)}, Y={coordCheck.sampleY.toFixed(2)}
        </p>
        {coordCheck.wgsPreview && (
          <p className="text-xs mb-1">
            Converted: {coordCheck.wgsPreview.lat.toFixed(6)}°N, {coordCheck.wgsPreview.lon.toFixed(6)}°E
          </p>
        )}
        <p className="text-xs">{coordCheck.message}</p>

        {/* Projection picker — always visible in coord panel */}
        <div className="mt-2">
          <label className="block text-xs font-medium mb-1">Projection:</label>
          <select
            value={coordCheck.selectedCode}
            onChange={e => handleProjectionChange(e.target.value)}
            className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white text-gray-800"
          >
            {ALL_OPTIONS.map(p => (
              <option key={p.code} value={p.code}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>
    );

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

        {/* Coord check panel — shown during validation and upload phases */}
        {coordPanel}

        {/* Blocking mismatch — user must resolve before continuing */}
        {isPaused && (
          <div className="rounded-md bg-amber-50 border border-amber-300 p-3 text-sm text-amber-800">
            <p className="font-semibold mb-1">Pipeline paused</p>
            <p className="text-xs">Select the correct projection above and confirm, or cancel.</p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleConfirmAndProceed}
                className="px-4 py-2 rounded-md bg-amber-600 text-white text-sm hover:bg-amber-700 transition-colors"
              >
                Proceed anyway
              </button>
              <button
                onClick={handleCancel}
                className="px-4 py-2 rounded-md border border-gray-300 text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

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
            <a
              href={resultUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-600 underline break-all"
            >
              {resultUrl}
            </a>
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
              <button
                onClick={handleCancel}
                className="px-4 py-2 rounded-md border border-gray-300 text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
            )}
            {!isActive && (
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded-md bg-gray-600 text-white text-sm hover:bg-gray-700 transition-colors"
              >
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
        <h1 className="text-3xl font-bold">Pano Sync Processor</h1>

        {/* Index status */}
        <div className={`w-full px-4 py-2 rounded-md border text-sm ${
          indexLoadError
            ? 'bg-red-50 border-red-200 text-red-600'
            : masterIndex === null
            ? 'bg-yellow-50 border-yellow-200 text-yellow-600'
            : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          {indexLoadError
            ? `⚠ Could not load project index from R2: ${indexLoadError}`
            : masterIndex === null
            ? '⏳ Loading project index from R2...'
            : `✓ Project index loaded — ${projectCount} project${projectCount !== 1 ? 's' : ''}`}
        </div>

        {/* Step 1: Files */}
        <div className="w-full p-4 border rounded-lg bg-gray-50">
          <h2 className="text-xl font-light text-[#2D2D31] mb-2">1. Upload Files</h2>
          <FileUploader
            title="JPG Images & CSV File (or ZIP folder)"
            onFilesSelected={handleFileSelection}
            accept=".jpg,.jpeg,.csv,.zip"
            multiple
          />
          <div className="mt-2 space-y-1">
            {hasZip && (
              <p className="text-sm text-pink-600">
                ✓ ZIP ready: {rawFiles.find(f => f.name.toLowerCase().endsWith('.zip'))?.name}
              </p>
            )}
            {!hasZip && directCsv && (
              <p className="text-sm text-pink-600">✓ CSV loaded: {directCsv.name}</p>
            )}
            {!hasZip && directImages.length > 0 && (
              <p className="text-sm text-pink-600">✓ {directImages.length} image(s) loaded.</p>
            )}
          </div>
        </div>

        {/* Step 2: Prefix */}
        <PrefixInput value={prefix} onChange={setPrefix} />

        {/* Step 3: Project Details + Projection */}
        <div className="w-full p-4 border rounded-lg bg-gray-50">
          <h2 className="text-xl font-light text-[#2D2D31] mb-3">3. Project Details</h2>
          <div className="space-y-3">

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Project Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="e.g. Ridgevale Golf Course"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Town</label>
              <input
                type="text"
                value={projectTown}
                onChange={e => setProjectTown(e.target.value)}
                placeholder="e.g. Chatham"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
              <input
                type="text"
                value={projectOwner}
                onChange={e => setProjectOwner(e.target.value)}
                placeholder="e.g. ESE LLC"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={projectDescription}
                onChange={e => setProjectDescription(e.target.value)}
                placeholder="e.g. Survey of fairways and cart paths"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Coordinate System
              </label>
              <select
                value={projCode}
                onChange={e => setProjCode(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-pink-300 bg-white"
              >
                {ALL_OPTIONS.map(p => (
                  <option key={p.code} value={p.code}>{p.label}</option>
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
    : active
    ? <span className="animate-spin inline-block">⏳</span>
    : <span className="text-gray-300">○</span>;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-sm">
        {icon}
        <span className={done ? 'text-green-700' : active ? 'text-gray-800 font-medium' : 'text-gray-400'}>
          {label}
        </span>
        {progress && active && (
          <span className="ml-auto text-xs text-gray-500">{progress.done}/{progress.total}</span>
        )}
        {progress && done && (
          <span className="ml-auto text-xs text-green-600">{progress.total} files</span>
        )}
      </div>
      {active && progress?.total > 0 && (
        <div className="w-full bg-gray-200 rounded-full h-1.5 ml-5">
          <div
            className="bg-[#FD366E] h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default App;
