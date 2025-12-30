import Config from '@common/config';
import type { ItemProperties, Weapon } from '@common/item';
import { ClearObject } from '@common/utils';
import { GetWeaponAttachment } from '@common/weapon';
import {
  GROUP_FIREEXTINGUISHER,
  GROUP_MELEE,
  GROUP_PETROLCAN,
  GROUP_PISTOL,
  WEAPON_FIREEXTINGUISHER,
  WEAPON_HAZARDCAN,
  WEAPON_FERTILIZERCAN,
  WEAPON_PETROLCAN,
} from '@common/hash';
import { cache, sleep, waitFor } from '@communityox/ox_lib';
import { notify, requestAnimDict } from '@communityox/ox_lib/client';

const SuppressPickupRewardType = N_0xf92099527db8e2a7;
const ClearPickupRewardTypeSuppression = N_0x762db2d380b48d04;
const pickups = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 7) | (1 << 10);
export let weaponWheelEnabled = false;

// Animation data for weapon groups (dict, clip, duration for equip, dict, clip, duration for holster)
interface WeaponAnim {
  equipDict: string;
  equipClip: string;
  equipDuration: number;
  holsterDict: string;
  holsterClip: string;
  holsterDuration: number;
}

const weaponAnims: Record<number, WeaponAnim> = {};

// Initialize animation lookup after hash keys are available
function initWeaponAnims() {
  if (Object.keys(weaponAnims).length > 0) return;

  weaponAnims[GROUP_MELEE] = {
    equipDict: 'melee@holster',
    equipClip: 'unholster',
    equipDuration: 200,
    holsterDict: 'melee@holster',
    holsterClip: 'holster',
    holsterDuration: 600,
  };

  weaponAnims[GROUP_PISTOL] = {
    equipDict: 'reaction@intimidation@cop@unarmed',
    equipClip: 'intro',
    equipDuration: 400,
    holsterDict: 'reaction@intimidation@cop@unarmed',
    holsterClip: 'outro',
    holsterDuration: 450,
  };
}

function vehicleIsCycle(vehicle: number): boolean {
  const vehicleClass = GetVehicleClass(vehicle);
  return vehicleClass === 8 || vehicleClass === 13;
}

export function SetWeaponWheelDisabled(disabled = Config.Weapon_Enabled) {
  weaponWheelEnabled = !disabled;

  SetWeaponsNoAutoswap(disabled);
  SetWeaponsNoAutoreload(disabled);

  if (disabled) return SuppressPickupRewardType(pickups, 1);

  ClearPickupRewardTypeSuppression(pickups);
}

export interface CurrentWeapon extends Weapon {
  group: number;
  timer: number;
  isMelee: boolean;
  isThrowable: boolean;
  shotDelay: number;
  meleeHits: number;
  specialAmmo?: string;
}

export const currentWeapon = {} as CurrentWeapon;

export function GetValidWeaponComponent(weapon: Weapon, name: string) {
  const attachment = GetWeaponAttachment(name);

  if (!attachment) return null;

  for (const component of attachment) {
    if (!DoesWeaponTakeWeaponComponent(weapon.hash, component)) continue;

    if (HasPedGotWeaponComponent(cache.ped, weapon.hash, component)) {
      notify({
        id: 'weapon_has_component',
        description: 'weapon_has_component',
        type: 'error',
      });

      return null;
    }

    return component;
  }

  notify({
    id: 'invalid_weapon_component',
    description: 'invalid_weapon_component',
    type: 'error',
  });

  return null;
}

async function playWeaponAnimation(
  dict: string,
  clip: string,
  duration: number,
  coords: number[],
  heading: number
): Promise<void> {
  await requestAnimDict(dict);

  TaskPlayAnimAdvanced(
    cache.ped,
    dict,
    clip,
    coords[0],
    coords[1],
    coords[2],
    0,
    0,
    heading,
    8.0,
    3.0,
    duration * 2,
    50,
    0.1,
    false,
    false
  );

  await sleep(duration);
}

