// src/components/ActionPanel.jsx

// this component contains the main "process" button.
function ActionPanel({ onProcess, isLoading }) {
  return (
    <div className="flex w-full flex-col gap-4 rounded-md border border-[#EDEDF0] bg-white p-4">
      <h2 className="text-xl font-light text-[#2D2D31]">3. Process Files</h2>
      <button
        onClick={onProcess}
        disabled={isLoading}
        className="cursor-pointer rounded-md bg-[#FD366E] px-4 py-2 text-white disabled:opacity-50"
      >
        {isLoading ? 'Processing...' : 'Process Files'}
      </button>
    </div>
  );
}

export default ActionPanel;