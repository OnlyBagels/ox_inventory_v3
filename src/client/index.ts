import './keybinds';
import './item';
import './weapon';
import './kevlar';
import './shops';
import Config from '@common/config';
import { GROUP_FIREEXTINGUISHER, GROUP_PETROLCAN, GROUP_UNARMED } from '@common/hash';
import { cache, onServerCallback } from '@communityox/ox_lib/client';
import { InventoryState, inventoryState } from './inventory';
import { isUsingItem, registerItemEffect } from './item';
import {
  currentWeapon,
  weaponWheelEnabled,
  DisarmWeapon,
  HandleWeaponShooting,
  HandleMeleeHit,
  HandleThrowableWeapon,
  SetWeaponWheelDisabled,
} from './weapon';
import './clothing';
import { Vector3 } from '@nativewrappers/fivem';
import { useVest, managePlates } from './kevlar';

onServerCallback('ox_inventory:getVehicleClass', (netId) => GetVehicleClass(NetworkGetEntityFromNetworkId(netId)));

setInterval(() => {
  cache.coords = Vector3.fromArray(GetEntityCoords(cache.ped, true));
}, 500);

// Ignore weapon hashes for mismatch detection
const ignoreWeapons: Record<number, boolean> = {};
for (const weapon of Config.Weapon_IgnoreWeapons) {
  ignoreWeapons[GetHashKey(weapon)] = true;
}

// Throwable tracking
let throwableTracking = false;

