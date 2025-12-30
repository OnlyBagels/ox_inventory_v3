import type { InventoryState } from '$lib/state/inventory';
import type { Action } from 'svelte/action';

// Match cell size from InventoryWindow
const CELL_SIZE = 75;
const GAP = 0;

// LocalStorage key for saving inventory positions
const STORAGE_KEY = 'ox_inventory_positions';

// Track which inventories have been fully initialized (position set)
const initializedInventories = new Set<string>();

// Store state per inventory - shared across all drag handles for the same inventory
const inventoryState = new Map<string, {
  moving: boolean;
  left: number;
  top: number;
  container: HTMLElement;
  positionKey: string;
  handleCount: number; // Track how many handles are attached
}>();

// Global mouse handlers - only one set for all inventories
let globalHandlersAttached = false;

function getSavedPositions(): Record<string, { left: number; top: number }> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function savePosition(inventoryType: string, left: number, top: number) {
  try {
    const positions = getSavedPositions();
    positions[inventoryType] = { left, top };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // Ignore storage errors
  }
}

function onGlobalMouseMove(e: MouseEvent) {
  for (const state of inventoryState.values()) {
    if (state.moving) {
      state.left += e.movementX;
      state.top += e.movementY;
      state.container.style.top = `${state.top}px`;
      state.container.style.left = `${state.left}px`;
    }
  }
}

function onGlobalMouseUp() {
  for (const state of inventoryState.values()) {
    if (state.moving) {
      savePosition(state.positionKey, state.left, state.top);
      state.moving = false;
    }
  }
}

function attachGlobalHandlers() {
  if (globalHandlersAttached) return;
  globalHandlersAttached = true;
  window.addEventListener('mousemove', onGlobalMouseMove);
  window.addEventListener('mouseup', onGlobalMouseUp);
}

function detachGlobalHandlers() {
  if (inventoryState.size > 0) return; // Still have inventories
  globalHandlersAttached = false;
  window.removeEventListener('mousemove', onGlobalMouseMove);
  window.removeEventListener('mouseup', onGlobalMouseUp);
}

export const draggableWindow: Action<HTMLElement, { inventory: InventoryState }> = (node, { inventory }) => {
  const container = document.getElementById(`inventory-${inventory.inventoryId}`) as HTMLElement;

  if (!container) return;

  // Initialize position only once per inventory
  if (!initializedInventories.has(inventory.inventoryId)) {
    initializedInventories.add(inventory.inventoryId);

    const gridWidth = CELL_SIZE * Math.min(inventory.width, 11) + GAP * (Math.min(inventory.width, 11) - 1) + 16 + 12;
    const gridHeight = CELL_SIZE * Math.min(inventory.height, 5) + GAP * (Math.min(inventory.height, 5) - 1) + 16 + 12;

    const positionKey = inventory.type || 'default';
    const savedPositions = getSavedPositions();
    const savedPos = savedPositions[positionKey];

    let left: number;
    let top: number;

    if (savedPos) {
      left = Math.max(0, Math.min(savedPos.left, window.innerWidth - gridWidth));
      top = Math.max(0, Math.min(savedPos.top, window.innerHeight - gridHeight));
    } else {
      left =
        inventory.type === 'player'
          ? window.innerWidth / 2 - gridWidth / 2
          : window.innerWidth / 16;
      top =
        inventory.type === 'player'
          ? window.innerHeight / 2 - gridHeight / 2
          : window.innerHeight / 16;

      // Avoid overlapping with other inventories
      while (true) {
        const element = document.elementFromPoint(left, top) as HTMLElement;
        if (!element || element.id === 'app' || element.dataset.slot) break;
        const rect = element.getBoundingClientRect();
        left = rect.right + 2;
        top = rect.top;
      }
    }

    container.style.position = 'absolute';
    container.style.top = `${top}px`;
    container.style.left = `${left}px`;
    container.style.userSelect = 'none';

    inventoryState.set(inventory.inventoryId, {
      moving: false,
      left,
      top,
      container,
      positionKey,
      handleCount: 0
    });

    attachGlobalHandlers();
  }

  const state = inventoryState.get(inventory.inventoryId)!;
  state.handleCount++;

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    state.moving = true;
    e.preventDefault();
    e.stopPropagation();
  };

  node.addEventListener('mousedown', onMouseDown);

  return {
    destroy() {
      node.removeEventListener('mousedown', onMouseDown);

      state.handleCount--;

      // Only clean up when all handles for this inventory are destroyed
      if (state.handleCount <= 0) {
        initializedInventories.delete(inventory.inventoryId);
        inventoryState.delete(inventory.inventoryId);
        detachGlobalHandlers();
      }
    }
  };
};
