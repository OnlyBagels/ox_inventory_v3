<script lang="ts">
import DragPreview from '$lib/components/DragPreview.svelte';
import InventoryWindow from '$lib/components/InventoryWindow.svelte';
import QuantityModal from '$lib/components/QuantityModal.svelte';
import ContextMenu from '$lib/components/context-menu/ContextMenu.svelte';
import Tooltip from '$lib/components/tooltip/Tooltip.svelte';
import { Shop } from '$lib/components/shop';
import { CreateItem } from '$lib/helpers/create-item';
import { useNuiEvent } from '$lib/hooks/useNuiEvents';
import { contextMenu } from '$lib/state/context-menu.svelte';
import { type DragItemType, InventoryState } from '$lib/state/inventory';
import { shopState } from '$lib/state/shop.svelte';
import { tooltip } from '$lib/state/tooltip.svelte';
import { debugData } from '$lib/utils/debugData';
import { fetchNui } from '$lib/utils/fetchNui';
import { isEnvBrowser } from '$lib/utils/misc';
import type { BaseInventory } from '@common/inventory/class';
import { GetInventoryItem, type InventoryItem } from '@common/item';

// Hotbar slot configuration
interface HotbarSlotConfig {
  id: string;
  label: string;
  keybind: string;
  width: number;
  height: number;
  slotIndex: number; // The inventory slot index this hotbar slot maps to
  item: InventoryItem | null;
  allowedCategories?: string[];
}

// Default hotbar slots configuration
// These slot indices are at the END of the player inventory (after the visible 11x5 = 55 slots)
// Player inventory is extended to include hotbar slots (11 wide x 2 rows = 22 slots for hotbar)
// Layout (2 rows, 11 cols, no gaps):
// Row 1: PRIMARY(5) | SECONDARY(2) | MELEE(1) | BAG(1) | VEST(2)
// Row 2: PRIMARY(cont) | UTIL1(1) | UTIL2(1) | MELEE(cont) | BAG(cont) | VEST(cont)
const HOTBAR_START_SLOT = 55; // After the 11x5 visible inventory
const INV_WIDTH = 11;
const defaultHotbarSlots: HotbarSlotConfig[] = [
  { id: 'primary', label: 'Primary', keybind: '1', width: 5, height: 2, slotIndex: HOTBAR_START_SLOT, item: null, allowedCategories: ['weapon'] },
  { id: 'secondary', label: 'Sidearm', keybind: '2', width: 2, height: 1, slotIndex: HOTBAR_START_SLOT + 5, item: null, allowedCategories: ['weapon'] },
  { id: 'melee', label: 'Melee', keybind: '3', width: 1, height: 2, slotIndex: HOTBAR_START_SLOT + 7, item: null, allowedCategories: ['weapon'] },
  { id: 'bag', label: 'Bag', keybind: '6', width: 1, height: 2, slotIndex: HOTBAR_START_SLOT + 8, item: null, allowedCategories: ['bag'] },
  { id: 'armor', label: 'Vest', keybind: '7', width: 2, height: 2, slotIndex: HOTBAR_START_SLOT + 9, item: null, allowedCategories: ['vest'] },
  { id: 'utility1', label: 'Item', keybind: '4', width: 1, height: 1, slotIndex: HOTBAR_START_SLOT + INV_WIDTH + 5, item: null },
  { id: 'utility2', label: 'Item', keybind: '5', width: 1, height: 1, slotIndex: HOTBAR_START_SLOT + INV_WIDTH + 6, item: null },
];

// Cell size matching InventoryWindow
const CELL_SIZE = 75;
const GAP = 0;

let visible = $state(false);
const keyPressed = { shift: false, control: false, alt: false };
let openInventories = $state<{ inventory: InventoryState; items: Partial<InventoryItem>[] }[]>([]);
const inventoryCount = $derived(openInventories.length - 1);
let playerId = $state(0);

// Hotbar state - starts collapsed, user clicks 3-dot button to expand
let hotbarVisible = $state(false);
let hotbarSlots = $state<HotbarSlotConfig[]>(structuredClone(defaultHotbarSlots));
let equippedSlotId = $state<string | null>(null);

