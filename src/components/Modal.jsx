// src/components/Modal.jsx

// a generic modal component for displaying content in a popup
function Modal({ isOpen, onClose, title, children }) {
  // if the modal is not open, render nothing
  if (!isOpen) {
    return null;
  }

  return (
    // backdrop container: covers the whole screen with a semi-transparent, blurred background
    <div className="fixed inset-0 bg-gray-500 bg-opacity-25 backdrop-blur-sm z-50 flex justify-center items-center">
      {/* modal panel: the white box in the center */}
      <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-[#2D2D31]">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>
        {/* this is where the modal's content (passed as children) will be rendered */}
        <div>{children}</div>
      </div>
    </div>
  );
}

export default Modal;