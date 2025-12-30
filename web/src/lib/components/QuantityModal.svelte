<script lang="ts">
interface Props {
  visible: boolean;
  maxQuantity: number;
  onConfirm: (qty: number) => void;
  onCancel: () => void;
}

const { visible, maxQuantity, onConfirm, onCancel }: Props = $props();

let inputValue = $state('');

// Focus input when modal becomes visible
$effect(() => {
  if (visible) {
    inputValue = '';
    // Use setTimeout to ensure DOM is updated before focusing
    setTimeout(() => {
      const input = document.querySelector('.qty-input') as HTMLInputElement;
      if (input) input.focus();
    }, 0);
  }
});

function handleSubmit() {
  const qty = parseInt(inputValue, 10);
  if (isNaN(qty) || qty < 1) {
    onConfirm(1);
  } else if (qty > maxQuantity) {
    onConfirm(maxQuantity);
  } else {
    onConfirm(qty);
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    handleSubmit();
  } else if (e.key === 'Escape') {
    onCancel();
  }
}

function handleInput(e: Event) {
  const target = e.target as HTMLInputElement;
  // Only allow numbers
  inputValue = target.value.replace(/[^0-9]/g, '');
}
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal-overlay" onclick={onCancel}>
    <div class="modal-content" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">Enter Quantity</div>
      <div class="modal-body">
        <input
          type="text"
          class="qty-input"
          placeholder="1"
          value={inputValue}
          oninput={handleInput}
          onkeydown={handleKeyDown}
          maxlength="6"
        />
        <span class="max-qty">Max: {maxQuantity}</span>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-cancel" onclick={onCancel}>Cancel</button>
        <button type="button" class="btn btn-confirm" onclick={handleSubmit}>Confirm</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal-content {
    background: rgba(20, 20, 22, 0.98);
    border: 1px solid rgba(60, 60, 65, 0.8);
    border-radius: 4px;
    padding: 16px;
    min-width: 200px;
  }

  .modal-header {
    font-size: 14px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    margin-bottom: 12px;
    text-align: center;
  }

  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .qty-input {
    width: 100%;
    padding: 10px 12px;
    background: rgba(35, 35, 40, 0.9);
    border: 1px solid rgba(60, 60, 65, 0.8);
    border-radius: 2px;
    color: white;
    font-size: 16px;
    text-align: center;
    outline: none;
  }

  .qty-input:focus {
    border-color: rgba(100, 100, 105, 1);
  }

  .qty-input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  .max-qty {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
    text-align: center;
  }

  .modal-actions {
    display: flex;
    gap: 8px;
    justify-content: center;
  }

  .btn {
    padding: 8px 16px;
    border-radius: 2px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    border: 1px solid transparent;
  }

  .btn-cancel {
    background: rgba(35, 35, 40, 0.9);
    border-color: rgba(60, 60, 65, 0.8);
    color: rgba(255, 255, 255, 0.7);
  }

  .btn-cancel:hover {
    background: rgba(50, 50, 55, 0.95);
    color: white;
  }

  .btn-confirm {
    background: rgba(34, 197, 94, 0.8);
    color: white;
  }

  .btn-confirm:hover {
    background: rgba(34, 197, 94, 1);
  }
</style>
