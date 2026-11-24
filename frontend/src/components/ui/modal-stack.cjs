function createModalStack() {
  const stack = [];
  let nextLayer = 1000;

  return {
    register(id) {
      const existingIndex = stack.indexOf(id);
      if (existingIndex !== -1) stack.splice(existingIndex, 1);
      stack.push(id);
      const layer = nextLayer;
      nextLayer += 2;
      return layer;
    },
    unregister(id) {
      const index = stack.indexOf(id);
      if (index !== -1) stack.splice(index, 1);
    },
    isTop(id) {
      return stack[stack.length - 1] === id;
    },
    get size() {
      return stack.length;
    },
  };
}

const modalStack = createModalStack();
let originalBodyOverflow = '';

function registerModal(id) {
  const wasEmpty = modalStack.size === 0;
  const layer = modalStack.register(id);
  if (wasEmpty && typeof document !== 'undefined') {
    originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  return layer;
}

function unregisterModal(id) {
  modalStack.unregister(id);
  if (modalStack.size === 0 && typeof document !== 'undefined') {
    document.body.style.overflow = originalBodyOverflow;
  }
}

module.exports = {
  createModalStack,
  registerModal,
  unregisterModal,
  isTopModal: (id) => modalStack.isTop(id),
};
