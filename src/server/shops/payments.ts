import type { PaymentMethod } from './types';

/**
 * Payment configuration
 */
export const PaymentConfig = {
  // Resource name for banking
  bankingResource: 'eb-banking',
  // Dirty money item name in ox_inventory
  dirtyMoneyItem: 'black_money',
  // eb-banking export names (they use GetCashBalance/GetBankBalance, not GetCashMoney/GetBankMoney)
  ebBankingExports: {
    getCash: 'GetCashBalance',
    getBank: 'GetBankBalance',
    addCash: 'AddCashMoney',
    removeCash: 'RemoveCashMoney',
    addBank: 'AddBankMoney',
    removeBank: 'RemoveBankMoney',
  },
};

/**
 * Safely get banking export - returns null if not available
 */
function getBankingExport(): any {
  try {
    const resource = PaymentConfig.bankingResource;
    if (GetResourceState(resource) !== 'started') {
      return null;
    }
    return exports[resource];
  } catch {
    return null;
  }
}

/**
 * Get QBX player for money operations
 */
function getQBXPlayer(playerId: number): any {
  try {
    if (GetResourceState('qbx_core') === 'started') {
      return exports.qbx_core.GetPlayer(playerId);
    }
    if (GetResourceState('qb-core') === 'started') {
      const QBCore = exports['qb-core'].GetCoreObject();
      return QBCore?.Functions?.GetPlayer(playerId);
    }
  } catch {}
  return null;
}

/**
 * Check if player has sufficient funds for a payment method
 */
export async function checkFunds(
  playerId: number,
  amount: number,
  method: PaymentMethod,
  inventory: any
): Promise<{ hasFunds: boolean; available: number }> {
  const bankExport = getBankingExport();
  const qbxPlayer = getQBXPlayer(playerId);

  switch (method) {
    case 'cash': {
      let cash = 0;
      const invCash = inventory.getItemCount({ name: 'money' });

      // Try eb-banking first
      try {
        if (bankExport?.GetCashBalance) {
          cash = bankExport.GetCashBalance(playerId) || 0;
        }
      } catch {}

      // Try QBX player money
      if (cash === 0 && qbxPlayer?.Functions?.GetMoney) {
        cash = qbxPlayer.Functions.GetMoney('cash') || 0;
      }

      // Use the highest value (inventory is source of truth in v3)
      cash = Math.max(cash, invCash);
      return { hasFunds: cash >= amount, available: cash };
    }

    case 'card': {
      let bank = 0;
      const invBank = inventory.getItemCount({ name: 'bank' });

      // Try eb-banking first
      try {
        if (bankExport?.GetBankBalance) {
          bank = bankExport.GetBankBalance(playerId) || 0;
        }
      } catch {}

      // Try QBX player money
      if (bank === 0 && qbxPlayer?.Functions?.GetMoney) {
        bank = qbxPlayer.Functions.GetMoney('bank') || 0;
      }

      // Use the highest value (inventory is source of truth in v3)
      bank = Math.max(bank, invBank);
      return { hasFunds: bank >= amount, available: bank };
    }

    case 'dirty_money': {
      const dirtyMoney = inventory.getItemCount({ name: PaymentConfig.dirtyMoneyItem });
      return { hasFunds: dirtyMoney >= amount, available: dirtyMoney };
    }

    default:
      return { hasFunds: false, available: 0 };
  }
}

/**
 * Process a payment from the player
 */
export async function processPayment(
  playerId: number,
  amount: number,
  method: PaymentMethod,
  description: string,
  inventory: any
): Promise<{ success: boolean; error?: string }> {
  if (amount <= 0) {
    return { success: true };
  }

  const bankExport = getBankingExport();
  const qbxPlayer = getQBXPlayer(playerId);

  switch (method) {
    case 'cash': {
      // In v3, inventory is the source of truth - always remove from inventory
      const invCash = inventory.getItemCount({ name: 'money' });

      if (invCash >= amount) {
        // Remove from inventory (source of truth)
        const removed = inventory.removeItem({ name: 'money', quantity: amount });
        if (!removed) {
          return { success: false, error: 'insufficient_cash' };
        }
        return { success: true };
      }

      // Fallback: try eb-banking
      try {
        if (bankExport?.RemoveCashMoney) {
          const success = bankExport.RemoveCashMoney(playerId, amount);
          if (success) return { success: true };
        }
      } catch {}

      // Fallback: try QBX player money
      if (qbxPlayer?.Functions?.RemoveMoney) {
        const success = qbxPlayer.Functions.RemoveMoney('cash', amount, description);
        if (success) return { success: true };
      }

      return { success: false, error: 'insufficient_cash' };
    }

    case 'card': {
      // Check inventory first for bank item
      const invBank = inventory.getItemCount({ name: 'bank' });

      if (invBank >= amount) {
        const removed = inventory.removeItem({ name: 'bank', quantity: amount });
        if (removed) return { success: true };
      }

      // Fallback: try eb-banking
      try {
        if (bankExport?.RemoveBankMoney) {
          const success = bankExport.RemoveBankMoney(playerId, amount, description);
          if (success) return { success: true };
        }
      } catch {}

      // Fallback: try QBX player money
      if (qbxPlayer?.Functions?.RemoveMoney) {
        const success = qbxPlayer.Functions.RemoveMoney('bank', amount, description);
        if (success) return { success: true };
      }

      return { success: false, error: 'insufficient_bank' };
    }

    case 'dirty_money': {
      const removed = inventory.removeItem({
        name: PaymentConfig.dirtyMoneyItem,
        quantity: amount,
      });
      if (!removed) {
        return { success: false, error: 'insufficient_dirty_money' };
      }
      return { success: true };
    }

    default:
      return { success: false, error: 'invalid_payment_method' };
  }
}

