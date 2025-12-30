import type { InventoryItem } from '@common/item';
import { triggerServerCallback } from '@communityox/ox_lib/client';
import { CloseInventory, RequestOpenInventory } from './inventory';
import { UseItem } from './item';
import { currentWeapon, DisarmWeapon } from './weapon';

// ============================================================
// FIREMODE SYSTEM
// ============================================================

type FireMode = 'auto' | 'semi' | 'safety';

let currentFireMode: FireMode = 'auto';
let firemodeActive = false;
let safetyActive = false;

// Get the default firemode for a weapon from its data
function getWeaponDefaultFiremode(): FireMode {
  // currentWeapon.firemode would be set from weapon data
  // For now, default to 'auto' if not specified
  return (currentWeapon as any).firemode || 'auto';
}

// Check if current weapon supports firemode switching
function canSwitchFiremode(): boolean {
  if (!currentWeapon.hash) return false;
  // Only weapons with ammoName (firearms) can switch firemodes
  return !!currentWeapon.ammoName;
}

// Cycle through firemodes: auto -> semi -> safety -> auto (or semi -> safety -> semi for semi-only weapons)
function cycleFiremode() {
  if (!canSwitchFiremode()) return;

  const defaultMode = getWeaponDefaultFiremode();

  // Define available modes based on weapon's default
  // Semi-only weapons: semi -> safety -> semi
  // Auto weapons: auto -> semi -> safety -> auto
  if (defaultMode === 'semi') {
    // Semi-only weapon
    if (currentFireMode === 'semi') {
      setFiremode('safety');
    } else {
      setFiremode('semi');
    }
  } else {
    // Auto-capable weapon
    if (currentFireMode === 'auto') {
      setFiremode('semi');
    } else if (currentFireMode === 'semi') {
      setFiremode('safety');
    } else {
      setFiremode('auto');
    }
  }
}

function setFiremode(mode: FireMode) {
  currentFireMode = mode;

  // Stop previous mode threads
  firemodeActive = false;
  safetyActive = false;

  if (mode === 'semi') {
    firemodeActive = true;
    startSemiAutoMode();
  } else if (mode === 'safety') {
    safetyActive = true;
    startSafetyMode();
  }

  // Show notification
  showFiremodeNotification(mode);

  // Update UI
  SendNUIMessage({ action: 'setFiremode', data: { mode } });
}

let semiAutoTickId: number | null = null;
let semiShotFired = false;

function startSemiAutoMode() {
  // Clear any existing tick
  if (semiAutoTickId !== null) {
    clearTick(semiAutoTickId);
    semiAutoTickId = null;
  }

  semiShotFired = false;

  semiAutoTickId = setTick(() => {
    if (!firemodeActive) {
      if (semiAutoTickId !== null) {
        clearTick(semiAutoTickId);
        semiAutoTickId = null;
      }
      return;
    }

    // If attack button is pressed
    if (IsControlPressed(0, 24) || IsDisabledControlPressed(0, 24)) {
      if (!semiShotFired) {
        // Allow the first shot - don't disable controls this frame
        semiShotFired = true;
      } else {
        // Block subsequent shots while held
        DisableControlAction(0, 24, true);
        DisableControlAction(0, 257, true);
      }
    } else {
      // Button released - reset for next shot
      semiShotFired = false;
    }
  });
}

let safetyTickId: number | null = null;

function startSafetyMode() {
  // Clear any existing tick
  if (safetyTickId !== null) {
    clearTick(safetyTickId);
    safetyTickId = null;
  }

  safetyTickId = setTick(() => {
    if (!safetyActive) {
      if (safetyTickId !== null) {
        clearTick(safetyTickId);
        safetyTickId = null;
      }
      return;
    }

    DisablePlayerFiring(PlayerId(), true);
    DisableControlAction(0, 24, true);
    DisableControlAction(0, 257, true);
  });
}

function showFiremodeNotification(mode: FireMode) {
  const labels: Record<FireMode, string> = {
    auto: 'Full Auto',
    semi: 'Semi-Auto',
    safety: 'Safety On',
  };

  // Use ox_lib notify if available
  if ((globalThis as any).lib?.notify) {
    (globalThis as any).lib.notify({
      title: 'Firemode',
      description: labels[mode],
      type: 'inform',
      position: 'top',
      duration: 2000,
    });
  }
}

