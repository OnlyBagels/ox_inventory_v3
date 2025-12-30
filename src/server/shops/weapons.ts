/**
 * MDT Weapon Registration
 * Registers weapons to the MDT SQLite database when purchased
 *
 * Serial Prefix Support:
 * - Shop-level: Set "serialPrefix" on the shop to apply to all weapons from that shop
 * - Item-level: Set "serial" in item metadata to use a custom prefix (e.g., "LSPD", "DHS", "SAFD")
 *
 * Examples:
 *   LSPD Armory: serialPrefix: "LSPD" -> "LSPD-8X2K4M1P"
 *   DHS Armory:  serialPrefix: "DHS"  -> "DHS-9A2B4C5D"
 *   SAFD Armory: serialPrefix: "SAFD" -> "SAFD-7K9X2M4P"
 */

import { DatabaseSync } from 'node:sqlite';

// Default serial length (total characters)
const SERIAL_LENGTH = 12;

// MDT SQLite database connection (lazy-loaded)
let mdtDb: DatabaseSync | null = null;

function getMdtDatabase(): DatabaseSync | null {
  if (mdtDb) return mdtDb;

  try {
    // Get the MDT resource path
    const mdtResourcePath = GetResourcePath('eb-mdt-ts-sqlite');
    if (!mdtResourcePath) {
      console.error('^1[ox_inventory] eb-mdt-ts-sqlite resource not found^0');
      return null;
    }

    mdtDb = new DatabaseSync(`${mdtResourcePath}/db.sqlite`);
    console.log('^2[ox_inventory] Connected to MDT SQLite database^0');
    return mdtDb;
  } catch (error) {
    console.error('^1[ox_inventory] Failed to connect to MDT database:^0', error);
    return null;
  }
}

/**
 * Generate a random serial number with optional prefix
 * @param prefix Optional prefix (e.g., "LSPD", "DHS", "SAFD")
 * @returns Serial like "LSPD-8X2K4M1P" or "A7K9X2M4P1Q3" if no prefix
 */
export function generateSerial(prefix?: string): string {
  const charset = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let serial = '';

  // If prefix provided, add it with a dash
  if (prefix) {
    serial = prefix.toUpperCase() + '-';
  }

  // Fill remaining characters to reach SERIAL_LENGTH (not counting the dash)
  const baseLength = prefix ? prefix.length : 0;
  const randomLength = Math.max(0, SERIAL_LENGTH - baseLength);
  for (let i = 0; i < randomLength; i++) {
    serial += charset[Math.floor(Math.random() * charset.length)];
  }

  return serial;
}

/**
 * Format weapon name for display
 */