/**
 * Refund a payment to the player
 */
export async function refundPayment(
  playerId: number,
  amount: number,
  method: PaymentMethod,
  description: string,
  inventory: any
): Promise<{ success: boolean; error?: string }> {
  if (amount <= 0) {
    return { success: true };
  }

  const bankExport = getBankingExport();
  const qbxPlayer = getQBXPlayer(playerId);

  switch (method) {
    case 'cash': {
      // Try eb-banking first
      try {
        if (bankExport?.AddCashMoney) {
          bankExport.AddCashMoney(playerId, amount);
          return { success: true };
        }
      } catch {}

      // Try QBX player money
      if (qbxPlayer?.Functions?.AddMoney) {
        qbxPlayer.Functions.AddMoney('cash', amount, `Refund: ${description}`);
        return { success: true };
      }

      // Fallback to inventory
      await inventory.addItem({ name: 'money', quantity: amount });
      return { success: true };
    }

    case 'card': {
      // Try eb-banking first
      try {
        if (bankExport?.AddBankMoney) {
          bankExport.AddBankMoney(playerId, amount, `Refund: ${description}`);
          return { success: true };
        }
      } catch {}

      // Try QBX player money
      if (qbxPlayer?.Functions?.AddMoney) {
        qbxPlayer.Functions.AddMoney('bank', amount, `Refund: ${description}`);
        return { success: true };
      }

      return { success: false, error: 'banking_unavailable' };
    }

    case 'dirty_money': {
      await inventory.addItem({
        name: PaymentConfig.dirtyMoneyItem,
        quantity: amount,
      });
      return { success: true };
    }

    default:
      return { success: false, error: 'invalid_payment_method' };
  }
}

/**
 * Pay a player (for buy shops)
 */
export async function payPlayer(
  playerId: number,
  cashAmount: number,
  dirtyMoneyAmount: number,
  inventory: any
): Promise<{ success: boolean; error?: string }> {
  try {
    const bankExport = getBankingExport();
    const qbxPlayer = getQBXPlayer(playerId);

    // Pay cash
    if (cashAmount > 0) {
      let paid = false;

      // Try eb-banking first
      try {
        if (bankExport?.AddCashMoney) {
          bankExport.AddCashMoney(playerId, cashAmount);
          paid = true;
        }
      } catch {}

      // Try QBX player money
      if (!paid && qbxPlayer?.Functions?.AddMoney) {
        qbxPlayer.Functions.AddMoney('cash', cashAmount, 'Shop sale');
        paid = true;
      }

      // Fallback to inventory
      if (!paid) {
        await inventory.addItem({ name: 'money', quantity: cashAmount });
      }
    }

    // Pay dirty money
    if (dirtyMoneyAmount > 0) {
      await inventory.addItem({
        name: PaymentConfig.dirtyMoneyItem,
        quantity: dirtyMoneyAmount,
      });
    }

    return { success: true };
  } catch (error) {
    console.error('[ox_inventory] Failed to pay player:', error);
    return { success: false, error: 'payment_failed' };
  }
}

/**
 * Get player's current funds for all payment methods
 */
export async function getPlayerFunds(
  playerId: number,
  inventory: any
): Promise<{ cash: number; bank: number; dirtyMoney: number }> {
  let cash = 0;
  let bank = 0;

  const bankExport = getBankingExport();
  const qbxPlayer = getQBXPlayer(playerId);

  // Get inventory money first as the source of truth for ox_inventory v3
  const invCash = inventory.getItemCount({ name: 'money' });
  const invBank = inventory.getItemCount({ name: 'bank' });

  // Try eb-banking first (if available and has the exports)
  try {
    if (bankExport?.GetCashBalance) {
      cash = bankExport.GetCashBalance(playerId) || 0;
    }
    if (bankExport?.GetBankBalance) {
      bank = bankExport.GetBankBalance(playerId) || 0;
    }
  } catch {
    // eb-banking failed, will use other sources
  }

  // If eb-banking didn't provide values, try QBX
  if (cash === 0 && qbxPlayer?.Functions?.GetMoney) {
    cash = qbxPlayer.Functions.GetMoney('cash') || 0;
  }
  if (bank === 0 && qbxPlayer?.Functions?.GetMoney) {
    bank = qbxPlayer.Functions.GetMoney('bank') || 0;
  }

  // IMPORTANT: Use the highest value between framework and inventory
  // This handles cases where inventory has items but framework isn't synced
  cash = Math.max(cash, invCash);
  bank = Math.max(bank, invBank);

  const dirtyMoney = inventory.getItemCount({ name: PaymentConfig.dirtyMoneyItem });

  return { cash, bank, dirtyMoney };
}
