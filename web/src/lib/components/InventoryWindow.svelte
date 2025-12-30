<script lang="ts">
import { draggableWindow } from '$lib/actions/draggableWindow';
import { itemTooltip } from '$lib/actions/itemTooltip';
import { openContextMenu } from '$lib/actions/openContextMenu';
import DurabilityCircle from '$lib/components/DurabilityCircle.svelte';
import Hotbar from '$lib/components/Hotbar.svelte';
import ItemImage from '$lib/components/ItemImage.svelte';
import QuantitySelector from '$lib/components/QuantitySelector.svelte';
import { SLOT_GAP, SLOT_SIZE } from '$lib/constants/inventory';
import type { DragItemType, InventoryState } from '$lib/state/inventory';
import { cn } from '$lib/utils.js';
import { fetchNui } from '$lib/utils/fetchNui';
import { formatWeight, formatWeightCapacity, getWeightPercentage } from '$lib/utils/formatWeight';
import type { InventoryItem } from '@common/item';
import { GetItemData, calculateItemWeight } from '@common/item';
import Icon from '@iconify/svelte';

interface HotbarSlotConfig {
  id: string;
  label: string;
  keybind: string;
  width: number;
  height: number;
  slotIndex: number;
  item: InventoryItem | null;
  allowedCategories?: string[];
}

interface Props {
  visible: boolean;
  isDragging: boolean;
  dragItem: DragItemType | null;
  inventory: InventoryState;
  itemState: InventoryState['itemState'];
  onMouseDown: (event: MouseEvent) => void;
  inventoryCount: number;
  playerId: number;
  selectedQty?: number;
  onQtySelect?: (qty: number | 'half' | 'custom' | 'all') => void;
  onHotbarToggle?: () => void;
  hotbarExpanded?: boolean;
  hotbarSlots?: HotbarSlotConfig[];
  equippedSlotId?: string | null;
  onHotbarSlotClick?: (slotId: string) => void;
}

const { inventory, visible, itemState, isDragging, dragItem, onMouseDown, inventoryCount, playerId, selectedQty = 1, onQtySelect, onHotbarToggle, hotbarExpanded = false, hotbarSlots = [], equippedSlotId = null, onHotbarSlotClick }: Props = $props();

// Fixed visible grid size: 11 columns x 5 rows
const VISIBLE_COLS = 11;
const VISIBLE_ROWS = 5;
const CELL_SIZE = 75; // Bigger squares
const GAP = 0; // No gap between slots
const HOTBAR_COLS = 11; // Hotbar is 11 columns wide

// Calculate weight percentage for progress bar - triggers when itemState changes
// We subscribe to itemState to ensure reactivity when items change
const weightPercent = $derived.by(() => {
  // Access itemState to create dependency - this ensures we recalculate when items change
  $itemState;
  return getWeightPercentage(inventory.weight ?? 0, inventory.maxWeight ?? 30000);
});

// Reactive weight display text
const weightDisplay = $derived.by(() => {
  $itemState;
  return formatWeightCapacity(inventory.weight ?? 0, inventory.maxWeight ?? 30000);
});

// Check if this is the player inventory
const isPlayerInventory = $derived(inventory.type === 'player');

// Check if scrolling is needed
const needsScroll = $derived(inventory.width > VISIBLE_COLS || inventory.height > VISIBLE_ROWS);

// Calculate container dimensions
const gridWidth = $derived(Math.min(inventory.width, VISIBLE_COLS) * (CELL_SIZE + GAP));
const gridHeight = $derived(Math.min(inventory.height, VISIBLE_ROWS) * (CELL_SIZE + GAP));

// Container width should match hotbar when expanded (for player inventory)
const hotbarWidth = HOTBAR_COLS * CELL_SIZE;
const containerWidth = $derived(isPlayerInventory && hotbarExpanded ? hotbarWidth : gridWidth);

// Show header only when multiple inventories are open
const showHeader = $derived(inventoryCount > 0);

// For player inventory, only show the first 5 rows (55 slots) - hotbar slots are in rows 6-8
const visibleSlotCount = $derived(isPlayerInventory ? VISIBLE_ROWS * inventory.width : inventory.width * inventory.height);
const displayHeight = $derived(isPlayerInventory ? VISIBLE_ROWS : inventory.height);

// Derive hotbar slots with items from the inventory itemState
const hotbarSlotsWithItems = $derived.by(() => {
  if (!isPlayerInventory || !hotbarSlots.length) return [];

  const items = $itemState;
  return hotbarSlots.map(slot => ({
    ...slot,
    // Get the item from the inventory's itemState at the slot's index
    item: items[slot.slotIndex] ?? null
  }));
});
</script>