// Reset firemode when weapon changes
export function resetFiremode() {
  firemodeActive = false;
  safetyActive = false;

  // Clean up ticks
  if (semiAutoTickId !== null) {
    clearTick(semiAutoTickId);
    semiAutoTickId = null;
  }
  if (safetyTickId !== null) {
    clearTick(safetyTickId);
    safetyTickId = null;
  }

  currentFireMode = getWeaponDefaultFiremode();
  SendNUIMessage({ action: 'setFiremode', data: { mode: currentFireMode } });
}

export { currentFireMode };

// ============================================================
// HOTBAR SYSTEM
// ============================================================

// Hotbar slot indices in the player inventory
// Player inventory is 11 wide, hotbar starts at slot 55 (row 6)
const HOTBAR_START_SLOT = 55;
const INV_WIDTH = 11;

// Map slot IDs to their inventory slot indices
const HOTBAR_SLOT_INDICES: Record<string, number> = {
  primary: HOTBAR_START_SLOT,                    // slot 55
  secondary: HOTBAR_START_SLOT + 5,              // slot 60
  melee: HOTBAR_START_SLOT + 7,                  // slot 62
  bag: HOTBAR_START_SLOT + 8,                    // slot 63 (1x2 bag slot)
  armor: HOTBAR_START_SLOT + 9,                  // slot 64 (2x2 vest slot)
  utility1: HOTBAR_START_SLOT + INV_WIDTH + 5,   // slot 71
  utility2: HOTBAR_START_SLOT + INV_WIDTH + 6,   // slot 72
};

let equippedSlotId: string | null = null;
let hotbarVisible = true;

// Use a hotbar slot (equip weapon or use item)
async function useHotbarSlot(slotId: string) {
  const slotIndex = HOTBAR_SLOT_INDICES[slotId];
  if (slotIndex === undefined) return;

  // Get the item from the server at this hotbar slot
  const item = await triggerServerCallback<InventoryItem | null>('ox_inventory:getHotbarItem', 100, slotIndex);

  if (!item) {
    // No item in this slot
    return;
  }

  // If this slot is already equipped, unequip
  if (equippedSlotId === slotId) {
    DisarmWeapon();
    equippedSlotId = null;
    SendNUIMessage({ action: 'setEquippedSlot', data: { slotId: null } });
    return;
  }

  // Use the item (this will equip weapons or use consumables)
  const success = await UseItem(item.uniqueId);

  if (success) {
    equippedSlotId = slotId;
    SendNUIMessage({ action: 'setEquippedSlot', data: { slotId } });
  }
}

// Toggle hotbar visibility
function toggleHotbar() {
  hotbarVisible = !hotbarVisible;
  SendNUIMessage({ action: 'setHotbarVisible', data: { visible: hotbarVisible } });
}

// Clear equipped slot (called when player dies, etc.)
export function clearEquippedSlot() {
  equippedSlotId = null;
  SendNUIMessage({ action: 'setEquippedSlot', data: { slotId: null } });
}

// NUI callbacks for hotbar
RegisterNuiCallback('hotbarEquip', async (data: { slotId: string; itemId: number }, cb: (result: number) => void) => {
  await useHotbarSlot(data.slotId);
  cb(1);
});

RegisterNuiCallback('hotbarUnequip', (data: { slotId: string }, cb: (result: number) => void) => {
  if (equippedSlotId === data.slotId) {
    DisarmWeapon();
    equippedSlotId = null;
    SendNUIMessage({ action: 'setEquippedSlot', data: { slotId: null } });
  }
  cb(1);
});

// Bag slot click - opens the bag inventory
RegisterNuiCallback('hotbarOpenBag', async (data: { itemId: number }, cb: (result: number) => void) => {
  if (data.itemId) {
    // Open the bag inventory using the item's uniqueId (bags use 'bag:' prefix)
    await RequestOpenInventory([`bag:${data.itemId}`]);
  }
  cb(1);
});