export async function EquipWeapon(item: Weapon, noAnim = false): Promise<number | undefined> {
  if (item.category !== 'weapon') return;

  initWeaponAnims();

  const coords = GetEntityCoords(cache.ped, true);
  const heading = GetEntityHeading(cache.ped);
  const group = GetWeapontypeGroup(item.hash);
  let animSleep: number | undefined;

  // Play equip animation if enabled
  if (Config.Weapon_Animations && !noAnim) {
    if (!(cache.vehicle && vehicleIsCycle(cache.vehicle))) {
      const anim = weaponAnims[group];

      if (anim) {
        // Only use police holster anim if player is police (check via state or group)
        // For now, use the animation if available
        animSleep = anim.equipDuration;
        await playWeaponAnimation(anim.equipDict, anim.equipClip, animSleep, coords, heading);
      } else {
        // Default animation for other weapons
        animSleep = 1200;
        await playWeaponAnimation('reaction@intimidation@1h', 'intro', animSleep, coords, heading);
      }
    }
  }

  // Set up current weapon data
  Object.assign(currentWeapon, item);
  currentWeapon.group = group;
  currentWeapon.timer = 0;
  currentWeapon.isMelee = GetWeaponDamageType(item.hash) === 2;
  currentWeapon.isThrowable = item.category === 'throwable' || false;
  currentWeapon.shotDelay = GetWeaponTimeBetweenShots(item.hash);
  currentWeapon.meleeHits = 0;

  // Give weapon to ped
  GiveWeaponToPed(cache.ped, item.hash, 0, false, true);

  // Apply weapon tint
  if (item.tint !== undefined) {
    SetPedWeaponTintIndex(cache.ped, item.hash, item.tint);
  }

  // Apply weapon damage modifier if specified
  if ((item as any).damage !== undefined) {
    SetWeaponDamageModifier(item.hash, (item as any).damage);
  }

  // Apply weapon components
  if (currentWeapon.components) {
    for (const componentName of currentWeapon.components) {
      const attachment = GetWeaponAttachment(componentName);
      if (!attachment) continue;

      for (const component of attachment) {
        if (DoesWeaponTakeWeaponComponent(item.hash, component)) {
          if (!HasPedGotWeaponComponent(cache.ped, item.hash, component)) {
            GiveWeaponComponentToPed(cache.ped, item.hash, component);
          }
          break;
        }
      }
    }
  }

  // Apply special ammo clip if present
  if (currentWeapon.specialAmmo) {
    const weaponName = item.name.toUpperCase().replace('WEAPON_', '');
    const clipComponentKey = `COMPONENT_${weaponName}_CLIP`;
    const specialClip = `${clipComponentKey}_${currentWeapon.specialAmmo.toUpperCase()}`;
    const specialClipHash = GetHashKey(specialClip);

    if (DoesWeaponTakeWeaponComponent(item.hash, specialClipHash)) {
      GiveWeaponComponentToPed(cache.ped, item.hash, specialClipHash);
    }
  }

  // Set ammo
  const ammo = currentWeapon.ammoCount ?? (currentWeapon.isThrowable ? 1 : 0);

  SetCurrentPedWeapon(cache.ped, item.hash, true);
  SetPedCurrentWeaponVisible(cache.ped, true, false, false, false);
  SetWeaponsNoAutoswap(true);
  SetPedAmmo(cache.ped, item.hash, ammo);

  // Special handling for petrol can / fire extinguisher
  if (currentWeapon.group === GROUP_PETROLCAN || currentWeapon.group === GROUP_FIREEXTINGUISHER) {
    currentWeapon.ammoCount = currentWeapon.durability;
    SetPedInfiniteAmmo(cache.ped, true, item.hash);
  }

  setTimeout(() => RefillAmmoInstantly(cache.ped));

  // Trigger event for other resources
  emit('ox_inventory:currentWeapon', currentWeapon);

  // Notify weapon equipped if config enabled
  if (Config.Weapon_DisarmNotification) {
    notify({
      id: 'weapon_equipped',
      description: `Equipped ${item.label || item.name}`,
      type: 'success',
    });
  }

  return animSleep;
}

