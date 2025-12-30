<script lang="ts">
  import { shopState } from '$lib/state/shop.svelte';
  import ShopItem from './ShopItem.svelte';
</script>

<div class="shop-grid-container">
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

  <div class="items-grid">
    {#if shopState.filteredItems.length === 0}
      <div class="empty-state">
        {#if shopState.shop?.isBuyShop}
          <p>You don't have any items to sell here.</p>
        {:else}
          <p>No items available in this category.</p>
        {/if}
      </div>
    {:else}
      {#each shopState.filteredItems as item (item.id)}
        <ShopItem {item} />
      {/each}
    {/if}
  </div>
</div>

<style>
  .shop-grid-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    border-right: 1px solid rgba(60, 60, 65, 0.6);
  }

  .category-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px 12px;
    background: rgba(25, 25, 28, 0.95);
    border-bottom: 1px solid rgba(60, 60, 65, 0.6);
  }

  .category-tab {
    padding: 6px 12px;
    background: rgba(40, 40, 45, 0.8);
    border: 1px solid rgba(60, 60, 65, 0.6);
    border-radius: 3px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .category-tab:hover {
    background: rgba(50, 50, 55, 0.9);
    color: rgba(255, 255, 255, 0.9);
  }

  .category-tab.active {
    background: rgba(34, 197, 94, 0.2);
    border-color: rgba(34, 197, 94, 0.5);
    color: #22c55e;
  }

  .items-grid {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px;
    overflow-y: auto;
    align-content: flex-start;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 200px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 14px;
  }
</style>
