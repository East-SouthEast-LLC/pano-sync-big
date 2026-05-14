// src/components/PrefixInput.jsx
import { useEffect, useState } from 'react';

// Splits an existing prefix string (e.g. "CLIENTNAME_2025-04-25") back into parts
// so the fields are pre-populated if the parent already has a value.
const parsePrefix = (value) => {
  if (!value) return { projectName: '', date: '' };
  // Match PROJECTNAME_YYYY-MM-DD or PROJECTNAME_YYYYMMDD at the end
  const match = value.match(/^(.+?)_(\d{4}-\d{2}-\d{2}|\d{8})_?$/);
  if (match) {
    let date = match[2];
    if (date.length === 8) {
      date = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    }
    return { projectName: match[1], date };
  }
  return { projectName: value.replace(/_$/, ''), date: '' };
};

function PrefixInput({ value, onChange }) {
  const parsed = parsePrefix(value);
  const [projectName, setProjectName] = useState(parsed.projectName);
  const [date, setDate] = useState(parsed.date || new Date().toISOString().slice(0, 10));

  // Assemble and emit the prefix whenever either field changes
  useEffect(() => {
    if (projectName.trim() && date) {
      onChange(`${projectName.trim()}_${date}`);
    } else {
      onChange('');
    }
  }, [projectName, date]);

  // Preview of what the filenames will look like
  const previewName = projectName.trim() && date
    ? `${projectName.trim()}_${date}_00001.jpg`
    : null;

  return (
    <div className="flex w-full flex-col gap-3 rounded-md border border-[#EDEDF0] bg-white p-4">
      <label className="text-xl font-light text-[#2D2D31]">
        2. Enter Naming Prefix
      </label>

      <div className="flex flex-col gap-2 sm:flex-row">
        {/* Project name field */}
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="project-name" className="text-xs text-gray-500">
            Project / Client Name
          </label>
          <input
            id="project-name"
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value.toUpperCase())}
            placeholder="e.g., MAIN_ST or ACME_CORP"
            className="w-full rounded-md border border-gray-300 p-2 text-sm uppercase"
          />
        </div>

        {/* Date picker — always outputs YYYY-MM-DD */}
        <div className="flex flex-col gap-1 sm:w-44">
          <label htmlFor="scan-date" className="text-xs text-gray-500">
            Scan Date
          </label>
          <input
            id="scan-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border border-gray-300 p-2 text-sm"
          />
        </div>
      </div>

      {/* Live preview */}
      {previewName ? (
        <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2">
          <p className="text-xs text-gray-400 mb-0.5">Files will be named:</p>
          <p className="text-sm font-mono text-gray-700">{previewName}</p>
          <p className="text-xs text-gray-400 mt-1">
            Uploaded to folder:{' '}
            <span className="font-mono text-gray-600">
              {projectName.trim()}_{date}/
            </span>
          </p>
        </div>
      ) : (
        <p className="text-xs text-gray-400">
          Enter a project name and date to see a preview.
        </p>
      )}
    </div>
  );
}

export default PrefixInput;