function handleHotbarSlotClick(slotId: string) {
  const slot = hotbarSlots.find((s) => s.id === slotId);
  if (!slot?.item) return;

  // Bag slot - open the bag inventory instead of equipping
  if (slotId === 'bag') {
    fetchNui('hotbarOpenBag', { itemId: slot.item.uniqueId });
    return;
  }

  // Armor slot - open the armor/container inventory instead of equipping
  if (slotId === 'armor') {
    fetchNui('hotbarOpenArmor', { itemId: slot.item.uniqueId });
    return;
  }

  // Toggle equip/unequip for other slots
  if (equippedSlotId === slotId) {
    equippedSlotId = null;
    fetchNui('hotbarUnequip', { slotId });
  } else {
    equippedSlotId = slotId;
    fetchNui('hotbarEquip', { slotId, itemId: slot.item.uniqueId });
  }
}

// Quantity selector state
let selectedQty = $state<number>(1);
let qtyMode = $state<'fixed' | 'half' | 'custom' | 'all'>('fixed');
let showQuantityModal = $state(false);
let customQtyMaxAmount = $state(999);

function handleQtySelect(value: number | 'half' | 'custom' | 'all') {
  if (typeof value === 'number') {
    selectedQty = value;
    qtyMode = 'fixed';
  } else if (value === 'custom') {
    // Show modal for custom quantity
    showQuantityModal = true;
  } else {
    qtyMode = value;
  }
}

function handleCustomQtyConfirm(qty: number) {
  selectedQty = qty;
  qtyMode = 'fixed';
  showQuantityModal = false;
}

function handleCustomQtyCancel() {
  showQuantityModal = false;
}

$effect(() => {
  if (visible) return;
  if (tooltip.visible) tooltip.close();
  if (contextMenu.visible) contextMenu.close();
  if (isDragging) resetDragState();
});

debugData<{ inventory: Partial<BaseInventory>; items: Partial<InventoryItem>[] }>(
  [
    {
      action: 'openInventory',
      data: {
        inventory: {
          inventoryId: 'player:0',
          label: 'Inventory',
          items: {
            0: 7,
            4: 8,
          },
          width: 12,
          height: 8,
          weight: 15200,
          maxWeight: 30000,
        },
        items: [
          {
            name: 'ammo_9',
            quantity: 7,
            inventoryId: 'player:0',
            uniqueId: 7,
            anchorSlot: 0,
            label: '9mm',
            weight: 50,
            description: 'Standard ammunition for pistols and SMGs, offering balanced power and reliability.',
          },
          {
            name: 'HeavyPistol',
            quantity: 1,
            inventoryId: 'player:0',
            uniqueId: 8,
            anchorSlot: 4,
            durability: 34,
            weight: 1500,
            label: 'Heavy Pistol',
            description: 'A high-powered sidearm with strong recoil and devastating stopping power.',
            ingredients: 'Mustard, Ketchup, Beef',
            plate: 'XYZ123XD',
          },
        ],
      },
    },
    {
      action: 'openInventory',
      data: {
        inventory: {
          inventoryId: 'trunk',
          items: {
            0: 11,
          },
          height: 5,
          width: 8,
          label: 'Trunk',
          weight: 4500,
          maxWeight: 50000,
        },
        items: [
          {
            name: 'HeavyRifle',
            quantity: 1,
            inventoryId: 'trunk',
            uniqueId: 11,
            anchorSlot: 0,
            durability: 90,
            weight: 4500,
            label: 'Heavy Rifle',
            description: 'A high-caliber rifle with devastating power, perfect for mid-to-long-range combat.',
            plate: 'XYZ123XD',
          },
        ],
      },
    },
  ],
  1000,
);

debugData<Record<string, string>>([
  {
    action: 'displayMetadata',
    data: {
      plate: 'Plate',
      ingredients: 'Ingredients',
    },
  },
]);

debugData<Partial<InventoryItem>[]>(
  [
    {
      action: 'updateItem',
      data: [
        {
          name: 'HeavyRifle',
          quantity: 1,
          inventoryId: 'player:0',
          uniqueId: 11,
          anchorSlot: 37,
          durability: 90,
          weight: 4500,
          label: 'Heavy Rifle',
          description: 'A high-caliber rifle with devastating power, perfect for mid-to-long-range combat.',
          plate: 'XYZ123XD',
        },
      ],
    },
  ],
  1500,
);