// Armor slot click - opens the armor/container inventory
RegisterNuiCallback('hotbarOpenArmor', async (data: { itemId: number }, cb: (result: number) => void) => {
  if (data.itemId) {
    // Open the armor/container inventory using the item's uniqueId (containers use 'container:' prefix)
    await RequestOpenInventory([`container:${data.itemId}`]);
  }
  cb(1);
});

// ============================================================
// HOTBAR KEYBINDS
// ============================================================

// Primary weapon (slot 1)
RegisterCommand('hotbar_primary', () => useHotbarSlot('primary'), false);
RegisterKeyMapping('hotbar_primary', 'Hotbar: Primary Weapon', 'keyboard', '1');

// Secondary weapon (slot 2)
RegisterCommand('hotbar_secondary', () => useHotbarSlot('secondary'), false);
RegisterKeyMapping('hotbar_secondary', 'Hotbar: Sidearm', 'keyboard', '2');

// Melee weapon (slot 3)
RegisterCommand('hotbar_melee', () => useHotbarSlot('melee'), false);
RegisterKeyMapping('hotbar_melee', 'Hotbar: Melee Weapon', 'keyboard', '3');

// Utility slot 1 (slot 4)
RegisterCommand('hotbar_utility1', () => useHotbarSlot('utility1'), false);
RegisterKeyMapping('hotbar_utility1', 'Hotbar: Utility Slot 1', 'keyboard', '4');

// Utility slot 2 (slot 5)
RegisterCommand('hotbar_utility2', () => useHotbarSlot('utility2'), false);
RegisterKeyMapping('hotbar_utility2', 'Hotbar: Utility Slot 2', 'keyboard', '5');

// Bag slot (slot 6) - opens bag inventory
RegisterCommand('hotbar_bag', async () => {
  const slotIndex = HOTBAR_SLOT_INDICES.bag;
  const item = await triggerServerCallback<InventoryItem | null>('ox_inventory:getHotbarItem', 100, slotIndex);
  if (item) {
    await RequestOpenInventory([`bag:${item.uniqueId}`]);
  }
}, false);
RegisterKeyMapping('hotbar_bag', 'Hotbar: Open Bag', 'keyboard', '6');

// Armor slot (slot 7) - opens armor/container inventory
RegisterCommand('hotbar_armor', async () => {
  const slotIndex = HOTBAR_SLOT_INDICES.armor;
  const item = await triggerServerCallback<InventoryItem | null>('ox_inventory:getHotbarItem', 100, slotIndex);
  if (item) {
    await RequestOpenInventory([`container:${item.uniqueId}`]);
  }
}, false);
RegisterKeyMapping('hotbar_armor', 'Hotbar: Open Armor', 'keyboard', '7');

// Toggle hotbar visibility
RegisterCommand('hotbar_toggle', toggleHotbar, false);
RegisterKeyMapping('hotbar_toggle', 'Toggle Hotbar Visibility', 'keyboard', 'Z');

// Firemode toggle (only works when holding a firearm)
RegisterCommand('weapon_firemode', cycleFiremode, false);
RegisterKeyMapping('weapon_firemode', 'Toggle Weapon Firemode', 'keyboard', '9');

// ============================================================
// STANDARD KEYBINDS
// ============================================================

RegisterCommand(
  'openInventory',
  () => {
    RequestOpenInventory();
  },
  false,
);

RegisterCommand('closeInventory', CloseInventory, false);

RegisterCommand(
  'reloadweapon',
  async () => {
    if (!currentWeapon.ammoName) return;

    const item = await triggerServerCallback<InventoryItem>('ox_inventory:findInventoryItem', 200, {
      name: currentWeapon.ammoName,
    });

    if (!item) return;

    UseItem(item.uniqueId);
  },
  false,
);

RegisterKeyMapping('openInventory', 'Access player inventory', 'keyboard', 'TAB');
RegisterKeyMapping('reloadweapon', 'Reload current weapon', 'keyboard', 'R');

// Export for use by other modules
export { equippedSlotId, hotbarVisible, HOTBAR_SLOT_INDICES };