export async function DisarmWeapon(noAnim = false): Promise<void> {
  if (!currentWeapon.name) return;

  initWeaponAnims();

  // Notify server to save weapon state
  emitNet('ox_inventory:updateWeapon');

  SetPedAmmo(cache.ped, currentWeapon.hash, 0);

  // Play holster animation if enabled
  if (Config.Weapon_Animations && !noAnim) {
    if (!(cache.vehicle && vehicleIsCycle(cache.vehicle))) {
      ClearPedSecondaryTask(cache.ped);

      const coords = GetEntityCoords(cache.ped, true);
      const heading = GetEntityHeading(cache.ped);
      const anim = weaponAnims[currentWeapon.group];

      if (anim) {
        await playWeaponAnimation(anim.holsterDict, anim.holsterClip, anim.holsterDuration, coords, heading);
      } else {
        await playWeaponAnimation('reaction@intimidation@1h', 'outro', 1400, coords, heading);
      }
    }
  }

  // Notify weapon holstered if config enabled
  if (Config.Weapon_DisarmNotification) {
    notify({
      id: 'weapon_holstered',
      description: `Holstered ${currentWeapon.label || currentWeapon.name}`,
      type: 'inform',
    });
  }

  // Trigger event for other resources
  emit('ox_inventory:currentWeapon');

  SetWeaponWheelDisabled();
  RemoveAllPedWeapons(cache.ped, true);
  ClearObject(currentWeapon);
}

export function ClearAllWeapons(): void {
  DisarmWeapon(true);
  RemoveAllPedWeapons(cache.ped, true);
}

export async function LoadAmmo(item: ItemProperties): Promise<boolean> {
  if (!currentWeapon.name || currentWeapon.ammoName !== item.name) return false;
  if (currentWeapon.durability <= 0) {
    notify({
      id: 'no_durability',
      description: 'no_durability',
      type: 'error',
    });
    return false;
  }

  let clipSize = GetMaxAmmoInClip(cache.ped, currentWeapon.hash, true);
  const currentAmmo = GetAmmoInPedWeapon(cache.ped, currentWeapon.hash);
  const [_, maxAmmo] = GetMaxAmmo(cache.ped, currentWeapon.hash);

  if (maxAmmo < clipSize) clipSize = maxAmmo;
  if (currentAmmo === clipSize) return false;

  // Handle special ammo type switching
  const specialAmmoType = (item as any).type as string | undefined;

  if (specialAmmoType !== currentWeapon.specialAmmo && currentWeapon.specialAmmo) {
    const weaponName = currentWeapon.name.toUpperCase().replace('WEAPON_', '');
    const clipComponentKey = `COMPONENT_${weaponName}_CLIP`;
    const specialClip = `${clipComponentKey}_${(specialAmmoType || currentWeapon.specialAmmo).toUpperCase()}`;
    const specialClipHash = GetHashKey(specialClip);

    if (specialAmmoType) {
      // Check if we can apply this special ammo clip
      if (!DoesWeaponTakeWeaponComponent(currentWeapon.hash, specialClipHash)) {
        console.warn('cannot use clip with this weapon');
        return false;
      }

      const defaultClip = `${clipComponentKey}_01`;
      const defaultClipHash = GetHashKey(defaultClip);

      if (!HasPedGotWeaponComponent(cache.ped, currentWeapon.hash, defaultClipHash)) {
        console.warn('cannot use clip with currently equipped clip');
        return false;
      }

      if (currentAmmo > 0) {
        console.warn('cannot mix special ammo with base ammo');
        return false;
      }

      currentWeapon.specialAmmo = specialAmmoType;
      GiveWeaponComponentToPed(cache.ped, currentWeapon.hash, specialClipHash);
    } else if (HasPedGotWeaponComponent(cache.ped, currentWeapon.hash, specialClipHash)) {
      if (currentAmmo > 0) {
        console.warn('cannot mix special ammo with base ammo');
        return false;
      }

      delete currentWeapon.specialAmmo;
      RemoveWeaponComponentFromPed(cache.ped, currentWeapon.hash, specialClipHash);
    }
  }

  if (maxAmmo > clipSize) {
    clipSize = GetMaxAmmoInClip(cache.ped, currentWeapon.hash, true);
  }

  const missingAmmo = clipSize - currentAmmo;
  const addAmmo = item.quantity > missingAmmo ? missingAmmo : item.quantity;
  const newAmmo = currentAmmo + addAmmo;

  if (currentAmmo === newAmmo) return false;

  AddAmmoToPed(cache.ped, currentWeapon.hash, addAmmo);

  // Handle reload animation
  if (cache.vehicle) {
    if ((cache.seat as number) > -1 || IsVehicleStopped(cache.vehicle)) {
      TaskReloadWeapon(cache.ped, true);
    } else {
      // Force ammo to load while driving
      await waitFor(() => {
        RefillAmmoInstantly(cache.ped);
        const [_, ammo] = GetAmmoInClip(cache.ped, currentWeapon.hash);
        return ammo === newAmmo || undefined;
      });
    }
  } else {
    await sleep(100);
    MakePedReload(cache.ped);

    // Wait for reload animation and disable jump
    setTimeout(async () => {
      while (IsPedReloading(cache.ped)) {
        DisableControlAction(0, 22, true);
        await sleep(0);
      }
    }, 100);
  }

  // Notify server of ammo load
  emitNet('ox_inventory:loadWeaponAmmo', newAmmo, currentWeapon.specialAmmo);

  return true;
}