useNuiEvent('openInventory', async (data: { inventory: InventoryState; items: InventoryItem[]; playerId: number }) => {
  if (!playerId) playerId = data.playerId;

  let inventory = getInventoryById(data.inventory.inventoryId);

  if (inventory) inventory.items = data.inventory.items;
  else {
    inventory = new InventoryState(data.inventory);
    openInventories.push({ inventory, items: data.items });
  }

  for (const value of data.items) {
    let item: InventoryItem = GetInventoryItem(value.uniqueId);

    if (item) {
      // todo: figure out why this is so scuffed
      const oldInventory =
        item.inventoryId && item.inventoryId !== data.inventory.inventoryId && InventoryState.FromId(item.inventoryId);

      item.delete();

      if (oldInventory) oldInventory.refreshSlots();
    }

    item = await CreateItem(value);

    if (typeof item.ammoName === 'string') {
      await CreateItem({ name: item.ammoName });
    }

    item.move(inventory, item.anchorSlot);
  }

  inventory.refreshSlots();
  visible = true;
  inventoryOpenedAt = Date.now(); // Track when inventory was opened
});

useNuiEvent('updateItem', async (items: InventoryItem[]) => {
  const inventories: Set<InventoryState> = new Set();

  for (const data of items) {
    const item = GetInventoryItem(data.uniqueId);
    const inventory = InventoryState.FromId(data.inventoryId);

    if (inventory) inventories.add(inventory);

    // Handle deleted items (quantity 0 or no inventory)
    if (data.quantity === 0 || !data.inventoryId) {
      if (item) {
        const oldInventory = InventoryState.FromId(item.inventoryId);
        if (oldInventory) inventories.add(oldInventory);
        item.delete();
      }
      continue;
    }

    if (!item) {
      const newItem: InventoryItem = await CreateItem(data);
      newItem.move(inventory, newItem.anchorSlot);
      continue;
    }

    const oldInventory = InventoryState.FromId(item.inventoryId);

    if (oldInventory) inventories.add(oldInventory);

    item.delete();

    if (!inventory) continue;

    // todo: figure out why we can't reuse the existing item :sadge:
    const newItem: InventoryItem = await CreateItem(data);
    newItem.move(inventory, newItem.anchorSlot);
  }

  for (const inventory of inventories) inventory.refreshSlots();
});

useNuiEvent('clearInventory', (data: { inventoryId: string; keepItems?: number[] }) => {
  const inventory = InventoryState.FromId(data.inventoryId);

  if (!inventory) return;

  inventory.clear(data.keepItems);
  inventory.refreshSlots();
});

useNuiEvent('closeInventory', (inventoryId: string) => {
  if (inventoryId) {
    openInventories = openInventories.filter((openInventory) => openInventory.inventory.inventoryId !== inventoryId);
    return;
  }

  visible = false;
  openInventories = [];
});

useNuiEvent('displayMetadata', (data: Record<string, string>) => {
  tooltip.displayMetadata = { ...tooltip.displayMetadata, ...data };
});

// Hotbar NUI events
useNuiEvent('updateHotbar', async (data: { slots: { id: string; item: InventoryItem | null }[] }) => {
  for (const slotData of data.slots) {
    const slotIndex = hotbarSlots.findIndex((s) => s.id === slotData.id);
    if (slotIndex !== -1) {
      if (slotData.item) {
        // Create the item if it has data
        hotbarSlots[slotIndex].item = await CreateItem(slotData.item);
      } else {
        hotbarSlots[slotIndex].item = null;
      }
    }
  }
});

useNuiEvent('setHotbarVisible', (data: { visible: boolean }) => {
  hotbarVisible = data.visible;
});

useNuiEvent('setEquippedSlot', (data: { slotId: string | null }) => {
  equippedSlotId = data.slotId;
});

useNuiEvent('toggleHotbar', () => {
  hotbarVisible = !hotbarVisible;
});

// Shop NUI events
useNuiEvent('openShop', (data: { shop: any; playerData: any }) => {
  shopState.open(data);
});

useNuiEvent('closeShop', () => {
  shopState.close();
});

useNuiEvent('updateShopItems', (items: any[]) => {
  shopState.updateItems(items);
});

useNuiEvent('updateShopPlayerData', (data: any) => {
  shopState.updatePlayerData(data);
});

