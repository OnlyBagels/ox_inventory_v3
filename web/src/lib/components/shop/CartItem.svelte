<script lang="ts">
  import type { CartItem } from '$lib/state/shop.svelte';
  import { shopState } from '$lib/state/shop.svelte';

  interface Props {
    item: CartItem;
  }

  let { item }: Props = $props();

  function formatPrice(price: number): string {
    return '$' + price.toLocaleString();
  }

  function handleQuantityChange(delta: number) {
    const newQty = item.quantity + delta;
    if (newQty <= 0) {
      shopState.removeFromCart(item.id);
    } else {
      shopState.setCartItemQuantity(item.id, newQty);
    }
  }

  function handleRemove() {
    shopState.removeFromCart(item.id);
  }

  const totalPrice = $derived(item.price * item.quantity);
</script>

<div class="cart-item" class:stolen={item.isStolen}>
  <div class="item-info">
    <span class="item-label">{item.label}</span>
    <span class="item-total">{formatPrice(totalPrice)}</span>
  </div>

  <div class="item-controls">
    <button class="qty-btn" onclick={() => handleQuantityChange(-1)} title="Decrease">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 13H5v-2h14v2z"/>
      </svg>
    </button>

    <span class="qty-value">{item.quantity}</span>

    <button
      class="qty-btn"
      onclick={() => handleQuantityChange(1)}
      disabled={item.maxQuantity !== undefined && item.quantity >= item.maxQuantity}
      title="Increase"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
      </svg>
    </button>

    <button class="remove-btn" onclick={handleRemove} title="Remove">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
    </button>
  </div>
</div>

<style>
  .cart-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: rgba(35, 35, 40, 0.9);
    border: 1px solid rgba(60, 60, 65, 0.8);
    border-radius: 3px;
  }

  .cart-item.stolen {
    border-color: rgba(239, 68, 68, 0.4);
  }

  .item-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .item-label {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.9);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }

  .item-total {
    font-size: 12px;
    font-weight: 600;
    color: #22c55e;
  }

  .item-controls {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .qty-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: rgba(50, 50, 55, 0.8);
    border: 1px solid rgba(70, 70, 75, 0.8);
    border-radius: 3px;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    transition: all 0.15s ease;
    padding: 0;
  }

  .qty-btn:hover:not(:disabled) {
    background: rgba(60, 60, 65, 0.9);
    color: white;
  }

  .qty-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .qty-btn svg {
    width: 14px;
    height: 14px;
  }

  .qty-value {
    min-width: 30px;
    text-align: center;
    font-size: 12px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
  }

  .remove-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    margin-left: auto;
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid rgba(239, 68, 68, 0.4);
    border-radius: 3px;
    color: #ef4444;
    cursor: pointer;
    transition: all 0.15s ease;
    padding: 0;
  }

  .remove-btn:hover {
    background: rgba(239, 68, 68, 0.3);
    border-color: rgba(239, 68, 68, 0.6);
  }

  .remove-btn svg {
    width: 14px;
    height: 14px;
  }
</style>
