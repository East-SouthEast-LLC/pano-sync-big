// src/App.jsx
import { useState, useEffect, useRef } from 'react';
import './App.css';
import JSZip from 'jszip';
import FileUploader from './components/FileUploader';
import PrefixInput from './components/PrefixInput';
import ActionPanel from './components/ActionPanel';
import {
  renameImageFiles,
  convertCsvToJson,
  mergeJsonData,
  buildIndexEntry,
  mergeIndexEntry,
} from './lib/fileUtils';
import {
  uploadFilesToR2,
  uploadJsonToR2,
  uploadProjectJsonToR2,
  uploadIndexToR2,
  fetchJsonFromR2,
  fetchIndexFromR2,
  getPublicUrl,
} from './lib/r2Upload';

// Pipeline stages shown in the progress modal
const STAGES = {
  EXTRACTING: 'extracting',
  UPLOADING:  'uploading',
  JSON:       'json',
  INDEX:      'index',
  DONE:       'done',
  CANCELLED:  'cancelled',
  ERROR:      'error',
};

function App() {
  // raw input — may be a zip file or individual files
  const [rawFiles, setRawFiles]   = useState([]);
  const [hasZip, setHasZip]       = useState(false);

  // master JSON fetched from R2 on load
  const [masterJson, setMasterJson]       = useState(null);
  const [jsonLoadError, setJsonLoadError] = useState(null);

  // master index fetched from R2 on load
  const [masterIndex, setMasterIndex]         = useState(null);
  const [indexLoadError, setIndexLoadError]   = useState(null);

  const [prefix, setPrefix] = useState('');

  // project metadata
  const [projectName, setProjectName]           = useState('');
  const [projectTown, setProjectTown]           = useState('');
  const [projectOwner, setProjectOwner]         = useState('ESE LLC');
  const [projectDescription, setProjectDescription] = useState('');

  // progress modal state
  const [modalOpen, setModalOpen]   = useState(false);
  const [stage, setStage]           = useState(null);
  const [extractProgress, setExtractProgress] = useState({ done: 0, total: 0 });
  const [uploadProgress, setUploadProgress]   = useState({ done: 0, total: 0 });
  const [jsonPublicUrl, setJsonPublicUrl]     = useState(null);
  const [errorMessage, setErrorMessage]       = useState(null);

  // cancel signal
  const cancelledRef = useRef(false);

  // fetch master JSON and index from R2 on load
  useEffect(() => {
    fetchJsonFromR2()
      .then(data => setMasterJson(data))
      .catch(err => {
        console.error('Could not load pano_data.json from R2:', err);
        setJsonLoadError(err.message);
      });

    fetchIndexFromR2()
      .then(data => setMasterIndex(data))
      .catch(err => {
        console.error('Could not load pano_index.json from R2:', err);
        setIndexLoadError(err.message);
      });
  }, []);

  // when files are dropped/selected, just store them
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
    setStage(STAGES.CANCELLED);
  };

  const handleClose = () => {
    setModalOpen(false);
    setStage(null);
    setExtractProgress({ done: 0, total: 0 });
    setUploadProgress({ done: 0, total: 0 });
    setJsonPublicUrl(null);
    setErrorMessage(null);
    cancelledRef.current = false;
  };

  // ── Main pipeline ────────────────────────────────────────────────────────
  const handleProcessFiles = async () => {
    if (!rawFiles.length || !prefix) {
      alert('Please upload files and provide a prefix.');
      return;
    }
    if (masterJson === null) {
      alert('Still loading master JSON from R2 — please wait a moment and try again.');
      return;
    }
    if (masterIndex === null) {
      alert('Still loading project index from R2 — please wait a moment and try again.');
      return;
    }

    cancelledRef.current = false;
    setExtractProgress({ done: 0, total: 0 });
    setUploadProgress({ done: 0, total: 0 });
    setJsonPublicUrl(null);
    setErrorMessage(null);
    setModalOpen(true);

    try {
      // ── Step 1: extract ZIP or use files directly ──────────────────────
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

      // ── Step 2: rename images ──────────────────────────────────────────
      const processingPrefix = prefix.endsWith('_') ? prefix : `${prefix}_`;
      const folder           = processingPrefix.replace(/_$/, '');

      const renamedImages = await renameImageFiles(imageFiles, processingPrefix);
      if (renamedImages.length === 0) {
        throw new Error("No images matched the expected naming format '###-pano.jpg'.");
      }

      if (cancelledRef.current) return;

      // ── Step 3: upload images ──────────────────────────────────────────
      setStage(STAGES.UPLOADING);
      setUploadProgress({ done: 0, total: renamedImages.length });

      const urlMap = await uploadFilesToR2(
        renamedImages,
        folder,
        (fileName, status) => {
          if (status === 'done') {
            setUploadProgress(p => ({ ...p, done: p.done + 1 }));
          }
        }
      );

      if (cancelledRef.current) return;

      // ── Step 4: convert CSV → project JSON ────────────────────────────
      setStage(STAGES.JSON);

      const { projectJson, wgs84Points } = await convertCsvToJson(csvFile, processingPrefix, urlMap);

      // Upload per-project JSON to FOLDER/pano_data.json
      await uploadProjectJsonToR2(folder, projectJson);

      // Also merge into legacy root pano_data.json during migration period
      const finalMasterJson = mergeJsonData(masterJson, projectJson);
      const legacyUrl = await uploadJsonToR2(finalMasterJson);

      if (cancelledRef.current) return;

      // ── Step 5: rebuild master index ──────────────────────────────────
      setStage(STAGES.INDEX);

      const metadata = {
        name:        projectName  || folder,
        town:        projectTown,
        owner:       projectOwner || 'ESE LLC',
        description: projectDescription,
      };

      const newEntry   = buildIndexEntry(folder, projectJson, wgs84Points, metadata, getPublicUrl());
      const finalIndex = mergeIndexEntry(masterIndex, newEntry);
      const indexUrl   = await uploadIndexToR2(finalIndex);

      if (cancelledRef.current) return;

      setMasterJson(finalMasterJson);
      setMasterIndex(finalIndex);
      setJsonPublicUrl(indexUrl);
      setStage(STAGES.DONE);

    } catch (err) {
      if (!cancelledRef.current) {
        console.error('Pipeline error:', err);
        setErrorMessage(err.message);
        setStage(STAGES.ERROR);
      }
    }
  };

  // ── Progress modal content ───────────────────────────────────────────────
  const renderModalContent = () => {
    const isDone      = stage === STAGES.DONE;
    const isCancelled = stage === STAGES.CANCELLED;
    const isError     = stage === STAGES.ERROR;
    const isActive    = !isDone && !isCancelled && !isError;

    return (
      <div className="flex flex-col gap-4 min-w-[320px]">

        <ProgressRow
          label="Extracting ZIP"
          active={stage === STAGES.EXTRACTING}
          done={stage !== STAGES.EXTRACTING && stage !== null && hasZip}
          skipped={!hasZip}
          progress={extractProgress}
        />
        <ProgressRow
          label="Uploading images to R2"
          active={stage === STAGES.UPLOADING}
          done={[STAGES.JSON, STAGES.INDEX, STAGES.DONE].includes(stage)}
          progress={uploadProgress}
        />
        <ProgressRow
          label="Writing project JSON"
          active={stage === STAGES.JSON}
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
              href={jsonPublicUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-600 underline break-all"
            >
              {jsonPublicUrl}
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
      </div>
    );
  };

  return (
    <>
      {/* Progress modal */}
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

        {/* R2 status indicators */}
        <div className={`w-full px-4 py-2 rounded-md border text-sm ${
          jsonLoadError
            ? 'bg-red-50 border-red-200 text-red-600'
            : masterJson === null
            ? 'bg-yellow-50 border-yellow-200 text-yellow-600'
            : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          {jsonLoadError
            ? `⚠ Could not load master JSON from R2: ${jsonLoadError}`
            : masterJson === null
            ? '⏳ Loading master JSON from R2...'
            : `✓ Master JSON loaded — ${Object.keys(masterJson).length.toLocaleString()} entries`}
        </div>

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
            : `✓ Project index loaded — ${masterIndex.length} project${masterIndex.length !== 1 ? 's' : ''}`}
        </div>

        {/* Step 1: Files */}
        <div className="w-full p-4 border rounded-lg bg-gray-50">
          <h2 className="text-xl font-light text-[#2D2D31] mb-2">1. Upload Files</h2>
          <FileUploader
            title="JPG Images & CSV File (or ZIP folder)"
            onFilesSelected={handleFileSelection}
            accept=".jpg,.jpeg,.csv"
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

        {/* Step 3: Project Metadata */}
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Town
              </label>
              <input
                type="text"
                value={projectTown}
                onChange={e => setProjectTown(e.target.value)}
                placeholder="e.g. Chatham"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Owner
              </label>
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

          </div>
        </div>

        <ActionPanel onProcess={handleProcessFiles} isLoading={false} />
      </main>
    </>
  );
}

// ── Small helper component for each pipeline stage row ───────────────────────
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
          <span className="ml-auto text-xs text-gray-500">
            {progress.done}/{progress.total}
          </span>
        )}
        {progress && done && (
          <span className="ml-auto text-xs text-green-600">
            {progress.total} files
          </span>
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
