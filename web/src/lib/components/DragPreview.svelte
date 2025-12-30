<script lang="ts">
import type { DragItemType } from '$lib/state/inventory';
import ItemImage from '$lib/components/ItemImage.svelte';
import { cn } from '$lib/utils';

// Match the cell size from InventoryWindow
const CELL_SIZE = 75;
const GAP = 0;

interface Props {
  dragImg: HTMLElement;
  dropIndicator: HTMLElement;
  dragItem: DragItemType | null;
}

let { dragImg = $bindable(), dropIndicator = $bindable(), dragItem }: Props = $props();
let dragX = $state('');
let dragY = $state('');
const dragTransform = $derived(`translate(${dragX}px, ${dragY}px)`);
let visible = $state(false);
let left = $state(0);
let top = $state(0);

function findInventoryGrid(element: HTMLElement | null): HTMLElement | null {
  // Walk up the DOM to find the element with data-inventoryid
  while (element) {
    if (element.dataset?.inventoryid) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
}

function updateDragIndicator(event: MouseEvent) {
  if (!dragItem) return;

  dragX = `${event.clientX - dragImg.clientWidth / 2}`;
  dragY = `${event.clientY - dragImg.clientHeight / 2}`;

  // Find the inventory grid under the mouse
  const elementUnderMouse = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement;
  const inventoryGrid = findInventoryGrid(elementUnderMouse);

  if (!inventoryGrid) {
    visible = false;
    left = 0;
    top = 0;
    return;
  }

  const invRect = inventoryGrid.getBoundingClientRect();
  const mouseX = event.clientX - invRect.left;
  const mouseY = event.clientY - invRect.top;
  const slotWithGap = CELL_SIZE + GAP;

  // No grid padding (was removed)
  const gridPadding = 0;
  const adjustedMouseX = mouseX - gridPadding;
  const adjustedMouseY = mouseY - gridPadding;

  const itemWidth = dragItem.width * CELL_SIZE + (dragItem.width - 1) * GAP;
  const itemHeight = dragItem.height * CELL_SIZE + (dragItem.height - 1) * GAP;

  // Calculate which slot the center of the item would be in
  const centerOffsetX = itemWidth / 2 - CELL_SIZE / 2;
  const centerOffsetY = itemHeight / 2 - CELL_SIZE / 2;

  const slotX = Math.max(
    0,
    Math.min(
      Math.floor((adjustedMouseX - centerOffsetX) / slotWithGap),
      Math.floor((invRect.width - gridPadding * 2) / slotWithGap) - dragItem.width
    ),
  );

  const slotY = Math.max(
    0,
    Math.min(
      Math.floor((adjustedMouseY - centerOffsetY) / slotWithGap),
      Math.floor((invRect.height - gridPadding * 2) / slotWithGap) - dragItem.height
    ),
  );

  left = invRect.left + slotX * slotWithGap + gridPadding;
  top = invRect.top + slotY * slotWithGap + gridPadding;
  visible = true;
}

window.addEventListener('mousemove', updateDragIndicator);

window.addEventListener('mousedown', (event: MouseEvent) => {
  if (!dragItem) return;
  updateDragIndicator(event);
});
</script>

{#if dragItem}
  {@const itemWidth = CELL_SIZE * dragItem.width + GAP * (dragItem.width - 1)}
  {@const itemHeight = CELL_SIZE * dragItem.height + GAP * (dragItem.height - 1)}

  <!-- Drop indicator -->
  <div
    class="absolute pointer-events-none z-[51] border-2 border-emerald-400/70 bg-emerald-500/25"
    bind:this={dropIndicator}
    style={`
    width: ${itemWidth}px;
    height: ${itemHeight}px;
    left: ${left}px;
    top: ${top}px;
    visibility: ${visible ? 'visible' : 'hidden'};
    border-radius: 2px;
  `}
  ></div>

  <!-- Drag preview -->
  <div
    bind:this={dragImg}
    class={cn(
      'absolute pointer-events-none top-0 z-[52] left-0',
      'bg-zinc-800/95 border border-zinc-600/80'
    )}
    style={`
      transform: ${dragTransform};
      width: ${itemWidth}px;
      height: ${itemHeight}px;
      border-radius: 2px;
    `}
  >
    <ItemImage width={dragItem.width} height={dragItem.height} icon={dragItem.icon} rotate={dragItem.rotate} />
  </div>
{/if}
