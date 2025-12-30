<script lang="ts">
  import { shopState } from '$lib/state/shop.svelte';
  import { draggableShop, resetShopDrag } from '$lib/actions/draggableShop';
  import { fetchNui } from '$lib/utils/fetchNui';
  import ShopSlot from './ShopSlot.svelte';
  import Icon from '@iconify/svelte';

  const CELL_SIZE = 75;
  const GRID_COLS = 9;
  const GRID_ROWS = 5;
  const CART_WIDTH = 150; // Exactly 2 cells wide (2 x 75px)
  const CART_HEIGHT = 375; // Exactly 5 cells tall (5 x 75px)

  function handleClose() {
    fetchNui('shop:close');
    shopState.close();
    resetShopDrag();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      handleClose();
    }
  }

  // Format currency
  function formatMoney(amount: number): string {
    return '$' + amount.toLocaleString();
  }

  // Format weight
  function formatWeight(weight: number): string {
    return (weight / 1000).toFixed(2) + 'kg';
  }

  // Calculate grid dimensions
  const gridWidth = GRID_COLS * CELL_SIZE;
  const gridHeight = GRID_ROWS * CELL_SIZE;
  const totalWidth = gridWidth + CART_WIDTH + 12; // +12 for drag handles

  // Derived values
  const isBuyShop = $derived(shopState.shop?.isBuyShop ?? false);
  const shopLabel = $derived(shopState.shop?.label ?? 'Shop');
  const cartTotal = $derived(shopState.cartValue);
  const cartWeight = $derived(shopState.cartWeight);
  const cartItems = $derived(shopState.cartItems);
  const playerCash = $derived(shopState.playerData?.cash ?? 0);
  const playerBank = $derived(shopState.playerData?.bank ?? 0);
  const playerWeight = $derived(shopState.playerData?.weight ?? 0);
  const maxWeight = $derived(shopState.playerData?.maxWeight ?? 50000);

  // Check affordability
  const canAffordCash = $derived(cartTotal <= playerCash);
  const canAffordCard = $derived(cartTotal <= playerBank);
  const isOverweight = $derived(playerWeight + cartWeight > maxWeight);

  // Handle payment
  async function handlePayment(currency: 'cash' | 'card' | 'dirty_money') {
    if (cartItems.length === 0 || isOverweight) return;

    if (currency === 'cash' && !canAffordCash) return;
    if (currency === 'card' && !canAffordCard) return;

    shopState.setProcessing(true);
    try {
      const result = await fetchNui('shop:purchase', {
        ...shopState.getRequestData(),
        currency,
      });

      if (result?.success) {
        shopState.clearCart();
        await fetchNui('shop:refreshStock');
      }
    } catch (error) {
      console.error('Payment failed:', error);
    } finally {
      shopState.setProcessing(false);
    }
  }

  // Handle sell (for buy shops)
  async function handleSell() {
    if (cartItems.length === 0) return;

    shopState.setProcessing(true);
    try {
      const result = await fetchNui('shop:sell', shopState.getRequestData());

      if (result?.success) {
        shopState.clearCart();
        await fetchNui('shop:refreshStock');
      }
    } catch (error) {
      console.error('Sell failed:', error);
    } finally {
      shopState.setProcessing(false);
    }
  }

  // Remove item from cart
  function removeFromCart(itemId: number) {
    shopState.removeFromCart(itemId);
  }

  // Update cart item quantity
  function updateQuantity(itemId: number, newQty: number) {
    if (newQty < 1) {
      shopState.removeFromCart(itemId);
    } else {
      shopState.setCartItemQuantity(itemId, newQty);
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if shopState.isOpen}
  <div class="shop-wrapper" id="shop-window">
    <div class="shop-container" style={`width: ${totalWidth}px;`}>
      <!-- Drag handle border (top) -->
      <div class="shop-drag-handle shop-drag-handle-top" use:draggableShop={{ containerId: 'shop-window' }}></div>

      <!-- Main content wrapper with side drag handles -->
      <div class="shop-content-wrapper">
        <!-- Drag handle border (left) -->
        <div class="shop-drag-handle shop-drag-handle-left" use:draggableShop={{ containerId: 'shop-window' }}></div>

        <div class="shop-inner-content">
          <!-- Header -->
          <div class="shop-header" use:draggableShop={{ containerId: 'shop-window' }}>
            <span class="shop-title">
              {shopLabel}
              {#if isBuyShop}
                <span class="shop-type-badge sell">SELL</span>
              {:else}
                <span class="shop-type-badge buy">BUY</span>
              {/if}
            </span>
            <button type="button" class="shop-close-btn" onclick={handleClose}>
              <Icon icon="material-symbols:close" width={16} height={16} />
            </button>
          </div>

          <!-- Category tabs -->
          {#if shopState.categories.length > 1}
            <div class="category-tabs">
              {#each shopState.categories as category}
                <button
                  class="category-tab"
                  class:active={shopState.selectedCategory === category}
                  onclick={() => shopState.selectCategory(category)}
                >
                  {category}
                </button>
              {/each}
            </div>
          {/if}

          <!-- Main area: Grid + Cart -->
          <div class="shop-main">
            <!-- Grid Container -->
            <div
              class="shop-grid-container"
              style={`width: ${gridWidth}px; height: ${gridHeight}px;`}
            >
              <div
                class="shop-grid"
                style={`grid-template-columns: repeat(${GRID_COLS}, ${CELL_SIZE}px);`}
              >
                {#if shopState.filteredItems.length === 0}
                  <div class="empty-state" style={`grid-column: span ${GRID_COLS};`}>
                    <p>No items available</p>
                  </div>
                {:else}
                  {#each shopState.filteredItems as item (item.id)}
                    <ShopSlot {item} {isBuyShop} cellSize={CELL_SIZE} />
                  {/each}
                {/if}
              </div>
            </div>

            <!-- Cart Panel (2x5 grid cells = 150x375) -->
            <div class="cart-panel" style={`width: ${CART_WIDTH}px; height: ${CART_HEIGHT}px;`}>
              <!-- Cart Header -->
              <div class="cart-header">
                <div class="cart-header-left">
                  <Icon icon={isBuyShop ? "mdi:hand-coin" : "mdi:cart"} width={14} height={14} />
                  <span class="cart-title">{isBuyShop ? 'Sell' : 'Cart'}</span>
                </div>
                {#if cartItems.length > 0}
                  <div class="cart-total-display">
                    <span class="cart-total-label">{isBuyShop ? 'Payout:' : 'Total:'}</span>
                    <span class="cart-total-value">{cartTotal === 0 ? 'FREE' : formatMoney(cartTotal)}</span>
                  </div>
                {/if}
              </div>

              <!-- Cart Items -->
              <div class="cart-items">
                {#if cartItems.length === 0}
                  <div class="cart-empty">
                    <Icon icon="mdi:emoticon-sad-outline" width={24} height={24} />
                    <span>{isBuyShop ? 'No items to sell' : 'Cart is empty'}</span>
                  </div>
                {:else}
                  {#each cartItems as item (item.id)}
                    <div class="cart-item">
                      <div class="cart-item-row">
                        <span class="cart-item-name">{item.label}</span>
                        <div class="cart-item-right">
                          <span class="cart-item-price">{formatMoney(item.price * item.quantity)}</span>
                          <div class="cart-item-controls">
                            <input
                              type="number"
                              class="qty-input"
                              value={item.quantity}
                              min="1"
                              max={item.maxQuantity ?? 999}
                              onchange={(e) => updateQuantity(item.id, parseInt((e.target as HTMLInputElement).value) || 1)}
                            />
                            <button class="remove-btn" onclick={() => removeFromCart(item.id)}>
                              <Icon icon="mdi:close" width={12} height={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  {/each}
                {/if}
              </div>

              <!-- Cart Footer -->
              <div class="cart-footer">
                {#if isBuyShop}
                  <!-- Sell Button -->
                  <button
                    class="sell-btn"
                    class:disabled={cartItems.length === 0 || shopState.isProcessing}
                    onclick={handleSell}
                    disabled={cartItems.length === 0 || shopState.isProcessing}
                  >
                    {#if shopState.isProcessing}
                      <Icon icon="mdi:loading" width={14} height={14} class="animate-spin" />
                      Processing...
                    {:else}
                      <Icon icon="mdi:hand-coin" width={14} height={14} />
                      Sell for {formatMoney(cartTotal)}
                    {/if}
                  </button>
                {:else}
                  <!-- Payment Buttons -->
                  <div class="payment-buttons">
                    <button
                      class="pay-btn cash"
                      class:disabled={!canAffordCash || cartItems.length === 0 || isOverweight || shopState.isProcessing}
                      onclick={() => handlePayment('cash')}
                      disabled={!canAffordCash || cartItems.length === 0 || isOverweight || shopState.isProcessing}
                      title={!canAffordCash ? "Not enough cash" : isOverweight ? "Too heavy" : "Pay with Cash"}
                    >
                      <Icon icon="mdi:cash" width={16} height={16} />
                    </button>
                    <button
                      class="pay-btn card"
                      class:disabled={!canAffordCard || cartItems.length === 0 || isOverweight || shopState.isProcessing}
                      onclick={() => handlePayment('card')}
                      disabled={!canAffordCard || cartItems.length === 0 || isOverweight || shopState.isProcessing}
                      title={!canAffordCard ? "Not enough in bank" : isOverweight ? "Too heavy" : "Pay with Card"}
                    >
                      <Icon icon="mdi:credit-card" width={16} height={16} />
                    </button>
                  </div>
                {/if}

                <!-- Weight Display -->
                <div class="weight-display">
                  <Icon icon="mdi:weight" width={12} height={12} />
                  <span>{formatWeight(playerWeight)}</span>
                  {#if cartWeight > 0}
                    <span class="weight-add">+ {formatWeight(cartWeight)}</span>
                  {/if}
                  <span>/ {formatWeight(maxWeight)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Drag handle border (right) -->
        <div class="shop-drag-handle shop-drag-handle-right" use:draggableShop={{ containerId: 'shop-window' }}></div>
      </div>

      <!-- Bottom drag handle -->
      <div class="shop-drag-handle shop-drag-handle-bottom" use:draggableShop={{ containerId: 'shop-window' }}></div>
    </div>
  </div>
{/if}

<style>
  .shop-wrapper {
    position: fixed;
    top: 50%;
    right: 15%;
    transform: translateY(-50%);
    z-index: 50;
  }

  .shop-container {
    display: flex;
    flex-direction: column;
    background: rgba(20, 20, 22, 0.95);
    border-radius: 4px;
    overflow: hidden;
    isolation: isolate;
  }

  .shop-content-wrapper {
    display: flex;
    flex-direction: row;
  }

  .shop-inner-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  .shop-drag-handle {
    background: rgba(60, 60, 65, 0.6);
    cursor: move;
    transition: background 0.15s ease;
  }

  .shop-drag-handle:hover {
    background: rgba(80, 80, 85, 0.8);
  }

  .shop-drag-handle-top,
  .shop-drag-handle-bottom {
    height: 6px;
    width: 100%;
  }

  .shop-drag-handle-left,
  .shop-drag-handle-right {
    width: 6px;
    flex-shrink: 0;
  }

  .shop-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.4);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    cursor: move;
  }

  .shop-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
  }

  .shop-type-badge {
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .shop-type-badge.buy {
    background: rgba(34, 197, 94, 0.2);
    color: #22c55e;
  }

  .shop-type-badge.sell {
    background: rgba(59, 130, 246, 0.2);
    color: #3b82f6;
  }

  .shop-close-btn {
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
    border: none;
  }

  .shop-close-btn:hover {
    background: rgba(239, 68, 68, 0.8);
    color: white;
  }

  .category-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 8px;
    background: transparent;
    border-bottom: 1px solid rgba(60, 60, 65, 0.6);
  }

  .category-tab {
    padding: 4px 10px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .category-tab:hover {
    color: rgba(255, 255, 255, 1);
  }

  .category-tab.active {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 1);
  }

  .shop-main {
    display: flex;
    flex-direction: row;
  }

  .shop-grid-container {
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.3) rgba(255, 255, 255, 0.1);
    position: relative;
  }

  .shop-grid-container::-webkit-scrollbar {
    width: 6px;
  }

  .shop-grid-container::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.05);
  }

  .shop-grid-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
  }

  .shop-grid {
    display: grid;
    padding: 0;
    gap: 0;
    width: fit-content;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 150px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
  }

  /* Cart Panel - matches inventory slot colors exactly */
  .cart-panel {
    display: flex;
    flex-direction: column;
    background: rgba(35, 35, 40, 0.9);
    border: 1px solid rgba(60, 60, 65, 0.8);
    border-radius: 2px;
    box-sizing: border-box;
    flex-shrink: 0;
  }

  .cart-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    border-bottom: 1px solid rgba(60, 60, 65, 0.8);
    background: rgba(25, 25, 28, 0.6);
  }

  .cart-header-left {
    display: flex;
    align-items: center;
    gap: 6px;
    color: rgba(255, 255, 255, 0.6);
  }

  .cart-title {
    font-size: 11px;
    font-weight: 500;
  }

  .cart-total-display {
    font-size: 10px;
  }

  .cart-total-label {
    color: rgba(255, 255, 255, 0.6);
  }

  .cart-total-value {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    margin-left: 2px;
  }

  .cart-items {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }

  .cart-items::-webkit-scrollbar {
    width: 4px;
  }

  .cart-items::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
  }

  .cart-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: rgba(255, 255, 255, 0.3);
    gap: 8px;
    font-size: 11px;
  }

  .cart-item {
    background: rgba(25, 25, 28, 0.8);
    border: 1px solid rgba(60, 60, 65, 0.6);
    border-radius: 2px;
    padding: 6px;
  }

  .cart-item-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }

  .cart-item-name {
    font-size: 10px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cart-item-right {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .cart-item-price {
    font-size: 10px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.6);
  }

  .cart-item-controls {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .qty-input {
    width: 32px;
    height: 20px;
    background: rgba(35, 35, 40, 0.9);
    border: 1px solid rgba(60, 60, 65, 0.6);
    border-radius: 2px;
    color: rgba(255, 255, 255, 0.9);
    font-size: 10px;
    text-align: center;
    padding: 0 2px;
  }

  .qty-input:focus {
    outline: none;
    border-color: rgba(100, 100, 105, 0.6);
  }

  .remove-btn {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 2px;
    color: #ef4444;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .remove-btn:hover {
    background: rgba(239, 68, 68, 0.4);
  }

  .cart-footer {
    padding: 0;
    border-top: 1px solid rgba(60, 60, 65, 0.8);
    display: flex;
    flex-direction: column;
    gap: 0;
    background: rgba(25, 25, 28, 0.6);
  }

  .payment-buttons {
    display: flex;
    gap: 0;
  }

  .pay-btn {
    flex: 1;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .pay-btn.cash {
    background: rgba(34, 197, 94, 0.2);
    border: 1px solid rgba(34, 197, 94, 0.3);
    color: #22c55e;
    border-radius: 2px 0 0 2px;
  }

  .pay-btn.cash:hover:not(.disabled) {
    background: rgba(34, 197, 94, 0.4);
  }

  .pay-btn.card {
    background: rgba(59, 130, 246, 0.2);
    border: 1px solid rgba(59, 130, 246, 0.3);
    color: #3b82f6;
    border-radius: 0 2px 2px 0;
  }

  .pay-btn.card:hover:not(.disabled) {
    background: rgba(59, 130, 246, 0.4);
  }

  .pay-btn.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .sell-btn {
    width: 100%;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    background: rgba(34, 197, 94, 0.2);
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 2px;
    color: #22c55e;
    font-size: 10px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .sell-btn:hover:not(.disabled) {
    background: rgba(34, 197, 94, 0.4);
  }

  .sell-btn.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .weight-display {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 4px 0;
    background: rgba(35, 35, 40, 0.9);
    border: none;
    border-radius: 0;
    font-size: 9px;
    color: rgba(255, 255, 255, 0.6);
  }

  .weight-add {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  :global(.animate-spin) {
    animation: spin 1s linear infinite;
  }
</style>