function formatWeaponName(weaponName: string): string {
  return weaponName
    .replace('WEAPON_', '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Register a weapon purchase to the MDT SQLite database
 * Also checks and records the player's weapon license status
 */
export function registerWeaponPurchase(
  playerId: number,
  weaponName: string,
  serial: string | undefined,
  shopLabel: string,
  citizenId?: string
): string | null {
  try {
    const db = getMdtDatabase();
    if (!db) {
      console.error('^1[ox_inventory] Cannot register weapon: MDT database not available^0');
      return null;
    }

    // Generate serial if not provided
    const weaponSerial = serial || generateSerial();

    // Get citizen ID if not provided
    let ownerCitizenId = citizenId;
    if (!ownerCitizenId) {
      // Try to get from QBX
      const Player = exports.qbx_core?.GetPlayer?.(playerId);
      if (Player) {
        ownerCitizenId = Player.PlayerData?.citizenid;
      }
    }

    // Check license status
    const hasLicense = hasWeaponLicense(playerId);
    const licenseStatus = hasLicense ? 'Licensed' : 'UNLICENSED';

    const weaponType = formatWeaponName(weaponName);
    const currentDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const notes = `Purchased from ${shopLabel} (${licenseStatus})`;

    // Check if weapon already exists in registry
    const existingStmt = db.prepare('SELECT id FROM mdt_weapon_registry WHERE serial_number = ?');
    const existing = existingStmt.get(weaponSerial) as { id: number } | undefined;

    if (existing) {
      // Update existing record - append to notes
      const updateStmt = db.prepare(`
        UPDATE mdt_weapon_registry
        SET citizen_id = COALESCE(?, citizen_id),
            notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END
        WHERE serial_number = ?
      `);
      updateStmt.run(ownerCitizenId || null, notes, notes, weaponSerial);
      console.log(`^2[ox_inventory] Updated weapon in MDT: ${weaponSerial}^0`);
    } else {
      // Insert new record
      const insertStmt = db.prepare(`
        INSERT INTO mdt_weapon_registry (citizen_id, weapon_type, serial_number, registration_date, notes, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      insertStmt.run(ownerCitizenId || null, weaponType, weaponSerial, currentDate, notes, 'active');
      console.log(`^2[ox_inventory] Registered weapon in MDT: ${weaponSerial}^0`);
    }

    return weaponSerial;
  } catch (error) {
    console.error('^1[ox_inventory] Failed to register weapon in MDT:^0', error);
    return null;
  }
}

// ==========================================
// License Management via QBX Metadata
// ==========================================

/**
 * Check if a player has a weapon license
 * @param identifier Player source ID or citizenid
 * @returns true if player has weapon license
 */
export function hasWeaponLicense(identifier: number | string): boolean {
  try {
    const licences = exports.qbx_core?.GetMetadata?.(identifier, 'licences');
    return licences?.weapon === true;
  } catch (error) {
    console.error('^1[ox_inventory] Failed to check weapon license:^0', error);
    return false;
  }
}

/**
 * Grant a weapon license to a player
 * @param identifier Player source ID or citizenid
 * @returns true if license was granted successfully
 */
export function grantWeaponLicense(identifier: number | string): boolean {
  try {
    const licences = exports.qbx_core?.GetMetadata?.(identifier, 'licences') || {};
    licences.weapon = true;
    exports.qbx_core?.SetMetadata?.(identifier, 'licences', licences);
    console.log(`^2[ox_inventory] Granted weapon license to ${identifier}^0`);
    return true;
  } catch (error) {
    console.error('^1[ox_inventory] Failed to grant weapon license:^0', error);
    return false;
  }
}

/**
 * Revoke a weapon license from a player
 * @param identifier Player source ID or citizenid
 * @returns true if license was revoked successfully
 */
export function revokeWeaponLicense(identifier: number | string): boolean {
  try {
    const licences = exports.qbx_core?.GetMetadata?.(identifier, 'licences') || {};
    licences.weapon = false;
    exports.qbx_core?.SetMetadata?.(identifier, 'licences', licences);
    console.log(`^3[ox_inventory] Revoked weapon license from ${identifier}^0`);
    return true;
  } catch (error) {
    console.error('^1[ox_inventory] Failed to revoke weapon license:^0', error);
    return false;
  }
}

/**
 * Check if a player has a hunting license
 * @param identifier Player source ID or citizenid
 * @returns true if player has hunting license
 */
export function hasHuntingLicense(identifier: number | string): boolean {
  try {
    const licences = exports.qbx_core?.GetMetadata?.(identifier, 'licences');
    return licences?.hunting === true;
  } catch (error) {
    console.error('^1[ox_inventory] Failed to check hunting license:^0', error);
    return false;
  }
}

// ==========================================
// Weapon Classification
// ==========================================

// Melee weapons, throwables, and misc items that shouldn't get serial numbers
const NON_FIREARM_WEAPONS = new Set([
  // Melee weapons
  'weapon_knife', 'weapon_nightstick', 'weapon_hammer', 'weapon_bat',
  'weapon_crowbar', 'weapon_golfclub', 'weapon_bottle', 'weapon_dagger',
  'weapon_hatchet', 'weapon_knuckle', 'weapon_machete', 'weapon_flashlight',
  'weapon_switchblade', 'weapon_poolcue', 'weapon_wrench', 'weapon_battleaxe',
  'weapon_stone_hatchet', 'weapon_candycane',
  // Throwables
  'weapon_grenade', 'weapon_bzgas', 'weapon_molotov', 'weapon_stickybomb',
  'weapon_proxmine', 'weapon_snowball', 'weapon_pipebomb', 'weapon_ball',
  'weapon_smokegrenade', 'weapon_flare', 'weapon_fertilizercan',
  // Misc/utility
  'weapon_fireextinguisher', 'weapon_petrolcan', 'weapon_hazardcan',
  'weapon_parachute', 'weapon_unarmed',
]);

/**
 * Check if an item is a firearm (not melee/throwable)
 * Only firearms should get serial numbers registered to MDT
 */
export function isFirearm(itemName: string): boolean {
  const name = itemName.toLowerCase();
  if (!name.startsWith('weapon_')) return false;
  return !NON_FIREARM_WEAPONS.has(name);
}

/**
 * Check if an item is any weapon (including melee/throwables)
 */
export function isWeapon(itemName: string): boolean {
  return itemName.toLowerCase().startsWith('weapon_');
}

/**
 * Get weapon serial from item metadata
 */
export function getWeaponSerial(metadata?: Record<string, any>): string | undefined {
  return metadata?.serial;
}

/**
 * Create weapon metadata with serial
 * Priority for serial generation:
 * 1. If metadata.serial is a full serial (>4 chars), use it as-is
 * 2. If metadata.serial is a short prefix (<=4 chars like "LSPD"), generate with that prefix
 * 3. If shopPrefix is provided, generate with shop prefix
 * 4. Generate random serial
 *
 * @param existingMetadata Item metadata (may contain serial or serialPrefix)
 * @param shopPrefix Shop-level serial prefix (e.g., "LSPD", "DHS")
 */
export function createWeaponMetadata(
  existingMetadata?: Record<string, any>,
  shopPrefix?: string
): Record<string, any> {
  let serial: string;

  if (existingMetadata?.serial) {
    // If serial is short (<=4 chars), treat it as a prefix
    if (existingMetadata.serial.length <= 4) {
      serial = generateSerial(existingMetadata.serial);
    } else {
      // Full serial provided, use as-is
      serial = existingMetadata.serial;
    }
  } else {
    // Generate new serial with shop prefix (or random if no prefix)
    serial = generateSerial(shopPrefix);
  }

  return {
    ...existingMetadata,
    serial,
  };
}
