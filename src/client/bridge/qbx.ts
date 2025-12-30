import type { ClientBridge, ClientBridgePlayerData } from './index';
import { setPlayerData } from './index';

interface QBXPlayerData {
  citizenid: string;
  charinfo: {
    firstname: string;
    lastname: string;
  };
  job: {
    name: string;
    grade: { level: number };
  };
  gang: {
    name: string;
    grade: { level: number };
  };
  metadata: {
    isdead: boolean;
    ishandcuffed: boolean;
  };
}

const QBX = {
  GetPlayerData: (): QBXPlayerData | null => exports.qbx_core?.GetPlayerData?.() ?? null,
};

export class QBXClientBridge implements ClientBridge {
  name = 'QBX';
  private dataChangeCallbacks: ((key: string, value: any) => void)[] = [];

  constructor() {
    this.registerEventHandlers();
  }

  private registerEventHandlers(): void {
    // Player loaded event
    on('QBCore:Client:OnPlayerLoaded', () => {
      const data = this.getPlayerData();
      if (data) {
        setPlayerData(data);
        this.notifyDataChange('loaded', true);
      }
    });

    // Player unloaded
    on('QBCore:Client:OnPlayerUnload', () => {
      setPlayerData(null);
      this.notifyDataChange('loaded', false);
    });

    // Job update
    on('QBCore:Client:OnJobUpdate', (job: any) => {
      const data = this.getPlayerData();
      if (data) {
        data.groups[job.name] = job.grade?.level ?? 0;
        setPlayerData(data);
        this.notifyDataChange('groups', data.groups);
      }
    });

    // Gang update
    on('QBCore:Client:OnGangUpdate', (gang: any) => {
      const data = this.getPlayerData();
      if (data) {
        data.groups[gang.name] = gang.grade?.level ?? 0;
        setPlayerData(data);
        this.notifyDataChange('groups', data.groups);
      }
    });

    // Death state
    AddStateBagChangeHandler('isDead', `player:${GetPlayerServerId(PlayerId())}`, (_: string, __: string, value: boolean) => {
      const data = this.getPlayerData();
      if (data) {
        data.dead = value;
        setPlayerData(data);
        this.notifyDataChange('dead', value);
      }
    });
  }

  private notifyDataChange(key: string, value: any): void {
    for (const callback of this.dataChangeCallbacks) {
      try {
        callback(key, value);
      } catch (error) {
        console.error('[ox_inventory] Error in player data change callback:', error);
      }
    }
  }

  getPlayerData(): ClientBridgePlayerData | null {
    const qbxData = QBX.GetPlayerData();
    if (!qbxData) return null;

    const groups: Record<string, number> = {};

    // Add job
    if (qbxData.job?.name) {
      groups[qbxData.job.name] = qbxData.job.grade?.level ?? 0;
    }

    // Add gang
    if (qbxData.gang?.name && qbxData.gang.name !== 'none') {
      groups[qbxData.gang.name] = qbxData.gang.grade?.level ?? 0;
    }

    return {
      source: GetPlayerServerId(PlayerId()),
      name: `${qbxData.charinfo.firstname} ${qbxData.charinfo.lastname}`,
      groups,
      loaded: true,
      dead: qbxData.metadata?.isdead ?? false,
      cuffed: qbxData.metadata?.ishandcuffed ?? false,
    };
  }

  hasGroup(group: string | Record<string, number>): [string | undefined, number | undefined] {
    const data = this.getPlayerData();
    if (!data) return [undefined, undefined];

    if (typeof group === 'string') {
      const rank = data.groups[group];
      if (rank !== undefined) {
        return [group, rank];
      }
    } else {
      for (const [name, requiredRank] of Object.entries(group)) {
        const playerRank = data.groups[name];
        if (playerRank !== undefined && playerRank >= (requiredRank ?? 0)) {
          return [name, playerRank];
        }
      }
    }

    return [undefined, undefined];
  }

  onPlayerDataChange(callback: (key: string, value: any) => void): void {
    this.dataChangeCallbacks.push(callback);
  }

  isPlayerLoaded(): boolean {
    return QBX.GetPlayerData() !== null;
  }

  isPlayerDead(): boolean {
    const data = QBX.GetPlayerData();
    return data?.metadata?.isdead ?? false;
  }

  setPlayerStatus(status: Record<string, number>): void {
    for (const [key, value] of Object.entries(status)) {
      // QBX uses metadata for status
      TriggerServerEvent('QBCore:Server:SetMetaData', key, value);
    }
  }
}
