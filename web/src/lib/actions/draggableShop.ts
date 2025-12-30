import type { Action } from 'svelte/action';

// LocalStorage key for saving shop position
const STORAGE_KEY = 'ox_inventory_shop_position';

let shopState: {
  moving: boolean;
  left: number;
  top: number;
  container: HTMLElement | null;
} = {
  moving: false,
  left: 0,
  top: 0,
  container: null,
};

let initialized = false;
let handleCount = 0;

function getSavedPosition(): { left: number; top: number } | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function savePosition(left: number, top: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ left, top }));
  } catch {
    // Ignore storage errors
  }
}

function onMouseMove(e: MouseEvent) {
  if (shopState.moving && shopState.container) {
    shopState.left += e.movementX;
    shopState.top += e.movementY;
    shopState.container.style.left = `${shopState.left}px`;
    shopState.container.style.top = `${shopState.top}px`;
    shopState.container.style.transform = 'none';
  }
}

function onMouseUp() {
  if (shopState.moving) {
    savePosition(shopState.left, shopState.top);
    shopState.moving = false;
  }
}

export const draggableShop: Action<HTMLElement, { containerId: string }> = (node, { containerId }) => {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!initialized) {
    initialized = true;

    const rect = container.getBoundingClientRect();
    const savedPos = getSavedPosition();

    if (savedPos) {
      shopState.left = Math.max(0, Math.min(savedPos.left, window.innerWidth - rect.width));
      shopState.top = Math.max(0, Math.min(savedPos.top, window.innerHeight - rect.height));
    } else {
      // Default position: right side of screen, vertically centered
      shopState.left = window.innerWidth - rect.width - 100;
      shopState.top = (window.innerHeight - rect.height) / 2;
    }

    container.style.position = 'fixed';
    container.style.left = `${shopState.left}px`;
    container.style.top = `${shopState.top}px`;
    container.style.transform = 'none';
    container.style.userSelect = 'none';

    shopState.container = container;

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  handleCount++;

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    shopState.moving = true;
    e.preventDefault();
    e.stopPropagation();
  };

  node.addEventListener('mousedown', onMouseDown);

  return {
    destroy() {
      node.removeEventListener('mousedown', onMouseDown);
      handleCount--;

      if (handleCount <= 0) {
        initialized = false;
        shopState.container = null;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }
    }
  };
};

// Reset state when shop closes
export function resetShopDrag() {
  initialized = false;
  handleCount = 0;
  shopState = {
    moving: false,
    left: 0,
    top: 0,
    container: null,
  };
}
