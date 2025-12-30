<script lang="ts">
  import { shopState } from '$lib/state/shop.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  function formatMoney(amount: number): string {
    return '$' + amount.toLocaleString();
  }
</script>

<div class="shop-header">
  <div class="shop-title">
    <span class="shop-name">{shopState.shop?.label ?? 'Shop'}</span>
    {#if shopState.shop?.isBuyShop}
      <span class="shop-type-badge sell">Sell Items</span>
    {/if}
  </div>

  <div class="player-funds">
    <div class="fund-item cash" title="Cash">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="fund-icon">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/>
      </svg>
      <span class="fund-amount">{formatMoney(shopState.playerData.cash)}</span>
    </div>

    <div class="fund-item bank" title="Bank">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="fund-icon">
        <path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/>
      </svg>
      <span class="fund-amount">{formatMoney(shopState.playerData.bank)}</span>
    </div>

    {#if shopState.playerData.dirtyMoney > 0}
      <div class="fund-item dirty" title="Dirty Money">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="fund-icon">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
        <span class="fund-amount">{formatMoney(shopState.playerData.dirtyMoney)}</span>
      </div>
    {/if}
  </div>

  <button class="close-btn" onclick={onClose} title="Close">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
    </svg>
  </button>
</div>

<style>
  .shop-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: rgba(30, 30, 35, 0.95);
    border-bottom: 1px solid rgba(60, 60, 65, 0.8);
  }

  .shop-title {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .shop-name {
    font-size: 18px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.95);
  }

  .shop-type-badge {
    padding: 3px 8px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .shop-type-badge.sell {
    background: rgba(34, 197, 94, 0.2);
    color: #22c55e;
    border: 1px solid rgba(34, 197, 94, 0.4);
  }

  .player-funds {
    display: flex;
    gap: 16px;
  }

  .fund-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 4px;
    background: rgba(40, 40, 45, 0.8);
  }

  .fund-icon {
    width: 16px;
    height: 16px;
  }

  .fund-amount {
    font-size: 13px;
    font-weight: 600;
  }

  .fund-item.cash {
    color: #22c55e;
  }

  .fund-item.bank {
    color: #3b82f6;
  }

  .fund-item.dirty {
    color: #ef4444;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: rgba(60, 60, 65, 0.6);
    border: 1px solid rgba(80, 80, 85, 0.6);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .close-btn:hover {
    background: rgba(239, 68, 68, 0.3);
    border-color: rgba(239, 68, 68, 0.5);
    color: #ef4444;
  }

  .close-btn svg {
    width: 18px;
    height: 18px;
  }
</style>