<div class={cn(!visible && 'hidden', 'inv-wrapper')} id={`inventory-${inventory.inventoryId}`}>
  <!-- Quantity selector attached to left side for player inventory -->
  {#if isPlayerInventory && onQtySelect}
    <div class="inv-qty-selector">
      <QuantitySelector {selectedQty} onSelect={onQtySelect} />
    </div>
  {/if}

  <div class="flex flex-col inv-container" style={`width: ${containerWidth + 12}px;`}>
    <!-- Drag handle border (top) -->
    <div class="inv-drag-handle inv-drag-handle-top" use:draggableWindow={{ inventory }}></div>

    <!-- Main content wrapper with side drag handles -->
    <div class="inv-content-wrapper">
      <!-- Drag handle border (left) -->
      <div class="inv-drag-handle inv-drag-handle-left" use:draggableWindow={{ inventory }}></div>

      <div class="inv-inner-content">
        <!-- Header - Only show when multiple inventories are open -->
        {#if showHeader}
          <div class="inv-header" use:draggableWindow={{ inventory }}>
            <p class="text-sm font-medium text-white/90">
              {inventory.label}
              {#if inventory.playerId}
                <span class="text-white/50">({inventory.playerId === playerId ? 'you' : inventory.playerId})</span>
              {/if}
            </p>
            {#if inventory.playerId !== playerId}
              <button
                type="button"
                class="inv-close-btn"
                onclick={() =>
                  fetchNui(`closeInventory`, { inventoryId: inventory.inventoryId, inventoryCount: inventoryCount })}
              >
                <Icon icon="material-symbols:close" width={18} height={18} />
              </button>
            {/if}
          </div>
        {/if}

        <!-- Grid Container with scroll -->
        <div
          class="inv-grid-container"
          style={`max-width: ${gridWidth}px; max-height: ${gridHeight}px;`}
        >
          <!-- Grid -->
          <div
            id="inv-grid"
            class="inv-grid"
            style={`grid-template-rows: repeat(${displayHeight}, ${CELL_SIZE}px); grid-template-columns: repeat(${inventory.width}, ${CELL_SIZE}px);`}
            data-inventoryid={inventory.inventoryId}
          >
            {#each $itemState.slice(0, visibleSlotCount) as item, index (item ? `${item.anchorSlot}-${index}` : `empty-${index}`)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="inv-slot"
                style={`width: ${CELL_SIZE}px; height: ${CELL_SIZE}px;`}
                data-slot={index}
                onmousedown={onMouseDown}
              >
                {#if item && item.anchorSlot === index}
                  {@const w = item.width}
                  {@const h = item.height}
                  {@const totalWeight = calculateItemWeight(item)}
                  {@const itemWidth = CELL_SIZE * w + GAP * (w - 1)}
                  {@const itemHeight = CELL_SIZE * h + GAP * (h - 1)}
                  <div
                    data-slot={index}
                    data-anchorSlot={item.anchorSlot === index}
                    use:openContextMenu={{ itemId: item.uniqueId }}
                    use:itemTooltip={{ item }}
                    class={cn(
                      'inv-item',
                      isDragging && 'pointer-events-none',
                      dragItem?.uniqueId === item.uniqueId && 'opacity-50 brightness-50 grayscale-[0.6]',
                    )}
                    style={`width: ${itemWidth}px; height: ${itemHeight}px;`}
                  >
                    <ItemImage width={w} height={h} icon={item.icon} rotate={item.rotate} />

                    <!-- Weight and quantity at top -->
                    <div class="inv-item-top">
                      <span class="inv-item-weight">{formatWeight(totalWeight)}</span>
                      <span class="inv-item-qty">{item.quantity}x</span>
                    </div>

                    <!-- Durability bar at bottom for weapons -->
                    {#if item.durability !== undefined}
                      <div class="inv-item-durability">
                        <div
                          class="inv-item-durability-fill"
                          style={`width: ${item.durability}%; background: ${item.durability > 60 ? '#22c55e' : item.durability > 30 ? '#eab308' : '#ef4444'};`}
                        ></div>
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <!-- Weight Bar - Matching reference exactly -->
        <div class="inv-weight-bar">
          <div class="inv-weight-bar-track">
            <div
              class="inv-weight-bar-fill"
              style={`width: ${weightPercent}%`}
            ></div>
            <span class="inv-weight-text">
              {weightDisplay}
            </span>
          </div>
        </div>
      </div>

      <!-- Drag handle border (right) -->
      <div class="inv-drag-handle inv-drag-handle-right" use:draggableWindow={{ inventory }}></div>
    </div>

    <!-- Hotbar section (only visible when expanded) -->
    {#if isPlayerInventory && hotbarExpanded && hotbarSlotsWithItems.length > 0}
      <!-- Divider line between inventory and hotbar -->
      <div class="inv-hotbar-divider"></div>

      <div class="inv-hotbar-wrapper">
        <!-- Left drag handle for hotbar section -->
        <div class="inv-drag-handle inv-drag-handle-left" use:draggableWindow={{ inventory }}></div>

        <Hotbar
          visible={true}
          slots={hotbarSlotsWithItems}
          {equippedSlotId}
          onSlotClick={onHotbarSlotClick}
          {onMouseDown}
          {isDragging}
          {dragItem}
          inventoryId={inventory.inventoryId}
        />

        <!-- Right drag handle for hotbar section -->
        <div class="inv-drag-handle inv-drag-handle-right" use:draggableWindow={{ inventory }}></div>
      </div>
    {/if}

    <!-- Bottom drag handle with toggle button (follows the hotbar when expanded) -->
    <div class="inv-drag-handle inv-drag-handle-bottom" use:draggableWindow={{ inventory }}>
      {#if isPlayerInventory && onHotbarToggle}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="inv-hotbar-toggle"
          class:inv-hotbar-toggle-expanded={hotbarExpanded}
          onclick={(e) => { e.stopPropagation(); onHotbarToggle(); }}
        >
          <span class="inv-hotbar-dot"></span>
          <span class="inv-hotbar-dot"></span>
          <span class="inv-hotbar-dot"></span>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .inv-wrapper {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: 0;
    /* Default positioning - will be overridden by draggableWindow action */
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 100;
  }

  .inv-qty-selector {
    flex-shrink: 0;
  }

  .inv-container {
    background: rgba(20, 20, 22, 0.95);
    border-radius: 4px;
    overflow: hidden;
    /* Ensure items are clipped to this container */
    isolation: isolate;
  }

  .inv-content-wrapper {
    display: flex;
    flex-direction: row;
  }

  .inv-inner-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  .inv-drag-handle {
    background: rgba(60, 60, 65, 0.6);
    cursor: move;
    transition: background 0.15s ease;
  }

  .inv-drag-handle:hover {
    background: rgba(80, 80, 85, 0.8);
  }

  .inv-drag-handle-top,
  .inv-drag-handle-bottom {
    height: 6px;
    width: 100%;
  }

  .inv-drag-handle-bottom {
    position: relative;
  }

  .inv-hotbar-divider {
    height: 2px;
    width: 100%;
    background: rgba(60, 60, 65, 0.8);
    position: relative;
  }

  .inv-drag-handle-left,
  .inv-drag-handle-right {
    width: 6px;
    flex-shrink: 0;
  }

  .inv-hotbar-wrapper {
    display: flex;
    flex-direction: row;
  }

  .inv-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.4);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    cursor: move;
  }

  .inv-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .inv-close-btn:hover {
    background: rgba(239, 68, 68, 0.8);
    color: white;
  }

  .inv-grid-container {
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.3) rgba(255, 255, 255, 0.1);
    /* Clip items that extend beyond the grid */
    position: relative;
  }

  .inv-grid-container::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  .inv-grid-container::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.05);
  }

  .inv-grid-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
  }

  .inv-grid-container::-webkit-scrollbar-corner {
    background: transparent;
  }

  .inv-grid {
    display: grid;
    padding: 0;
    gap: 0;
    width: fit-content;
  }

  .inv-slot {
    background: rgba(35, 35, 40, 0.9);
    border-radius: 2px;
    border: 1px solid rgba(60, 60, 65, 0.8);
    position: relative;
    flex-shrink: 0;
  }

  .inv-item {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 10;
    background: rgba(45, 45, 50, 0.95);
    border-radius: 2px;
    border: 1px solid rgba(70, 70, 75, 0.9);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .inv-item:hover {
    border-color: rgba(100, 100, 105, 1);
    background: rgba(55, 55, 60, 0.98);
  }

  .inv-item-top {
    position: absolute;
    top: 4px;
    left: 6px;
    right: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    pointer-events: none;
    z-index: 11;
  }

  .inv-item-weight {
    font-size: 11px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
  }

  .inv-item-qty {
    font-size: 11px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
  }

  .inv-item-durability {
    position: absolute;
    bottom: 4px;
    left: 6px;
    right: 6px;
    height: 4px;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 2px;
    overflow: hidden;
    z-index: 11;
  }

  .inv-item-durability-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.2s ease;
  }

  /* Weight Bar - Exact match to reference */
  .inv-weight-bar {
    padding: 0;
    background: rgba(20, 20, 22, 0.95);
  }

  .inv-weight-bar-track {
    position: relative;
    height: 24px;
    background: rgba(30, 30, 35, 0.9);
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid rgba(60, 60, 65, 0.6);
  }

  .inv-weight-bar-fill {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: linear-gradient(90deg, #22c55e 0%, #4ade80 100%);
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .inv-weight-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 12px;
    font-weight: 600;
    color: white;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
    white-space: nowrap;
    z-index: 1;
  }

  /* Hotbar toggle button (3 dots) */
  .inv-hotbar-toggle {
    position: absolute;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    display: flex;
    flex-direction: row;
    gap: 3px;
    padding: 2px 8px;
    cursor: pointer;
    border-radius: 4px 4px 0 0;
    background: rgba(0, 0, 0, 0.3);
    transition: all 0.15s ease;
  }

  .inv-hotbar-toggle:hover {
    background: rgba(0, 0, 0, 0.5);
  }

  .inv-hotbar-toggle:hover .inv-hotbar-dot {
    background: rgba(255, 255, 255, 0.9);
  }

  .inv-hotbar-toggle-expanded .inv-hotbar-dot {
    background: #22c55e;
  }

  .inv-hotbar-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.5);
    transition: background 0.15s ease;
  }

</style>
