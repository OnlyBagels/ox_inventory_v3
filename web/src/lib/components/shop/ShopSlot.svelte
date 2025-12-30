<script lang="ts">
  import type { ShopItem } from '$lib/state/shop.svelte';
  import { shopState } from '$lib/state/shop.svelte';

  interface Props {
    item: ShopItem;
    isBuyShop: boolean;
    cellSize?: number;
  }

  let { item, isBuyShop, cellSize = 75 }: Props = $props();

  // Get item dimensions (default to 1x1)
  const itemWidth = $derived(item.width ?? 1);
  const itemHeight = $derived(item.height ?? 1);

  // Calculate pixel dimensions
  const slotWidth = $derived(itemWidth * cellSize);
  const slotHeight = $derived(itemHeight * cellSize);

  // Format price
  function formatPrice(price: number): string {
    return '$' + price.toLocaleString();
  }

  // Handle click to add to cart
  function handleClick() {
    if (item.isLocked) return;
    shopState.addToCart(item, 1);
  }

  const displayPrice = $derived(isBuyShop ? (item.buyPrice ?? item.price) : item.price);
  const displayStock = $derived(isBuyShop ? item.playerQuantity : item.count);
</script>

<button
  class="shop-slot"
  class:locked={item.isLocked}
  onclick={handleClick}
  disabled={item.isLocked}
  title={item.isLocked ? item.lockReason : `${item.label} - ${formatPrice(displayPrice)}`}
  style={`width: ${slotWidth}px; height: ${slotHeight}px; grid-column: span ${itemWidth}; grid-row: span ${itemHeight};`}
>
  <!-- Item image -->
  <div class="slot-image">
    <img
      src={item.imagePath}
      alt={item.label}
      onerror={(e) => {
        (e.target as HTMLImageElement).src = 'nui://ox_inventory/web/images/none.png';
      }}
    />
  </div>

  <!-- Top info: price and stock -->
  <div class="slot-top">
    <span class="slot-price">{formatPrice(displayPrice)}</span>
    {#if displayStock !== undefined && displayStock > 0}
      <span class="slot-stock">{displayStock}x</span>
    {/if}
  </div>

  <!-- Locked overlay -->
  {#if item.isLocked}
    <div class="locked-overlay">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="lock-icon">
        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
      </svg>
    </div>
  {/if}
</button>

<style>
  .shop-slot {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(35, 35, 40, 0.9);
    border: 1px solid rgba(60, 60, 65, 0.8);
    border-radius: 2px;
    cursor: pointer;
    padding: 0;
    overflow: hidden;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .shop-slot:hover:not(.locked) {
    background: rgba(45, 45, 50, 0.95);
    border-color: rgba(100, 100, 105, 1);
  }

  .shop-slot:active:not(.locked) {
    background: rgba(34, 197, 94, 0.15);
    border-color: rgba(34, 197, 94, 0.5);
  }

  .shop-slot.locked {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .slot-image {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 70%;
    height: 70%;
  }

  .slot-image img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .slot-top {
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

  .slot-price {
    font-size: 11px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
  }

  .slot-stock {
    font-size: 11px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
  }

  .locked-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    z-index: 12;
  }

  .lock-icon {
    width: 20px;
    height: 20px;
    color: rgba(255, 255, 255, 0.7);
  }
</style>