if (isEnvBrowser()) {
  const root = document.getElementById('app');

  // https://i.imgur.com/iPTAdYV.png - Night time img
  root!.style.backgroundImage = 'url("https://i.imgur.com/3pzRj9n.png")';
  root!.style.backgroundSize = 'cover';
  root!.style.backgroundRepeat = 'no-repeat';
  root!.style.backgroundPosition = 'center';
}

let isDragging = $state(false);
let dragSlot = $state<number | null>(null);
let dragItem = $state<DragItemType | null>(null);
let dragImg: HTMLElement = $state(null)!;
let dropIndicator: HTMLElement = $state(null)!;

// Track when inventory was opened to prevent Tab from immediately closing it
let inventoryOpenedAt = 0;
const TAB_CLOSE_DELAY = 200; // ms to wait before Tab can close inventory

// Double-click tracking
let lastClickTime = 0;
let lastClickSlot: number | null = null;
let lastClickInventoryId: string | null = null;
const DOUBLE_CLICK_THRESHOLD = 300; // ms

// Quick-move lock to prevent race conditions
let isQuickMoving = false;

function getDragItemProps({
  anchorSlot,
  rotate,
  uniqueId,
  inventoryId,
  quantity,
  height,
  width,
  icon,
  category,
  hash,
}: InventoryItem & { category?: string; hash?: number }): DragItemType {
  return {
    uniqueId,
    rotate,
    inventoryId,
    height,
    anchorSlot,
    width,
    icon,
    quantity,
    category,
    hash,
  };
}

function getInventoryById(inventoryId: string) {
  return openInventories.find((openInventory) => openInventory.inventory.inventoryId === inventoryId)?.inventory;
}

function onMouseDown(event: MouseEvent) {
  const target = event.target as HTMLElement;

  if (isDragging || !target?.dataset.slot) return;

  // Find the inventory grid by walking up the DOM tree
  const inventoryGrid = findInventoryGrid(target);

  if (!inventoryGrid?.dataset.inventoryid) return;

  const sourceInventory = getInventoryById(inventoryGrid.dataset.inventoryid as string);

  if (!sourceInventory || sourceInventory.viewOnly) return;

  const slot = +target.dataset.slot;
  const item = slot !== null && sourceInventory.getItemInSlot(slot);

  if (!item) return;

  if (event.button === 0) {
    // Check modifier keys FIRST before double-click detection
    // This prevents Ctrl+click from triggering "use item" when clicking quickly
    if (keyPressed.alt) {
      // prompt for amount of item to split from the stack (should this be on drop?)
      // Reset double-click tracking when using modifier
      lastClickTime = 0;
      lastClickSlot = null;
      lastClickInventoryId = null;
      return;
    } else if (keyPressed.control) {
      // Ctrl+click: quick-move item to another open inventory
      // Check lock synchronously BEFORE calling async function to prevent race conditions
      if (isQuickMoving) return;
      isQuickMoving = true;
      // Reset double-click tracking when using modifier
      lastClickTime = 0;
      lastClickSlot = null;
      lastClickInventoryId = null;
      quickMoveItem(item, sourceInventory);
      return;
    }

    const currentTime = Date.now();
    const inventoryId = inventoryGrid.dataset.inventoryid;

    // Check for double-click (same slot, same inventory, within threshold)
    // Only triggers for regular clicks without modifiers
    if (
      lastClickSlot === slot &&
      lastClickInventoryId === inventoryId &&
      currentTime - lastClickTime < DOUBLE_CLICK_THRESHOLD
    ) {
      // Double-click detected - use the item
      fetchNui('contextMenuClick', { itemId: item.uniqueId, buttonId: 'use' });
      lastClickTime = 0;
      lastClickSlot = null;
      lastClickInventoryId = null;
      return;
    }

    // Update last click tracking
    lastClickTime = currentTime;
    lastClickSlot = slot;
    lastClickInventoryId = inventoryId;

    isDragging = true;
    dragSlot = slot;
    dragItem = getDragItemProps(item);
  }
}

function resetDragState() {
  // Always reset isDragging, even if dragItem is already null
  isDragging = false;
  dragSlot = null;
  dragItem = null;
  document.body.style.cursor = 'auto';
}

/**
 * Find the first available slot in an inventory that can fit an item
 * Tries both normal and rotated orientations
 */
