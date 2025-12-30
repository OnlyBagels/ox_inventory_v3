import Config from '@common/config';

export interface BridgePlayerData {
  source: number;
  name: string;
  groups: Record<string, number>;
  sex?: string;
  dateofbirth?: string;
}

export interface PlayerLoadData {
  source: number;
  identifier: string;
  name: string;
  groups?: Record<string, number>;
  sex?: string;
  dateofbirth?: string;
}

export interface License {
  name: string;
  price: number;
  coords?: number[];
}

export interface ServerBridge {
  /** Framework name identifier */
  name: string;

  /** Called when a player connects/loads - sets up their inventory */
  setPlayerInventory(player: PlayerLoadData): Promise<void>;

  /** Transforms player data into a standardized format */
  setPlayerData(player: any): BridgePlayerData;

  /** Syncs inventory changes back to the framework (money, items, etc.) */
  syncInventory(inventory: any): void;

  /** Checks if an inventory's owner has a required group/job */
  hasGroup(inventory: any, group: string | Record<string, number>): [string | undefined, number | undefined];

  /** Checks if the player has a specific license */
  hasLicense?(inventory: any, license: string): boolean;

  /** Purchases a license for the player */
  buyLicense?(inventory: any, license: License): [boolean, string];

  /** Calls the framework's registered item use callback */
  UseItem?(source: number, itemName: string, data: any): boolean | Promise<boolean>;

  /** Checks if a player is a boss of a group */
  isPlayerBoss?(playerId: number, group: string, grade: number): boolean;

  /** Gets the owned vehicle ID from an entity */
  getOwnedVehicleId?(entityId: number): number | string;

  /** Called when a player disconnects */
  playerDropped(source: number): void;
}

let bridge: ServerBridge | null = null;

export function getBridge(): ServerBridge {
  if (!bridge) {
    throw new Error('Server bridge has not been initialized');
  }
  return bridge;
}

export function setBridge(newBridge: ServerBridge): void {
  bridge = newBridge;
  console.log(`^2[ox_inventory] Loaded ${newBridge.name} bridge^0`);
}

export async function initBridge(): Promise<void> {
  const framework = Config.Framework || detectFramework();

  if (!framework) {
    throw new Error('No supported framework detected. Please set Config.Framework manually.');
  }

  console.log(`^3[ox_inventory] Detected framework: ${framework}^0`);

  try {
    switch (framework.toLowerCase()) {
      case 'qbx':
      case 'qbcore':
        const { QBXBridge } = await import('./qbx');
        setBridge(new QBXBridge());
        break;

      case 'ox':
        const { OxBridge } = await import('./ox');
        setBridge(new OxBridge());
        break;

      default:
        throw new Error(`Unsupported framework: ${framework}`);
    }
  } catch (error) {
    console.error(`^1[ox_inventory] Failed to load ${framework} bridge:^0`, error);
    throw error;
  }
}

function detectFramework(): string | null {
  // Check for QBX/QBCore
  if (GetResourceState('qbx_core') === 'started') {
    return 'qbx';
  }

  // Check for Ox Core
  if (GetResourceState('ox_core') === 'started') {
    return 'ox';
  }

  // Check for ESX (future support)
  if (GetResourceState('es_extended') === 'started') {
    return 'esx';
  }

  return null;
}

// Re-export bridge methods for convenience
export function hasGroup(inventory: any, group: string | Record<string, number>) {
  return getBridge().hasGroup(inventory, group);
}

export function setPlayerData(player: any): BridgePlayerData {
  return getBridge().setPlayerData(player);
}

export function syncInventory(inventory: any): void {
  getBridge().syncInventory(inventory);
}

export function playerDropped(source: number): void {
  getBridge().playerDropped(source);
}

export function isPlayerBoss(playerId: number, group: string, grade: number): boolean {
  const bridge = getBridge();
  if (bridge.isPlayerBoss) {
    return bridge.isPlayerBoss(playerId, group, grade);
  }
  return false;
}

/**
 * Gets the inventory ID for a player.
 * Uses citizenid (permanent) instead of source (temporary).
 */
export function GetPlayerInventoryId(playerId: number): string {
  // Try to get citizenid from QBX
  try {
    if (GetResourceState('qbx_core') === 'started') {
      const player = exports.qbx_core.GetPlayer(playerId);
      if (player?.PlayerData?.citizenid) {
        return `player:${player.PlayerData.citizenid}`;
      }
    }
  } catch {}

  // Fallback to source-based ID (will be wrong for persistence but works for session)
  console.warn(`^3[ox_inventory] Could not get citizenid for player ${playerId}, using source-based ID^0`);
  return `player:${playerId}`;
}

/**
 * Gets vehicle information from an inventory ID.
 * Supports both netId-based (trunk:12345) and plate-based (trunk:ABC123) identifiers.
 * Like v2, will search all vehicles by plate if a direct netId lookup fails.
 * Returns [netId, entityId, plate, isTemporary]
 */
export function GetVehicleFromInventoryId(inventoryId: string): [number | null, number, string, boolean] {
  const parts = inventoryId.split(':');
  const type = parts[0]; // 'trunk' or 'glovebox'
  const identifier = parts.slice(1).join(':');

  // Try treating identifier as a network ID first
  const possibleNetId = Number(identifier);

  if (!isNaN(possibleNetId) && NetworkDoesEntityExistWithNetworkId(possibleNetId)) {
    const entityId = NetworkGetEntityFromNetworkId(possibleNetId);
    const plate = GetVehicleNumberPlateText(entityId)?.trim() || identifier;

    // Check if this is owned
    const vehicleId = getBridge().getOwnedVehicleId?.(entityId);
    const isTemporary = !vehicleId;

    return [possibleNetId, entityId, plate, isTemporary];
  }

  // Identifier is a plate - search all vehicles for matching plate (like v2)
  const plate = Config.TrimPlates ? identifier.trim() : identifier;
  const vehicles = GetAllVehicles();

  for (let i = 0; i < vehicles.length; i++) {
    const vehicle = vehicles[i];
    let vehiclePlate = GetVehicleNumberPlateText(vehicle);

    if (Config.TrimPlates) {
      vehiclePlate = vehiclePlate?.trim();
    }

    if (vehiclePlate && vehiclePlate.includes(plate)) {
      const netId = NetworkGetNetworkIdFromEntity(vehicle);

      // Check if this is owned
      const vehicleId = getBridge().getOwnedVehicleId?.(vehicle);
      const isTemporary = !vehicleId;

      return [netId, vehicle, plate, isTemporary];
    }
  }

  // No entity found - return plate info without entity (for database lookup)
  console.warn(`[ox_inventory] No vehicle entity found for plate: ${plate}`);
  return [null, 0, plate, false];
}
