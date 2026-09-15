/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { AdminConfig } from './admin.types';
import { D1Storage } from './d1.db';
import { KvrocksStorage } from './kvrocks.db';
import { SqliteStorage } from './sqlite.db';
import { RedisStorage } from './redis.db';
import {
  ContentStat,
  EpisodeSkipConfig,
  Favorite,
  IStorage,
  PlayRecord,
  PlayStatsResult,
  Reminder,
  UserPlayStat,
} from './types';
import { UpstashRedisStorage } from './upstash.db';
import { incrementDbQuery } from './performance-monitor';

const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | 'kvrocks'
    | 'sqlite'
    | 'd1'
    | undefined) || 'localstorage';

function createStorage(): IStorage {
  switch (STORAGE_TYPE) {
    case 'd1':
      return new D1Storage();

    case 'redis':
      return new RedisStorage();

    case 'upstash':
      return new UpstashRedisStorage();

    case 'kvrocks':
      return new KvrocksStorage();

    case 'sqlite':
      if (process.env.EDGEONE_PAGES === '1') {
        throw new Error(
          '[LunaTV] SQLite storage is not supported on EdgeOne Pages. ' +
            'Please set NEXT_PUBLIC_STORAGE_TYPE to "upstash", "redis", "kvrocks", or "d1".'
        );
      }
      return new SqliteStorage();

    case 'localstorage':
    default:
      return null as unknown as IStorage;
  }
}

let storageInstance: IStorage | null = null;

function getStorage(): IStorage {
  if (!storageInstance) {
    storageInstance = createStorage();
  }

  return storageInstance;
}

export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

export class DbManager {
  private storage: IStorage;

  constructor() {
    this.storage = getStorage();

    // 旧 Redis/Kvrocks/SQLite 存储允许自行处理迁移。
    // D1 使用 migrations/*.sql，不在 Worker 启动时自动执行数据库迁移。
    if (
      this.storage &&
      typeof (this.storage as any).migrateData === 'function'
    ) {
      (this.storage as any)
        .migrateData()
        .then(async () => {
          if (typeof (this.storage as any).migratePasswords === 'function') {
            await (this.storage as any).migratePasswords();
          }
        })
        .catch((err: any) => {
          console.error('数据迁移异常:', err);
        });
    }
  }

  // ==================== 播放记录 ====================

  async getPlayRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<PlayRecord | null> {
    incrementDbQuery();

    return this.storage.getPlayRecord(
      userName,
      generateStorageKey(source, id)
    );
  }

  async savePlayRecord(
    userName: string,
    source: string,
    id: string,
    record: PlayRecord
  ): Promise<void> {
    incrementDbQuery();

    await this.storage.setPlayRecord(
      userName,
      generateStorageKey(source, id),
      record
    );
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<{ [key: string]: PlayRecord }> {
    incrementDbQuery();

    return this.storage.getAllPlayRecords(userName);
  }

  async deletePlayRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    incrementDbQuery();

    await this.storage.deletePlayRecord(
      userName,
      generateStorageKey(source, id)
    );
  }

  async savePlayRecordsBatch(
    userName: string,
    records: Array<{
      source: string;
      id: string;
      record: PlayRecord;
    }>
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    if (typeof this.storage.setPlayRecordsBatch === 'function') {
      incrementDbQuery();

      const batchData: {
        [key: string]: PlayRecord;
      } = {};

      for (const { source, id, record } of records) {
        batchData[generateStorageKey(source, id)] = record;
      }

      await this.storage.setPlayRecordsBatch(
        userName,
        batchData
      );

      return;
    }

    for (const { source, id, record } of records) {
      await this.savePlayRecord(
        userName,
        source,
        id,
        record
      );
    }
  }

  // ==================== 收藏 ====================

  async getFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<Favorite | null> {
    incrementDbQuery();

    return this.storage.getFavorite(
      userName,
      generateStorageKey(source, id)
    );
  }