setTick(() => {
  DisablePlayerVehicleRewards(cache.playerId);

  if (inventoryState === InventoryState.Open) {
    DisableAllControlActions(0);
    HideHudAndRadarThisFrame();

    for (let index = 0; index < Config.Inventory_EnableKeys.length; index++) {
      EnableControlAction(0, Config.Inventory_EnableKeys[index], true);
    }

    return;
  }

  if (inventoryState === InventoryState.Busy) {
    DisableControlAction(0, 23, true);
    DisableControlAction(0, 36, true);
  }

  if (isUsingItem || IsPedCuffed(cache.ped)) {
    DisablePlayerFiring(cache.playerId, true);
  }

  if (!weaponWheelEnabled) {
    HudWeaponWheelIgnoreSelection();
    DisableControlAction(0, 37, true);
  }

  // No current weapon equipped
  if (currentWeapon.timer === undefined) {
    // Check for weapon mismatch (player has weapon they shouldn't have)
    if (Config.Weapon_CheckModelMismatch) {
      const weaponHash = GetSelectedPedWeapon(cache.ped);

      if (!ignoreWeapons[weaponHash]) {
        const weaponType = GetWeapontypeGroup(weaponHash);

        if (weaponType !== 0 && weaponType !== GROUP_UNARMED) {
          DisarmWeapon(true);
        }
      }
    }
    return;
  }

  // Weapon is equipped - disable weapon switching controls
  DisableControlAction(0, 80, true);
  DisableControlAction(0, 140, true);

  // Disable firing if durability is 0 or if aimed firing is required
  if (
    currentWeapon.durability <= 0 ||
    (Config.Weapon_AimedFiring &&
      !currentWeapon.isMelee &&
      currentWeapon.group !== GROUP_PETROLCAN &&
      !IsPlayerFreeAiming(cache.playerId))
  ) {
    DisablePlayerFiring(cache.playerId, true);
  }

  // Timer expired - sync weapon state with server
  if (inventoryState !== InventoryState.Busy && currentWeapon.timer > 0 && currentWeapon.timer < GetGameTimer()) {
    currentWeapon.timer = 0;

    if (currentWeapon.ammoName) {
      // Ranged weapon - send ammo update
      emitNet('ox_inventory:updateWeapon', 'ammo', currentWeapon.ammoCount);

      // Auto-reload if enabled and out of ammo
      if (Config.Weapon_AutoReload && currentWeapon.ammoName && GetAmmoInPedWeapon(cache.ped, currentWeapon.hash) === 0) {
        // Find ammo slot and use it (handled via keybinds.ts reloadweapon command)
      }
    } else if (currentWeapon.isMelee && currentWeapon.meleeHits > 0) {
      // Melee weapon - send melee hits
      emitNet('ox_inventory:updateWeapon', 'melee', currentWeapon.meleeHits);
      currentWeapon.meleeHits = 0;
    }
    return;
  }

  // Handle melee weapon hits
  if (currentWeapon.isMelee && IsPedPerformingMeleeAction(cache.ped)) {
    HandleMeleeHit();
    return;
  }

  // Handle ranged weapon shooting
  if (currentWeapon.ammoName && IsPedShooting(cache.ped)) {
    const durabilityDrain = Config.Weapon_DurabilityPerShot || 0.03;

    // Handle petrol can / fire extinguisher
    if (currentWeapon.group === GROUP_PETROLCAN || currentWeapon.group === GROUP_FIREEXTINGUISHER) {
      const currentAmmo = (currentWeapon.ammoCount || 0) - durabilityDrain;
      currentWeapon.durability = currentAmmo < 0 ? 0 : currentAmmo;
      currentWeapon.ammoCount = currentWeapon.durability;

      if (currentAmmo <= 0) {
        SetPedInfiniteAmmo(cache.ped, false, currentWeapon.hash);
      }
    } else {
      // Regular weapon
      const currentAmmo = GetAmmoInPedWeapon(cache.ped, currentWeapon.hash);

      if (currentAmmo < (currentWeapon.ammoCount || 0)) {
        const shotsFired = Math.abs((currentWeapon.ammoCount || 0) - currentAmmo);
        currentWeapon.ammoCount = currentAmmo;
        currentWeapon.durability = (currentWeapon.durability || 100) - (durabilityDrain * shotsFired * 100);

        if (currentWeapon.durability < 0) currentWeapon.durability = 0;
      }

      if (currentAmmo <= 0 && cache.vehicle) {
        TaskSwapWeapon(cache.ped, true);
      }
    }

    currentWeapon.timer = GetGameTimer() + (currentWeapon.shotDelay * 1000) + 100;
    return;
  }

  // Handle throwable weapons
  if (currentWeapon.isThrowable && !throwableTracking) {
    if (inventoryState !== InventoryState.Busy && IsControlPressed(0, 24)) {
      throwableTracking = true;

      // Track throwable usage asynchronously
      (async () => {
        await HandleThrowableWeapon();
        throwableTracking = false;
      })();
    }
  }

  // Check if weapon was forcibly unequipped by game/other resource
  const weaponHash = GetSelectedPedWeapon(cache.ped);

  if (currentWeapon.name && weaponHash !== currentWeapon.hash && currentWeapon.timer !== undefined) {
    // Try to re-equip the weapon
    SetCurrentPedWeapon(cache.ped, currentWeapon.hash, true);
    SetAmmoInClip(cache.ped, currentWeapon.hash, currentWeapon.ammoCount || 0);
    SetPedCurrentWeaponVisible(cache.ped, true, false, false, false);

    const newHash = GetSelectedPedWeapon(cache.ped);

    if (newHash !== currentWeapon.hash) {
      console.log(`${currentWeapon.name} was forcibly unequipped (caused by game behaviour or another resource)`);
      DisarmWeapon(true);
    }
  }
});

// Weapon wheel state handler (disable if using action mode)
setInterval(() => {
  if (currentWeapon.name && IsPedUsingActionMode(cache.ped)) {
    SetPedUsingActionMode(cache.ped, false, -1, 'DEFAULT_ACTION');
  }
}, 200);

// Handle vehicle weapon detection
on('ox_lib:cache:seat', (seat: number | false) => {
  if (seat !== false) {
    const hasVehicleWeapon = GetCurrentPedVehicleWeapon(cache.ped);

    if (hasVehicleWeapon) {
      SetWeaponWheelDisabled(false);
      return;
    }
  }

  SetWeaponWheelDisabled();
});

// ============================================================
// PLATE CARRIER ITEM EFFECTS
// ============================================================

// Register plate carrier use effects
const PLATE_CARRIERS = ['heavypc', 'lightpc', 'crim_heavypc', 'crim_lightpc'];

for (const carrier of PLATE_CARRIERS) {
  registerItemEffect(carrier, async (item) => {
    await useVest(item, item.anchorSlot || 0);
    return false; // Don't consume item
  });
}
