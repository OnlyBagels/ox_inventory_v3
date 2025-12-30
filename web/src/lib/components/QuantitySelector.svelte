<script lang="ts">
interface Props {
  selectedQty: number;
  onSelect: (qty: number | 'half' | 'custom' | 'all') => void;
}

const { selectedQty, onSelect }: Props = $props();

const quantities = [
  { label: '1', value: 1 },
  { label: '10', value: 10 },
  { label: '100', value: 100 },
  { label: '½', value: 'half' as const },
  { label: 'X', value: 'custom' as const },
  { label: 'All', value: 'all' as const },
];

function isSelected(value: number | 'half' | 'custom' | 'all'): boolean {
  if (typeof value === 'number') {
    return selectedQty === value;
  }
  return false;
}
</script>

<div class="qty-panel">
  <div class="qty-header">QTY</div>
  {#each quantities as { label, value }}
    <button
      type="button"
      class="qty-btn"
      class:active={isSelected(value)}
      onclick={() => onSelect(value)}
    >
      {label}
    </button>
  {/each}
</div>

<style>
  .qty-panel {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 8px 8px 8px;
    background: rgba(20, 20, 22, 0.95);
    border-radius: 4px 0 0 4px;
    min-width: 48px;
  }

  .qty-header {
    font-size: 11px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.6);
    text-align: center;
    padding: 4px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    margin-bottom: 4px;
  }

  .qty-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: rgba(35, 35, 40, 0.9);
    border: 1px solid rgba(60, 60, 65, 0.8);
    border-radius: 2px;
    color: rgba(255, 255, 255, 0.8);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .qty-btn:hover {
    background: rgba(50, 50, 55, 0.95);
    border-color: rgba(80, 80, 85, 0.9);
    color: white;
  }

  .qty-btn.active {
    background: rgba(60, 60, 65, 0.95);
    border-color: rgba(100, 100, 105, 1);
    color: white;
  }
</style>