  async saveFavorite(
    userName: string,
    source: string,
    id: string,
    favorite: Favorite
  ): Promise<void> {
    incrementDbQuery();

    await this.storage.setFavorite(
      userName,
      generateStorageKey(source, id),
      favorite
    );
  }

  async getAllFavorites(
    userName: string
  ): Promise<{ [key: string]: Favorite }> {
    incrementDbQuery();

    return this.storage.getAllFavorites(userName);
  }

  async deleteFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    incrementDbQuery();

    await this.storage.deleteFavorite(
      userName,
      generateStorageKey(source, id)
    );
  }

  async saveFavoritesBatch(
    userName: string,
    favorites: Array<{
      source: string;
      id: string;
      favorite: Favorite;
    }>
  ): Promise<void> {
    if (favorites.length === 0) {
      return;
    }

    if (typeof this.storage.setFavoritesBatch === 'function') {
      incrementDbQuery();

      const batchData: {
        [key: string]: Favorite;
      } = {};

      for (const { source, id, favorite } of favorites) {
        batchData[generateStorageKey(source, id)] = favorite;
      }

      await this.storage.setFavoritesBatch(
        userName,
        batchData
      );

      return;
    }

    for (const { source, id, favorite } of favorites) {
      await this.saveFavorite(
        userName,
        source,
        id,
        favorite
      );
    }
  }

  async isFavorited(
    userName: string,
    source: string,
    id: string
  ): Promise<boolean> {
    incrementDbQuery();

    const favorite = await this.getFavorite(
      userName,
      source,
      id
    );

    return favorite !== null;
  }

  // ==================== 提醒 ====================

  async getReminder(
    userName: string,
    source: string,
    id: string
  ): Promise<Reminder | null> {
    incrementDbQuery();

    return this.storage.getReminder(
      userName,
      generateStorageKey(source, id)
    );
  }

  async saveReminder(
    userName: string,
    source: string,
    id: string,
    reminder: Reminder
  ): Promise<void> {
    incrementDbQuery();

    await this.storage.setReminder(
      userName,
      generateStorageKey(source, id),
      reminder
    );
  }

  async getAllReminders(
    userName: string
  ): Promise<{ [key: string]: Reminder }> {
    incrementDbQuery();

    return this.storage.getAllReminders(userName);
  }

  async deleteReminder(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    incrementDbQuery();

    await this.storage.deleteReminder(
      userName,
      generateStorageKey(source, id)
    );
  }

  // ==================== 用户 V1 ====================

  async registerUser(
    userName: string,
    password: string
  ): Promise<void> {
    incrementDbQuery();

    await this.storage.registerUser(
      userName,
      password
    );
  }

  async verifyUser(
    userName: string,
    password: string
  ): Promise<boolean> {
    incrementDbQuery();

    return this.storage.verifyUser(
      userName,
      password
    );
  }

  async checkUserExist(
    userName: string
  ): Promise<boolean> {
    incrementDbQuery();

    return this.storage.checkUserExist(
      userName
    );
  }

  async changePassword(
    userName: string,
    newPassword: string
  ): Promise<void> {
    incrementDbQuery();

    await this.storage.changePassword(
      userName,
      newPassword
    );
  }

  async deleteUser(
    userName: string
  ): Promise<void> {
    incrementDbQuery();

    await this.storage.deleteUser(
      userName
    );
  }

  // ==================== 用户 V2 ====================

  async createUserV2(
    userName: string,
    password: string,
    role: 'owner' | 'admin' | 'user' = 'user',
    tags?: string[],
    oidcSub?: string,
    enabledApis?: string[]
  ): Promise<void> {
    incrementDbQuery();

    if (
      typeof (this.storage as any).createUserV2 ===
      'function'
    ) {
      await (this.storage as any).createUserV2(
        userName,
        password,
        role,
        tags,
        oidcSub,
        enabledApis
      );
    }
  }

  async verifyUserV2(
    userName: string,
    password: string
  ): Promise<boolean> {
    incrementDbQuery();

    if (
      typeof (this.storage as any).verifyUserV2 ===
      'function'
    ) {
      return (this.storage as any).verifyUserV2(
        userName,
        password
      );
    }

    return false;
  }

  async checkUserExistV2(
    userName: string
  ): Promise<boolean> {
    incrementDbQuery();

    if (
      typeof (this.storage as any).checkUserExistV2 ===
      'function'
    ) {
      return (this.storage as any).checkUserExistV2(
        userName
      );
    }

    return false;
  }

  async getUserByOidcSub(
    oidcSub: string
  ): Promise<string | null> {
    incrementDbQuery();

    if (
      typeof (this.storage as any).getUserByOidcSub ===
      'function'
    ) {
      return (this.storage as any).getUserByOidcSub(
        oidcSub
      );
    }

    return null;
  }

  async getUserInfoV2(
    userName: string
  ): Promise<{
    username: string;
    role: 'owner' | 'admin' | 'user';
    tags?: string[];
    enabledApis?: string[];
    banned?: boolean;
    createdAt?: number;
    oidcSub?: string;
  } | null> {
    incrementDbQuery();

    if (
      typeof (this.storage as any).getUserInfoV2 ===
      'function'
    ) {
      return (this.storage as any).getUserInfoV2(
        userName
      );
    }

    return null;
  }

  // ==================== 搜索历史 ====================

  async getSearchHistory(
    userName: string
  ): Promise<string[]> {
    incrementDbQuery();

    return this.storage.getSearchHistory(
      userName
    );
  }

  async addSearchHistory(
    userName: string,
    keyword: string
  ): Promise<void> {
    incrementDbQuery();

    await this.storage.addSearchHistory(
      userName,
      keyword
    );
  }

  async deleteSearchHistory(
    userName: string,
    keyword?: string
  ): Promise<void> {
    incrementDbQuery();

    await this.storage.deleteSearchHistory(
      userName,
      keyword
    );
  }

  async getAllUsers(): Promise<string[]> {
    incrementDbQuery();

    if (
      typeof (this.storage as any).getAllUsers ===
      'function'
    ) {
      return (this.storage as any).getAllUsers();
    }

    return [];
  }

  // ==================== 管理员配置 ====================

  async getAdminConfig(): Promise<AdminConfig | null> {
    incrementDbQuery();

    if (
      typeof (this.storage as any).getAdminConfig ===
      'function'
    ) {
      return (this.storage as any).getAdminConfig();
    }

    return null;
  }

  async saveAdminConfig(
    config: AdminConfig
  ): Promise<void> {
    incrementDbQuery();

    if (
      typeof (this.storage as any).setAdminConfig ===
      'function'
    ) {
      await (this.storage as any).setAdminConfig(
        config
      );
    }
  }

  // ==================== 跳过片头片尾 ====================

  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<EpisodeSkipConfig | null> {
    incrementDbQuery();

    if (
      typeof (this.storage as any).getSkipConfig ===
      'function'
    ) {
      return (this.storage as any).getSkipConfig(
        userName,
        source,
        id
      );
    }

    return null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: EpisodeSkipConfig
  ): Promise<void> {
    incrementDbQuery();

    if (
      typeof (this.storage as any).setSkipConfig ===
      'function'
    ) {
      await (this.storage as any).setSkipConfig(
        userName,
        source,
        id,
        config
      );
    }
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    incrementDbQuery();

    if (
      typeof (this.storage as any).deleteSkipConfig ===
      'function'
    ) {
      await (this.storage as any).deleteSkipConfig(
        userName,
        source,
        id
      );
    }
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{
    [key: string]: EpisodeSkipConfig;
  }> {
    incrementDbQuery();

    if (
      typeof (this.storage as any).getAllSkipConfigs ===
      'function'
    ) {
      return (this.storage as any).getAllSkipConfigs(
        userName
      );
    }

    return {};
  }

  // ==================== 新版剧集跳过配置 ====================

  async getEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<EpisodeSkipConfig | null> {
    incrementDbQuery();

    if (
      typeof (this.storage as any)
        .getEpisodeSkipConfig === 'function'
    ) {
      return (this.storage as any)
        .getEpisodeSkipConfig(
          userName,
          source,
          id
        );
    }

    return null;
  }

  async saveEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: EpisodeSkipConfig
  ): Promise<void> {
    incrementDbQuery();

    if (
      typeof (this.storage as any)
        .saveEpisodeSkipConfig === 'function'
    ) {
      await (this.storage as any)
        .saveEpisodeSkipConfig(
          userName,
          source,
          id,
          config
        );
    }
  }

  async deleteEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    incrementDbQuery();

    if (
      typeof (this.storage as any)
        .deleteEpisodeSkipConfig === 'function'
    ) {
      await (this.storage as any)
        .deleteEpisodeSkipConfig(
          userName,
          source,
          id
        );
    }
  }

  async getAllEpisodeSkipConfigs(
    userName: string
  ): Promise<{
    [key: string]: EpisodeSkipConfig;
  }> {
    incrementDbQuery();

    if (
      typeof (this.storage as any)
        .getAllEpisodeSkipConfigs === 'function'
    ) {
      return (this.storage as any)
        .getAllEpisodeSkipConfigs(
          userName
        );
    }

    return {};
  }

  // ==================== 清空数据 ====================

  async clearAllData(): Promise<void> {
    incrementDbQuery();

    if (
      typeof (this.storage as any).clearAllData ===
      'function'
    ) {
      await (this.storage as any).clearAllData();
    } else {
      throw new Error(
        '存储类型不支持清空数据操作'
      );
    }
  }

  // ==================== 缓存 ====================

  async getCache(
    key: string
  ): Promise<any | null> {
    incrementDbQuery();

    if (
      typeof this.storage.getCache ===
      'function'
    ) {
      return await this.storage.getCache(key);
    }

    return null;
  }

  async setCache(
    key: string,
    data: any,
    expireSeconds?: number
  ): Promise<void> {
    incrementDbQuery();

    if (
      typeof this.storage.setCache ===
      'function'
    ) {
      await this.storage.setCache(
        key,
        data,
        expireSeconds
      );
    }
  }

  async deleteCache(
    key: string
  ): Promise<void> {
    incrementDbQuery();

    if (
      typeof this.storage.deleteCache ===
      'function'
    ) {
      await this.storage.deleteCache(key);
    }
  }

  async clearExpiredCache(
    prefix?: string
  ): Promise<void> {
    incrementDbQuery();

    if (
      typeof this.storage.clearExpiredCache ===
      'function'
    ) {
      await this.storage.clearExpiredCache(prefix);
    }
  }

  // ==================== 播放统计 ====================

  async getPlayStats(): Promise<PlayStatsResult> {
    incrementDbQuery();

    if (
      typeof (this.storage as any).getPlayStats ===
      'function'
    ) {
      return (this.storage as any).getPlayStats();
    }

    return {
      totalUsers: 0,
      totalWatchTime: 0,
      totalPlays: 0,
      avgWatchTimePerUser: 0,
      avgPlaysPerUser: 0,
      userStats: [],
      topSources: [],
      dailyStats: [],
      registrationStats: {
        todayNewUsers: 0,
        totalRegisteredUsers: 0,
        registrationTrend: [],
      },
      activeUsers: {
        daily: 0,
        weekly: 0,
        monthly: 0,
      },
    };
  }

  async getUserPlayStat(
    userName: string
  ): Promise<UserPlayStat> {
    incrementDbQuery();

    if (
      typeof (this.storage as any)
        .getUserPlayStat === 'function'
    ) {
      return (this.storage as any)
        .getUserPlayStat(userName);
    }

    return {
      username: userName,
      totalWatchTime: 0,
      totalPlays: 0,
      lastPlayTime: 0,
      recentRecords: [],
      avgWatchTime: 0,
      mostWatchedSource: '',
    };
  }

  async getContentStats(
    limit = 10
  ): Promise<ContentStat[]> {
    incrementDbQuery();

    if (
      typeof (this.storage as any)
        .getContentStats === 'function'
    ) {
      return (this.storage as any)
        .getContentStats(limit);
    }

    return [];
  }

  async updatePlayStatistics(
    userName: string,
    source: string,
    id: string,
    watchTime: number
  ): Promise<void> {
    incrementDbQuery();

    if (
      typeof (this.storage as any)
        .updatePlayStatistics === 'function'
    ) {
      await (this.storage as any)
        .updatePlayStatistics(
          userName,
          source,
          id,
          watchTime
        );
    }
  }

  async updateUserLoginStats(
    userName: string,
    loginTime: number,
    isFirstLogin?: boolean,
    loginMeta?: {
      ip?: string;
      location?: string;
      device?: string;
      browser?: string;
      os?: string;
    }
  ): Promise<void> {
    incrementDbQuery();

    if (
      typeof (this.storage as any)
        .updateUserLoginStats === 'function'
    ) {
      await (this.storage as any)
        .updateUserLoginStats(
          userName,
          loginTime,
          isFirstLogin,
          loginMeta
        );
    }
  }

  // ==================== V1 → V2 ====================

  async deleteV1Password(
    userName: string
  ): Promise<void> {
    incrementDbQuery();

    // D1Storage 自己处理 D1 中的 V1 密码。
    if (
      typeof (this.storage as any)
        .deleteV1Password === 'function'
    ) {
      await (this.storage as any)
        .deleteV1Password(userName);

      return;
    }

    // 兼容 Redis / Upstash / Kvrocks 的旧逻辑。
    if (
      typeof (this.storage as any).client !==
      'undefined'
    ) {
      await (this.storage as any).client.del(
        `u:${userName}:pwd`
      );
    }
  }

  isStatsSupported(): boolean {
    const storageType =
      process.env.NEXT_PUBLIC_STORAGE_TYPE ||
      'localstorage';

    return storageType !== 'localstorage';
  }

  // ==================== Emby ====================

  async getUserEmbyConfig(
    userName: string
  ): Promise<any | null> {
    incrementDbQuery();

    if (
      typeof (this.storage as any)
        .getUserEmbyConfig === 'function'
    ) {
      return (this.storage as any)
        .getUserEmbyConfig(userName);
    }

    return null;
  }

  async saveUserEmbyConfig(
    userName: string,
    config: any
  ): Promise<void> {
    incrementDbQuery();

    if (
      typeof (this.storage as any)
        .saveUserEmbyConfig === 'function'
    ) {
      await (this.storage as any)
        .saveUserEmbyConfig(
          userName,
          config
        );
    }
  }

  async deleteUserEmbyConfig(
    userName: string
  ): Promise<void> {
    incrementDbQuery();

    if (
      typeof (this.storage as any)
        .deleteUserEmbyConfig === 'function'
    ) {
      await (this.storage as any)
        .deleteUserEmbyConfig(userName);
    }
  }

  // ==================== 崩溃日志 ====================

  async saveCrashLog(
    crashLog: any
  ): Promise<void> {
    incrementDbQuery();

    await this.storage.saveCrashLog(
      crashLog
    );
  }

  async getCrashLogs(
    limit?: number
  ): Promise<any[]> {
    incrementDbQuery();

    return this.storage.getCrashLogs(
      limit
    );
  }

  async deleteCrashLog(
    timestamp: string
  ): Promise<void> {
    incrementDbQuery();

    await this.storage.deleteCrashLog(
      timestamp
    );
  }

  async clearCrashLogs(): Promise<void> {
    incrementDbQuery();

    await this.storage.clearCrashLogs();
  }
}

export const db = new DbManager();

export const dbManager = db;
