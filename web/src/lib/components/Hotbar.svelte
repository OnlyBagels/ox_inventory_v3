<script lang="ts">
import { itemTooltip } from '$lib/actions/itemTooltip';
import { openContextMenu } from '$lib/actions/openContextMenu';
import ItemImage from '$lib/components/ItemImage.svelte';
import { cn } from '$lib/utils.js';
import type { InventoryItem } from '@common/item';
import type { DragItemType } from '$lib/state/inventory';

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
  slots: HotbarSlotConfig[];
  equippedSlotId: string | null;
  onSlotClick?: (slotId: string) => void;
  onMouseDown?: (event: MouseEvent) => void;
  isDragging?: boolean;
  dragItem?: DragItemType | null;
  inventoryId: string;
}

const { visible, slots, equippedSlotId, onSlotClick, onMouseDown, isDragging = false, dragItem = null, inventoryId }: Props = $props();

const CELL_SIZE = 75;
const GRID_COLS = 11; // 11 cols: PRIMARY(5) + SECONDARY(2) + MELEE(1) + BAG(1) + VEST(2)

// Get slots by id for specific layout
const primarySlot = $derived(slots.find(s => s.id === 'primary'));
const secondarySlot = $derived(slots.find(s => s.id === 'secondary'));
const meleeSlot = $derived(slots.find(s => s.id === 'melee'));
const bagSlot = $derived(slots.find(s => s.id === 'bag'));
const armorSlot = $derived(slots.find(s => s.id === 'armor'));
const utility1Slot = $derived(slots.find(s => s.id === 'utility1'));
const utility2Slot = $derived(slots.find(s => s.id === 'utility2'));

function getSlotDimensions(slot: HotbarSlotConfig) {
  return {
    width: slot.width * CELL_SIZE,
    height: slot.height * CELL_SIZE,
  };
}

function handleClick(slotId: string) {
  onSlotClick?.(slotId);
}

function handleMouseDown(event: MouseEvent) {
  // Stop propagation to prevent the drag handle from capturing this event
  event.stopPropagation();
  onMouseDown?.(event);
}

// Grid positions for each slot (column start, row start) - CSS grid is 1-indexed
// Layout (no gaps, 11 cols x 2 rows):
// Row 1: PRIMARY(cols 1-5) | SECONDARY(cols 6-7) | MELEE(col 8) | BAG(col 9) | VEST(cols 10-11)
// Row 2: PRIMARY(cont)     | UTIL1(col 6) | UTIL2(col 7) | MELEE(cont) | BAG(cont) | VEST(cont)
const gridPositions = {
  primary: { col: 1, row: 1 },
  secondary: { col: 6, row: 1 },
  melee: { col: 8, row: 1 },
  bag: { col: 9, row: 1 },
  armor: { col: 10, row: 1 },
  utility1: { col: 6, row: 2 },
  utility2: { col: 7, row: 2 },
};
</script>

