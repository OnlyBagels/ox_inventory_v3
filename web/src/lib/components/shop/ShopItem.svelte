<script lang="ts">
  import type { ShopItem } from '$lib/state/shop.svelte';
  import { shopState } from '$lib/state/shop.svelte';

  interface Props {
    item: ShopItem;
  }

  let { item }: Props = $props();

  function handleClick() {
    if (!item.isLocked) {
      shopState.addToCart(item, 1);
    }
  }

  function formatPrice(price: number): string {
    return '$' + price.toLocaleString();
  }

  const isBuyShop = $derived(shopState.shop?.isBuyShop ?? false);
  const displayPrice = $derived(isBuyShop ? (item.buyPrice ?? item.price) : item.price);
  const displayQuantity = $derived(isBuyShop ? item.playerQuantity : item.count);
</script>

<button
  class="shop-item"
  class:locked={item.isLocked}
  class:stolen={item.isStolen}
  onclick={handleClick}
  disabled={item.isLocked}
  title={item.isLocked ? item.lockReason : item.label}
>
  <div class="item-image">
    <img
      src={item.imagePath}
      alt={item.label}
      onerror={(e) => {
        (e.target as HTMLImageElement).src = 'nui://ox_inventory/web/images/none.png';
      }}
    />
    {#if item.isLocked}
      <div class="locked-overlay">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="lock-icon">
          <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
        </svg>
      </div>
    {/if}
  </div>

  <div class="item-info">
    <span class="item-price" class:buy-price={isBuyShop}>
      {formatPrice(displayPrice)}
    </span>
    {#if displayQuantity !== undefined}
      <span class="item-stock">x{displayQuantity}</span>
    {/if}
  </div>

  <div class="item-label">{item.label}</div>

  {#if item.isLocked && item.lockReason}
    <div class="lock-reason">{item.lockReason}</div>
  {/if}

  {#if item.isStolen}
    <div class="stolen-badge">Stolen</div>
  {/if}
</button>

<style>
  .shop-item {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 75px;
    height: 95px;
    background: rgba(35, 35, 40, 0.9);
    border: 1px solid rgba(60, 60, 65, 0.8);
    border-radius: 2px;
    cursor: pointer;
    transition: all 0.15s ease;
    padding: 0;
    overflow: hidden;
  }

  .shop-item:hover:not(.locked) {
    background: rgba(45, 45, 50, 0.95);
    border-color: rgba(100, 100, 105, 1);
    transform: translateY(-2px);
  }

  .shop-item.locked {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .shop-item.stolen {
    border-color: rgba(239, 68, 68, 0.4);
  }

  .item-image {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 55px;
    padding: 4px;
  }

  .item-image img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .locked-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
  }

  .lock-icon {
    width: 24px;
    height: 24px;
    color: rgba(255, 255, 255, 0.7);
  }

  .item-info {
    display: flex;
    justify-content: space-between;
    padding: 0 4px;
    font-size: 10px;
    font-weight: 600;
  }

  .item-price {
    color: rgba(255, 255, 255, 0.9);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  }

  .item-price.buy-price {
    color: #22c55e;
  }

  .item-stock {
    color: rgba(255, 255, 255, 0.6);
  }

  .item-label {
    padding: 2px 4px;
    font-size: 9px;
    color: rgba(255, 255, 255, 0.8);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lock-reason {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 2px 4px;
    background: rgba(239, 68, 68, 0.9);
    color: white;
    font-size: 8px;
    text-align: center;
    font-weight: 500;
  }

  .stolen-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    padding: 1px 4px;
    background: rgba(239, 68, 68, 0.9);
    color: white;
    font-size: 8px;
    font-weight: 600;
    border-radius: 2px;
  }
</style>
