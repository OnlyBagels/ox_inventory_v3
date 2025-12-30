<script lang="ts">
  import { shopState } from '$lib/state/shop.svelte';
  import CartItem from './CartItem.svelte';
  import PaymentSelector from './PaymentSelector.svelte';
  import SellButton from './SellButton.svelte';

  interface Props {
    onPurchase: () => void;
  }

  let { onPurchase }: Props = $props();

  function formatWeight(weight: number): string {
    return (weight / 1000).toFixed(2) + ' kg';
  }

  const isBuyShop = $derived(shopState.shop?.isBuyShop ?? false);
  const weightAfterPurchase = $derived(shopState.playerData.weight + shopState.cartWeight);
  const weightPercent = $derived(
    Math.min(100, (weightAfterPurchase / shopState.playerData.maxWeight) * 100)
  );
</script>

<div class="cart-container">
  <div class="cart-header">
    <span class="cart-title">
      {#if isBuyShop}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="cart-icon">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/>
        </svg>
        Sell Items
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="cart-icon">
          <path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/>
        </svg>
        Cart
      {/if}
    </span>
    {#if shopState.cartItemCount > 0}
      <span class="cart-count">{shopState.cartItemCount}</span>
    {/if}
  </div>

  <div class="cart-items">
    {#if shopState.cartItems.length === 0}
      <div class="empty-cart">
        {#if isBuyShop}
          <p>Click items to add them for sale</p>
        {:else}
          <p>Click items to add them to cart</p>
        {/if}
      </div>
    {:else}
      {#each shopState.cartItems as item (item.id)}
        <CartItem {item} />
      {/each}
    {/if}
  </div>

  {#if !isBuyShop}
    <div class="weight-section">
      <div class="weight-info">
        <span>Weight:</span>
        <span class="weight-value" class:overweight={shopState.isOverweight}>
          {formatWeight(weightAfterPurchase)} / {formatWeight(shopState.playerData.maxWeight)}
        </span>
      </div>
      <div class="weight-bar">
        <div
          class="weight-fill"
          class:overweight={shopState.isOverweight}
          style="width: {weightPercent}%"
        ></div>
      </div>
    </div>
  {/if}

  <div class="cart-footer">
    {#if isBuyShop}
      <SellButton onSell={onPurchase} />
    {:else}
      <PaymentSelector {onPurchase} />
    {/if}
  </div>
</div>

<style>
  .cart-container {
    display: flex;
    flex-direction: column;
    width: 280px;
    min-width: 280px;
    background: rgba(25, 25, 28, 0.95);
  }

  .cart-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(60, 60, 65, 0.6);
  }

  .cart-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
  }

  .cart-icon {
    width: 18px;
    height: 18px;
    color: #22c55e;
  }

  .cart-count {
    padding: 2px 8px;
    background: rgba(34, 197, 94, 0.2);
    border: 1px solid rgba(34, 197, 94, 0.4);
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    color: #22c55e;
  }

  .cart-items {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    overflow-y: auto;
  }

  .empty-cart {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 12px;
    text-align: center;
  }

  .weight-section {
    padding: 8px 12px;
    border-top: 1px solid rgba(60, 60, 65, 0.6);
  }

  .weight-info {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.6);
    margin-bottom: 4px;
  }

  .weight-value {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
  }

  .weight-value.overweight {
    color: #ef4444;
  }

  .weight-bar {
    height: 4px;
    background: rgba(60, 60, 65, 0.8);
    border-radius: 2px;
    overflow: hidden;
  }

  .weight-fill {
    height: 100%;
    background: linear-gradient(90deg, #22c55e 0%, #4ade80 100%);
    transition: width 0.3s ease;
  }

  .weight-fill.overweight {
    background: linear-gradient(90deg, #ef4444 0%, #f87171 100%);
  }

  .cart-footer {
    padding: 12px;
    border-top: 1px solid rgba(60, 60, 65, 0.6);
  }
</style>
