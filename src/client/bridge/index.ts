import Config from '@common/config';

export interface ClientBridgePlayerData {
  source: number;
  name: string;
  groups: Record<string, number>;
  loaded: boolean;
  dead: boolean;
  cuffed: boolean;
}

export interface ClientBridge {
  /** Framework name identifier */
  name: string;

  /** Gets current player data from the framework */
  getPlayerData(): ClientBridgePlayerData | null;

  /** Checks if player has a specific group */
  hasGroup(group: string | Record<string, number>): [string | undefined, number | undefined];

  /** Called when player data changes */
  onPlayerDataChange?(callback: (key: string, value: any) => void): void;

  /** Checks if player is loaded */
  isPlayerLoaded(): boolean;

  /** Checks if player is dead */
  isPlayerDead(): boolean;

  /** Sets player status (thirst, hunger, stress, etc.) */
  setPlayerStatus?(status: Record<string, number>): void;
}

let bridge: ClientBridge | null = null;
let playerData: ClientBridgePlayerData | null = null;

export function getBridge(): ClientBridge {
  if (!bridge) {
    throw new Error('Client bridge has not been initialized');
  }
  return bridge;
}

export function setBridge(newBridge: ClientBridge): void {
  bridge = newBridge;
  console.log(`^2[ox_inventory] Loaded ${newBridge.name} client bridge^0`);
}

export function getPlayerData(): ClientBridgePlayerData | null {
  return playerData ?? bridge?.getPlayerData() ?? null;
}

export function setPlayerData(data: ClientBridgePlayerData | null): void {
  playerData = data;
}

export async function initClientBridge(): Promise<void> {
  const framework = Config.Framework || detectFramework();

  if (!framework) {
    throw new Error('No supported framework detected');
  }

  console.log(`^3[ox_inventory] Detected framework: ${framework}^0`);

  try {
    switch (framework.toLowerCase()) {
      case 'qbx':
      case 'qbcore':
        const { QBXClientBridge } = await import('./qbx');
        setBridge(new QBXClientBridge());
        break;

      case 'ox':
        const { OxClientBridge } = await import('./ox');
        setBridge(new OxClientBridge());
        break;

      default:
        throw new Error(`Unsupported framework: ${framework}`);
    }
  } catch (error) {
    console.error(`^1[ox_inventory] Failed to load ${framework} client bridge:^0`, error);
    throw error;
  }
}

function detectFramework(): string | null {
  if (GetResourceState('qbx_core') === 'started') {
    return 'qbx';
  }

  if (GetResourceState('ox_core') === 'started') {
    return 'ox';
  }

  if (GetResourceState('es_extended') === 'started') {
    return 'esx';
  }

  return null;
}

// Convenience exports
export function hasGroup(group: string | Record<string, number>) {
  return getBridge().hasGroup(group);
}

export function isPlayerLoaded(): boolean {
  return getBridge().isPlayerLoaded();
}

export function isPlayerDead(): boolean {
  return getBridge().isPlayerDead();
}
