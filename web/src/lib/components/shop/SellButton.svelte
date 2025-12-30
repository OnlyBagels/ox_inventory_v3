<script lang="ts">
  import { shopState } from '$lib/state/shop.svelte';

  interface Props {
    onSell: () => void;
  }

  let { onSell }: Props = $props();

  function formatMoney(amount: number): string {
    return '$' + amount.toLocaleString();
  }

  const hasStolenItems = $derived(shopState.cartItems.some((i) => i.isStolen));
  const hasCleanItems = $derived(shopState.cartItems.some((i) => !i.isStolen));

  const stolenTotal = $derived(
    shopState.cartItems
      .filter((i) => i.isStolen)
      .reduce((sum, i) => sum + i.price * i.quantity, 0)
  );

  const cleanTotal = $derived(
    shopState.cartItems
      .filter((i) => !i.isStolen)
      .reduce((sum, i) => sum + i.price * i.quantity, 0)
  );
</script>

<div class="sell-section">
  {#if shopState.cartItems.length > 0}
    <div class="sell-summary">
      {#if hasCleanItems}
        <div class="summary-row">
          <span class="summary-label">Cash:</span>
          <span class="summary-value cash">{formatMoney(cleanTotal)}</span>
        </div>
      {/if}
      {#if hasStolenItems}
        <div class="summary-row">
          <span class="summary-label">Dirty Money:</span>
          <span class="summary-value dirty">{formatMoney(stolenTotal)}</span>
        </div>
      {/if}
    </div>
  {/if}

  <button
    class="sell-btn"
    onclick={onSell}
    disabled={shopState.isCartEmpty || shopState.isProcessing}
  >
    {#if shopState.isProcessing}
      <span>Processing...</span>
    {:else if shopState.isCartEmpty}
      <span>Select Items to Sell</span>
    {:else}
      <span>Sell for {formatMoney(shopState.cartValue)}</span>
    {/if}
  </button>
</div>

<style>
  .sell-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .sell-summary {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    background: rgba(30, 30, 35, 0.9);
    border-radius: 4px;
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
  }

  .summary-label {
    color: rgba(255, 255, 255, 0.6);
  }

  .summary-value {
    font-weight: 600;
  }

  .summary-value.cash {
    color: #22c55e;
  }

  .summary-value.dirty {
    color: #ef4444;
  }

  .sell-btn {
    padding: 12px;
    background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
    border: none;
    border-radius: 4px;
    color: white;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .sell-btn:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .sell-btn:disabled {
    background: rgba(60, 60, 65, 0.8);
    color: rgba(255, 255, 255, 0.4);
    cursor: not-allowed;
  }
</style>
