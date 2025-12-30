<script lang="ts">
  import { shopState, type PaymentMethod } from '$lib/state/shop.svelte';

  interface Props {
    onPurchase: () => void;
  }

  let { onPurchase }: Props = $props();

  function formatMoney(amount: number): string {
    return '$' + amount.toLocaleString();
  }

  function selectPayment(method: PaymentMethod) {
    shopState.setPaymentMethod(method);
  }

  const isBlackmarket = $derived(
    shopState.shop?.id.toLowerCase().includes('blackmarket') ||
    shopState.items.some(i => i.currency === 'black_money')
  );
</script>

<div class="payment-selector">
  <div class="payment-label">Payment Method</div>

  <div class="payment-buttons">
    <button
      class="payment-btn cash"
      class:active={shopState.paymentMethod === 'cash'}
      class:disabled={!shopState.canAffordCash}
      onclick={() => selectPayment('cash')}
      disabled={!shopState.canAffordCash}
      title={shopState.canAffordCash ? 'Pay with cash' : 'Insufficient cash'}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="payment-icon">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/>
      </svg>
      <span>Cash</span>
    </button>

    <button
      class="payment-btn card"
      class:active={shopState.paymentMethod === 'card'}
      class:disabled={!shopState.canAffordCard}
      onclick={() => selectPayment('card')}
      disabled={!shopState.canAffordCard}
      title={shopState.canAffordCard ? 'Pay with card' : 'Insufficient bank balance'}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="payment-icon">
        <path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/>
      </svg>
      <span>Card</span>
    </button>

    {#if isBlackmarket}
      <button
        class="payment-btn dirty"
        class:active={shopState.paymentMethod === 'dirty_money'}
        class:disabled={!shopState.canAffordDirty}
        onclick={() => selectPayment('dirty_money')}
        disabled={!shopState.canAffordDirty}
        title={shopState.canAffordDirty ? 'Pay with dirty money' : 'Insufficient dirty money'}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="payment-icon">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
        <span>Dirty</span>
      </button>
    {/if}
  </div>

  <button
    class="purchase-btn"
    onclick={onPurchase}
    disabled={shopState.isCartEmpty || shopState.isProcessing || shopState.isOverweight ||
      (shopState.paymentMethod === 'cash' && !shopState.canAffordCash) ||
      (shopState.paymentMethod === 'card' && !shopState.canAffordCard) ||
      (shopState.paymentMethod === 'dirty_money' && !shopState.canAffordDirty)}
  >
    {#if shopState.isProcessing}
      <span>Processing...</span>
    {:else if shopState.isOverweight}
      <span>Overweight</span>
    {:else}
      <span>Purchase {formatMoney(shopState.cartValue)}</span>
    {/if}
  </button>
</div>

<style>
  .payment-selector {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .payment-label {
    font-size: 11px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.6);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .payment-buttons {
    display: flex;
    gap: 6px;
  }

  .payment-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 4px;
    background: rgba(40, 40, 45, 0.8);
    border: 2px solid rgba(60, 60, 65, 0.6);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .payment-btn:hover:not(:disabled) {
    background: rgba(50, 50, 55, 0.9);
  }

  .payment-btn.disabled,
  .payment-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .payment-btn.active.cash {
    background: rgba(34, 197, 94, 0.2);
    border-color: #22c55e;
    color: #22c55e;
  }

  .payment-btn.active.card {
    background: rgba(59, 130, 246, 0.2);
    border-color: #3b82f6;
    color: #3b82f6;
  }

  .payment-btn.active.dirty {
    background: rgba(239, 68, 68, 0.2);
    border-color: #ef4444;
    color: #ef4444;
  }

  .payment-icon {
    width: 18px;
    height: 18px;
  }

  .purchase-btn {
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

  .purchase-btn:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .purchase-btn:disabled {
    background: rgba(60, 60, 65, 0.8);
    color: rgba(255, 255, 255, 0.4);
    cursor: not-allowed;
  }
</style>
