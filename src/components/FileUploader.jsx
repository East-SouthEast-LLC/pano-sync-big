// src/components/FileUploader.jsx
import { useState, useRef } from 'react';

// a reusable file uploader component with drag-and-drop support
function FileUploader({ title, onFilesSelected, accept, multiple = false }) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const inputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files && files.length > 0) {
      onFilesSelected(files);
    }
  };

  const handleFileChange = (event) => {
    if (event.target.files) {
      onFilesSelected(Array.from(event.target.files));
    }
  };

  const onAreaClick = () => {
    inputRef.current.click();
  };

  // Build a human-readable hint for accepted formats
  const acceptHint = (accept + ',.zip')
    .split(',')
    .map(s => s.replace('.', '').toUpperCase())
    .filter((v, i, a) => a.indexOf(v) === i) // dedupe
    .join(', ');

  return (
    <div className="flex w-full flex-col gap-2">
      <h2 className="text-xl font-light text-[#2D2D31]">{title}</h2>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={onAreaClick}
        className={`flex justify-center items-center w-full px-6 py-10 border-2 border-dashed rounded-md cursor-pointer transition-colors
          ${isDraggingOver ? 'border-gray-400 bg-gray-100' : 'border-gray-300 bg-white hover:bg-gray-50'}`}
      >
        <div className="text-center">
          <p className="text-sm text-gray-500">
            <span className="font-semibold text-[#FD366E]">Click to upload</span> or drag and drop
          </p>
          <p className="text-xs text-gray-400">{acceptHint}</p>
          <p className="text-xs text-gray-400 mt-1">ZIP folders accepted</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          onChange={handleFileChange}
          accept={accept + ',.zip'}
          multiple={multiple}
          className="hidden"
        />
      </div>
    </div>
  );
}

export default FileUploader;