// Handle shooting and durability drain
export function HandleWeaponShooting(): void {
  if (!currentWeapon.name || currentWeapon.timer === undefined) return;

  const durabilityDrain = Config.Weapon_DurabilityPerShot || 0.03;

  // Handle petrol can / fire extinguisher
  if (currentWeapon.group === GROUP_PETROLCAN || currentWeapon.group === GROUP_FIREEXTINGUISHER) {
    const currentAmmo = (currentWeapon.ammoCount || 0) - durabilityDrain;
    currentWeapon.durability = currentAmmo < 0 ? 0 : currentAmmo;
    currentWeapon.ammoCount = currentWeapon.durability;

    if (currentAmmo <= 0) {
      SetPedInfiniteAmmo(cache.ped, false, currentWeapon.hash);
    }
    return;
  }

  // Regular weapon shooting
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

  currentWeapon.timer = GetGameTimer() + (currentWeapon.shotDelay * 1000) + 100;
}

// Handle melee weapon hits
export function HandleMeleeHit(): void {
  if (!currentWeapon.name || !currentWeapon.isMelee) return;

  currentWeapon.meleeHits = (currentWeapon.meleeHits || 0) + 1;
  currentWeapon.timer = GetGameTimer() + 200;
}

// Handle throwable weapons
export async function HandleThrowableWeapon(): Promise<void> {
  if (!currentWeapon.name || !currentWeapon.isThrowable) return;

  const weapon = { ...currentWeapon };

  // Wait for throw to complete
  while (
    currentWeapon.name &&
    (!IsPedWeaponReadyToShoot(cache.ped) || IsDisabledControlPressed(0, 24)) &&
    GetSelectedPedWeapon(cache.ped) === weapon.hash
  ) {
    await sleep(0);
  }

  if (GetSelectedPedWeapon(cache.ped) === weapon.hash) {
    await sleep(700);
  }

  while (IsPedPlantingBomb(cache.ped)) {
    await sleep(0);
  }

  // Notify server that throwable was used
  emitNet('ox_inventory:updateWeapon', 'throw', null, weapon.anchorSlot);

  RemoveWeaponFromPed(cache.ped, weapon.hash);
  ClearObject(currentWeapon);
  emit('ox_inventory:currentWeapon');
}

// Check if weapon hash is a special container weapon
export function isContainerWeapon(hash: number): boolean {
  return (
    hash === WEAPON_FIREEXTINGUISHER ||
    hash === WEAPON_PETROLCAN ||
    hash === WEAPON_HAZARDCAN ||
    hash === WEAPON_FERTILIZERCAN
  );
}

// Event handler for weapon state updates from server
onNet('ox_inventory:updateCurrentWeapon', (item: Weapon) => {
  if (currentWeapon.uniqueId !== item.uniqueId) return;

  Object.assign(currentWeapon, item);
});

// Event handler for disarming weapon
onNet('ox_inventory:disarm', (noAnim: boolean) => {
  DisarmWeapon(noAnim);
});

// Event handler for clearing all weapons
onNet('ox_inventory:clearWeapons', () => {
  ClearAllWeapons();
});