function findAvailableSlot(
  inventory: InventoryState,
  itemWidth: number,
  itemHeight: number,
  excludeItem?: InventoryItem
): { slot: number; rotate: boolean } | null {
  const width = inventory.width;
  const height = inventory.height;

  // For player inventory, only check the visible 5 rows (not hotbar)
  const maxHeight = inventory.type === 'player' ? 5 : height;

  // Try normal orientation first
  for (let y = 0; y < maxHeight; y++) {
    for (let x = 0; x < width; x++) {
      // Check if item fits at this position (normal orientation)
      if (x + itemWidth <= width && y + itemHeight <= maxHeight) {
        const slot = y * width + x;
        if (canPlaceItemAt(inventory, slot, itemWidth, itemHeight, excludeItem)) {
          return { slot, rotate: false };
        }
      }
    }
  }

  // If item is not square, try rotated orientation
  if (itemWidth !== itemHeight) {
    for (let y = 0; y < maxHeight; y++) {
      for (let x = 0; x < width; x++) {
        // Check if item fits at this position (rotated - swap width/height)
        if (x + itemHeight <= width && y + itemWidth <= maxHeight) {
          const slot = y * width + x;
          if (canPlaceItemAt(inventory, slot, itemHeight, itemWidth, excludeItem)) {
            return { slot, rotate: true };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Check if an item can be placed at a specific slot
 */
function canPlaceItemAt(
  inventory: InventoryState,
  anchorSlot: number,
  itemWidth: number,
  itemHeight: number,
  excludeItem?: InventoryItem
): boolean {
  const invWidth = inventory.width;

  // Check all slots the item would occupy
  for (let dy = 0; dy < itemHeight; dy++) {
    for (let dx = 0; dx < itemWidth; dx++) {
      const checkSlot = anchorSlot + dy * invWidth + dx;
      const existingItem = inventory.getItemInSlot(checkSlot);

      // If there's an item and it's not the one we're excluding, slot is occupied
      if (existingItem && existingItem !== excludeItem) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Quick-move item to another open inventory (Ctrl+click)
 * Places item in first available empty slot
 * Note: isQuickMoving lock is set in onMouseDown before calling this function
 */
async function quickMoveItem(item: InventoryItem, sourceInventory: InventoryState) {
  try {
    // Verify item still exists and is in the expected inventory
    const currentItem = GetInventoryItem(item.uniqueId);
    if (!currentItem || currentItem.inventoryId !== sourceInventory.inventoryId) {
      return;
    }

    // Find another open inventory to move to
    const targetInventory = openInventories.find(
      ({ inventory }) => inventory.inventoryId !== sourceInventory.inventoryId && !inventory.viewOnly
    )?.inventory;

    if (!targetInventory) {
      // No other inventory open
      return;
    }

    // Use current item data (might have been updated since click)
    const quantity = getQuantityToMove(currentItem.quantity);

    // Find an empty slot (no stacking - just place in empty space)
    const itemWidth = currentItem.rotate ? currentItem.height : currentItem.width;
    const itemHeight = currentItem.rotate ? currentItem.width : currentItem.height;
    const result = findAvailableSlot(targetInventory, itemWidth, itemHeight);

    if (!result) {
      // No space available
      return;
    }

    const targetSlot = result.slot;
    const newRotate = result.rotate ? !currentItem.rotate : currentItem.rotate;

    // Send single move request to server - server handles stacking/overflow
    await fetchNui(
      'moveItem',
      {
        fromType: sourceInventory.type,
        toType: targetInventory.type,
        fromId: sourceInventory.inventoryId,
        toId: targetInventory.inventoryId,
        fromSlot: currentItem.anchorSlot,
        toSlot: targetSlot,
        rotate: newRotate,
        quantity,
      },
      { data: true },
    );

    // Don't call onItemMovement - let the server's updateItem event handle UI updates
    // Wait for server response to arrive and be processed
    await new Promise(resolve => setTimeout(resolve, 150));
  } finally {
    isQuickMoving = false;
  }
}

function onItemMovement(
  item: InventoryItem,
  fromInventory: InventoryState,
  toInventory: InventoryState,
  quantity: number,
  slot: number,
) {
  if (!isEnvBrowser()) return;

  const result = quantity !== item.quantity ? item.split(toInventory, quantity, slot) : item.move(toInventory, slot);

  if (typeof result === 'object') Object.assign(item, result);

  fromInventory.refreshSlots();

  if (fromInventory !== toInventory) toInventory.refreshSlots();
}

function findInventoryGrid(element: HTMLElement | null): HTMLElement | null {
  while (element) {
    if (element.dataset?.inventoryid) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
}

function findSlotElement(element: HTMLElement | null): HTMLElement | null {
  while (element) {
    if (element.dataset?.slot !== undefined) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
}


function getSlotIdFromPoint(x: number, y: number, item: InventoryItem, inventoryGrid: HTMLElement | null) {
  if (!inventoryGrid) return null;

  const invRect = inventoryGrid.getBoundingClientRect();
  const gridPadding = 0;

  // Calculate relative position within the grid
  const relativeX = x - invRect.left - gridPadding;
  const relativeY = y - invRect.top - gridPadding;

  // Calculate slot coordinates
  const slotX = Math.floor(relativeX / CELL_SIZE);
  const slotY = Math.floor(relativeY / CELL_SIZE);

  // Get inventory width from the grid's data or calculate from dimensions
  const inventory = getInventoryById(inventoryGrid.dataset.inventoryid!);
  if (!inventory) return null;

  // Validate slot is within bounds
  if (slotX < 0 || slotY < 0 || slotX >= inventory.width || slotY >= inventory.height) {
    return null;
  }

  // Calculate linear slot index (row-major order)
  const slot = slotY * inventory.width + slotX;

  return slot;
}

function getQuantityToMove(itemQuantity: number): number {
  if (qtyMode === 'all') return itemQuantity;
  if (qtyMode === 'half') return Math.max(1, Math.floor(itemQuantity / 2));
  if (qtyMode === 'custom') {
    // For custom, we'd show a prompt - for now just use selectedQty
    return Math.min(selectedQty, itemQuantity);
  }
  // Fixed mode - use selectedQty but cap at item quantity
  return Math.min(selectedQty, itemQuantity);
}

async function onMouseUp(event: MouseEvent) {
  if (!isDragging || !dragItem || event.button !== 0) return;

  try {
    const fromInventory = getInventoryById(dragItem.inventoryId!);

    if (!fromInventory) throw new Error(`Cannot move item from unknown inventory (${dragItem.inventoryId})`);

    const item = fromInventory.getItemInSlot(dragItem.anchorSlot!);

    if (!item) throw new Error(`Cannot find item at slot ${dragItem.anchorSlot} in inventory ${dragItem.inventoryId}`);
    const indicatorTop = +dropIndicator.style.top.slice(0, -2);
    const indicatorLeft = +dropIndicator.style.left.slice(0, -2);

    // Use the top-left corner of the drop indicator (with small offset to be inside the slot)
    const anchorX = indicatorLeft + CELL_SIZE / 2;
    const anchorY = indicatorTop + CELL_SIZE / 2;
    const target = document.elementFromPoint(anchorX, anchorY) as HTMLElement;

    // Find the inventory grid by walking up the DOM
    const inventoryGrid = findInventoryGrid(target);
    const targetInventoryId = inventoryGrid?.dataset?.inventoryid || 'drop';

    // Use quantity selector or shift key for half
    const quantity = keyPressed.shift
      ? Math.max(1, Math.floor(item.quantity / 2))
      : getQuantityToMove(item.quantity);

    if (targetInventoryId === 'drop' && isEnvBrowser()) {
      debugData<{ inventory: Partial<BaseInventory>; items: Partial<InventoryItem>[] }>(
        [
          {
            action: 'openInventory',
            data: {
              inventory: {
                inventoryId: targetInventoryId,
                label: 'Drop',
                width: 6,
                height: 4,
                maxWeight: 50000,
                type: 'drop',
                items: {},
              },
              items: [],
            },
          },
        ],
        0,
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const toInventory = getInventoryById(targetInventoryId);

    // For hotbar or direct slot targets, check for data-slot attribute on the element
    // Otherwise calculate from grid position
    let slot: number | null;
    if (targetInventoryId === 'drop') {
      slot = 0;
    } else {
      // First check if target or parent has data-slot directly (for hotbar)
      const slotElement = findSlotElement(target);
      if (slotElement?.dataset?.slot !== undefined) {
        slot = parseInt(slotElement.dataset.slot);
      } else {
        slot = getSlotIdFromPoint(anchorX, anchorY, item, inventoryGrid);
      }
    }

    if (typeof slot !== 'number') throw new Error(`Cannot move item to invalid slot (${slot})`);

    // Check if rotation changed during drag
    const rotationChanged = dragItem.rotate !== item.rotate;

    if (fromInventory === toInventory && item.anchorSlot === slot && !rotationChanged) {
      // Item dropped in the same slot with no rotation change - no movement needed
      return;
    }

    item.tempRotate = dragItem.rotate;

    const success = await fetchNui(
      'moveItem',
      {
        fromType: fromInventory.type,
        toType: toInventory?.type || 'drop',
        fromId: fromInventory.inventoryId,
        toId: toInventory?.inventoryId,
        fromSlot: item.anchorSlot,
        toSlot: slot,
        rotate: item.tempRotate,
        quantity,
      },
      {
        data: true,
      },
    );

    if (success) {
      if (toInventory) onItemMovement(item, fromInventory, toInventory, quantity, slot);
    }
  } catch (err: any) {
    console.error(`Error during moveItem: ${err.message}`);
  } finally {
    resetDragState();
  }
}

async function rotateHoveredItem() {
  const item = tooltip.item;
  if (!item || item.width === item.height) return;

  const inventory = getInventoryById(item.inventoryId!);
  if (!inventory) return;

  // Toggle rotation
  const newRotate = !item.rotate;

  // Try to rotate the item on the server
  const success = await fetchNui(
    'rotateItem',
    {
      inventoryId: item.inventoryId,
      uniqueId: item.uniqueId,
      rotate: newRotate,
    },
    { data: true },
  );

  if (success || isEnvBrowser()) {
    // Update locally for browser testing or on success
    item.rotate = newRotate;
    inventory.refreshSlots();
  }
}

function onKeyDown(event: KeyboardEvent) {
  const key = event.key.toLowerCase();

  switch (key) {
    case 'escape':
      return fetchNui('closeInventory');
    case 'tab':
      // Prevent Tab from closing inventory if it was just opened
      // This prevents the Tab keypress that opened the inventory from immediately closing it
      if (Date.now() - inventoryOpenedAt < TAB_CLOSE_DELAY) {
        event.preventDefault();
        return;
      }
      return fetchNui('closeInventory');
    case 'r': {
      // If dragging, rotate the dragged item
      if (dragItem) {
        if (dragItem.width === dragItem.height) return;

        const temp = dragItem.width;
        dragItem.width = dragItem.height;
        dragItem.height = temp;
        dragItem.rotate = !dragItem.rotate;
        return;
      }

      // If hovering over an item, rotate it in place
      if (tooltip.visible && tooltip.item) {
        rotateHoveredItem();
        return;
      }

      return;
    }
    case 'control':
    case 'shift':
    case 'alt':
      return (keyPressed[key] = true);
  }
}

function onKeyUp(event: KeyboardEvent) {
  const key = event.key.toLowerCase() as keyof typeof keyPressed;

  if (keyPressed[key]) keyPressed[key] = false;
}

const preventDefault = (event: KeyboardEvent | MouseEvent) => event.preventDefault();
</script>

<svelte:window onmouseup={onMouseUp} onkeydown={onKeyDown} onkeyup={onKeyUp} ondragstart={preventDefault} />

<Tooltip />
<DragPreview bind:dragImg bind:dropIndicator {dragItem} />
<ContextMenu />
<QuantityModal
  visible={showQuantityModal}
  maxQuantity={customQtyMaxAmount}
  onConfirm={handleCustomQtyConfirm}
  onCancel={handleCustomQtyCancel}
/>

<!-- Inventories (each is independently draggable) -->
{#each openInventories as { inventory }}
  <InventoryWindow
    {visible}
    {isDragging}
    {dragItem}
    {inventory}
    itemState={inventory.itemState}
    {onMouseDown}
    {inventoryCount}
    {playerId}
    {selectedQty}
    onQtySelect={handleQtySelect}
    onHotbarToggle={() => hotbarVisible = !hotbarVisible}
    hotbarExpanded={hotbarVisible}
    {hotbarSlots}
    {equippedSlotId}
    onHotbarSlotClick={handleHotbarSlotClick}
  />
{/each}

<!-- Shop UI -->
<Shop />