{#snippet slotContent(slot: HotbarSlotConfig)}
  {@const dims = getSlotDimensions(slot)}
  {@const isEquipped = equippedSlotId === slot.id}
  {@const item = slot.item}
  {@const pos = gridPositions[slot.id as keyof typeof gridPositions]}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="hotbar-slot"
    class:hotbar-slot-equipped={isEquipped}
    style={`
      width: ${dims.width}px;
      height: ${dims.height}px;
      grid-column: ${pos.col} / span ${slot.width};
      grid-row: ${pos.row} / span ${slot.height};
    `}
    onclick={() => handleClick(slot.id)}
    data-slot={slot.slotIndex}
    onmousedown={handleMouseDown}
  >
    <!-- Keybind indicator (only show if keybind is set) -->
    {#if slot.keybind}
      <div class="hotbar-keybind">{slot.keybind}</div>
    {/if}

    <!-- Slot label -->
    <div class="hotbar-label">{slot.label}</div>

    {#if item}
      <!-- Use slot dimensions to scale items to fill the hotbar slot -->
      <div
        class={cn(
          'hotbar-item',
          isDragging && 'pointer-events-none',
          dragItem?.uniqueId === item.uniqueId && 'opacity-50 brightness-50 grayscale-[0.6]',
        )}
        style={`width: ${dims.width}px; height: ${dims.height}px;`}
        data-slot={slot.slotIndex}
        use:itemTooltip={{ item }}
        use:openContextMenu={{ itemId: item.uniqueId }}
      >
        <ItemImage
          width={slot.width}
          height={slot.height}
          icon={item.icon}
          rotate={item.rotate}
        />

        <!-- Quantity (if stackable) -->
        {#if item.quantity > 1}
          <span class="hotbar-item-qty">{item.quantity}x</span>
        {/if}

        <!-- Durability bar -->
        {#if item.durability !== undefined}
          <div class="hotbar-item-durability">
            <div
              class="hotbar-item-durability-fill"
              style={`width: ${item.durability}%; background: ${item.durability > 60 ? '#22c55e' : item.durability > 30 ? '#eab308' : '#ef4444'};`}
            ></div>
          </div>
        {/if}

        <!-- Ammo count for weapons -->
        {#if item.ammoCount !== undefined}
          <div class="hotbar-item-ammo">
            {item.ammoCount}
          </div>
        {/if}
      </div>
    {:else}
      <!-- Empty slot indicator based on type -->
      <div class="hotbar-empty-icon" style={`width: ${dims.width}px; height: ${dims.height}px;`}>
        {#if slot.id === 'primary'}
          <svg viewBox="0 0 24 24" fill="currentColor" class="hotbar-icon" style={`width: ${dims.width * 0.6}px; height: ${dims.height * 0.6}px;`}>
            <path d="M22 5.5L20.5 4L13 11.5V8H11V15H18V13H14.5L22 5.5ZM4 4H6V6H4V4ZM4 8H6V10H4V8ZM4 12H6V14H4V12ZM4 16H6V18H4V16ZM8 16H10V18H8V16ZM12 16H14V18H12V16Z"/>
          </svg>
        {:else if slot.id === 'secondary'}
          <svg viewBox="0 0 24 24" fill="currentColor" class="hotbar-icon">
            <path d="M7,5H23V9H22V10H16A1,1 0 0,0 15,11V12A2,2 0 0,1 13,14H9.62C9.24,14 8.89,14.22 8.72,14.56L6.27,19.45C6.1,19.79 5.76,20 5.38,20H2C1.45,20 1,19.55 1,19V18C1,17.45 1.45,17 2,17H4.62L7.5,11H15V10C15,9.45 15.45,9 16,9H20V7H7V5Z"/>
          </svg>
        {:else if slot.id === 'melee'}
          <svg viewBox="0 0 24 24" fill="currentColor" class="hotbar-icon">
            <path d="M6.92,5H5L14,14L15,13.06L6.92,5M19.06,3C19.17,3 19.28,3.04 19.36,3.13L20.87,4.64C21.05,4.82 21.05,5.12 20.87,5.3L19.41,6.76L17.24,4.59L18.7,3.13C18.78,3.05 18.91,3 19.06,3M17,5.3L18.7,7L9.83,15.87L8.13,14.17L17,5.3M5,20V18H3V20H5Z"/>
          </svg>
        {:else if slot.id === 'bag'}
          <svg viewBox="0 0 24 24" fill="currentColor" class="hotbar-icon hotbar-icon-large">
            <path d="M19,7H16V6A4,4 0 0,0 12,2A4,4 0 0,0 8,6V7H5A1,1 0 0,0 4,8V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8A1,1 0 0,0 19,7M10,6A2,2 0 0,1 12,4A2,2 0 0,1 14,6V7H10V6M18,20H6V9H18V20Z"/>
          </svg>
        {:else if slot.id === 'armor'}
          <svg viewBox="0 0 24 24" fill="currentColor" class="hotbar-icon hotbar-icon-large">
            <path d="M12,1L3,5V11C3,16.55 6.84,21.74 12,23C17.16,21.74 21,16.55 21,11V5L12,1M12,5A3,3 0 0,1 15,8A3,3 0 0,1 12,11A3,3 0 0,1 9,8A3,3 0 0,1 12,5M17.13,17C15.92,18.85 14.11,20.24 12,20.92C9.89,20.24 8.08,18.85 6.87,17C6.53,16.5 6.24,16 6,15.47C6,13.82 8.71,12.47 12,12.47C15.29,12.47 18,13.79 18,15.47C17.76,16 17.47,16.5 17.13,17Z"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="currentColor" class="hotbar-icon">
            <path d="M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4Z"/>
          </svg>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

{#if visible}
  <div class="hotbar-container">
    <!-- Hotbar uses CSS Grid matching inventory layout -->
    <div
      class="hotbar-grid"
      data-inventoryid={inventoryId}
      style={`grid-template-columns: repeat(${GRID_COLS}, ${CELL_SIZE}px); grid-template-rows: repeat(2, ${CELL_SIZE}px);`}
    >
      {#if primarySlot}
        {@render slotContent(primarySlot)}
      {/if}
      {#if secondarySlot}
        {@render slotContent(secondarySlot)}
      {/if}
      {#if meleeSlot}
        {@render slotContent(meleeSlot)}
      {/if}
      {#if utility1Slot}
        {@render slotContent(utility1Slot)}
      {/if}
      {#if utility2Slot}
        {@render slotContent(utility2Slot)}
      {/if}
      {#if bagSlot}
        {@render slotContent(bagSlot)}
      {/if}
      {#if armorSlot}
        {@render slotContent(armorSlot)}
      {/if}
    </div>
  </div>
{/if}

<style>
  .hotbar-container {
    display: flex;
    justify-content: flex-start;
    width: 100%;
    pointer-events: auto;
    flex: 1;
  }

  .hotbar-grid {
    display: grid;
    gap: 0;
    background: rgba(20, 20, 22, 0.95);
  }

  .hotbar-slot {
    position: relative;
    background: rgba(35, 35, 40, 0.9);
    border-radius: 2px;
    border: 1px solid rgba(60, 60, 65, 0.8);
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .hotbar-slot:hover {
    border-color: rgba(100, 100, 105, 1);
    background: rgba(45, 45, 50, 0.95);
  }

  .hotbar-slot-equipped {
    border-color: #22c55e !important;
    box-shadow: 0 0 12px rgba(34, 197, 94, 0.4);
  }

  .hotbar-keybind {
    position: absolute;
    top: 4px;
    left: 4px;
    background: rgba(0, 0, 0, 0.7);
    color: rgba(255, 255, 255, 0.9);
    font-size: 10px;
    font-weight: 700;
    padding: 2px 5px;
    border-radius: 3px;
    z-index: 20;
    text-transform: uppercase;
  }

  .hotbar-label {
    position: absolute;
    bottom: 4px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.6);
    color: rgba(255, 255, 255, 0.7);
    font-size: 9px;
    font-weight: 500;
    padding: 1px 4px;
    border-radius: 2px;
    z-index: 20;
    white-space: nowrap;
    text-transform: uppercase;
  }

  .hotbar-item {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    overflow: hidden;
  }

  .hotbar-item-qty {
    position: absolute;
    top: 4px;
    right: 4px;
    font-size: 11px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
    z-index: 15;
  }

  .hotbar-item-durability {
    position: absolute;
    bottom: 18px;
    left: 6px;
    right: 6px;
    height: 4px;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 2px;
    overflow: hidden;
    z-index: 15;
  }

  .hotbar-item-durability-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.2s ease;
  }

  .hotbar-item-ammo {
    position: absolute;
    bottom: 22px;
    right: 4px;
    background: rgba(0, 0, 0, 0.7);
    color: #fbbf24;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 2px;
    z-index: 15;
  }

  .hotbar-empty-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.3;
  }

  .hotbar-icon {
    width: 32px;
    height: 32px;
    color: rgba(255, 255, 255, 0.5);
  }

  .hotbar-icon-large {
    width: 48px;
    height: 48px;
  }
</style>
