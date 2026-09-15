/* eslint-disable @typescript-eslint/no-explicit-any */
import type { D1Database } from '@cloudflare/workers-types';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { AdminConfig } from './admin.types';
import {
  ContentStat,
  CrashLog,
  EpisodeSkipConfig,
  Favorite,
  IStorage,
  PlayRecord,
  PlayStatsResult,
  Reminder,
  UserPlayStat,
} from './types';
import {
  hashPassword,
  verifyPassword,
} from './password';

type D1Row = Record<string, any>;

function getDB(): D1Database {
  const { env } = getCloudflareContext();

  const db = (env as any).DB as D1Database | undefined;

  if (!db) {
    throw new Error(
      '[LunaTV] D1 binding "DB" not found. Please configure [[d1_databases]] in wrangler.toml.'
    );
  }

  return db;
}

function parseJson<T>(
  value: unknown,
  fallback: T
): T {
  if (typeof value !== 'string') {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function now(): number {
  return Date.now();
}

export class D1Storage implements IStorage {
  // ==================== 播放记录 ====================

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const row = await getDB()
      .prepare(
        `
        SELECT value
        FROM play_records
        WHERE username = ? AND key = ?
        LIMIT 1
        `
      )
      .bind(userName, key)
      .first<D1Row>();

    if (!row) {
      return null;
    }

    return parseJson<PlayRecord | null>(
      row.value,
      null
    );
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        INSERT INTO play_records
          (username, key, value)
        VALUES (?, ?, ?)
        ON CONFLICT(username, key)
        DO UPDATE SET value = excluded.value
        `
      )
      .bind(
        userName,
        key,
        JSON.stringify(record)
      )
      .run();
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<{
    [key: string]: PlayRecord;
  }> {
    const result = await getDB()
      .prepare(
        `
        SELECT key, value
        FROM play_records
        WHERE username = ?
        `
      )
      .bind(userName)
      .all<D1Row>();

    const records: {
      [key: string]: PlayRecord;
    } = {};

    for (const row of result.results) {
      const value =
        parseJson<PlayRecord | null>(
          row.value,
          null
        );

      if (value) {
        records[row.key] = value;
      }
    }

    return records;
  }

  async deletePlayRecord(
    userName: string,
    key: string
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        DELETE FROM play_records
        WHERE username = ? AND key = ?
        `
      )
      .bind(userName, key)
      .run();
  }

  async setPlayRecordsBatch(
    userName: string,
    records: {
      [key: string]: PlayRecord;
    }
  ): Promise<void> {
    const db = getDB();

    const statements = Object.entries(
      records
    ).map(([key, record]) =>
      db
        .prepare(
          `
          INSERT INTO play_records
            (username, key, value)
          VALUES (?, ?, ?)
          ON CONFLICT(username, key)
          DO UPDATE SET value = excluded.value
          `
        )
        .bind(
          userName,
          key,
          JSON.stringify(record)
        )
    );

    if (statements.length > 0) {
      await db.batch(statements);
    }
  }

  // ==================== 收藏 ====================

  async getFavorite(
    userName: string,
    key: string
  ): Promise<Favorite | null> {
    const row = await getDB()
      .prepare(
        `
        SELECT value
        FROM favorites
        WHERE username = ? AND key = ?
        LIMIT 1
        `
      )
      .bind(userName, key)
      .first<D1Row>();

    if (!row) {
      return null;
    }

    return parseJson<Favorite | null>(
      row.value,
      null
    );
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        INSERT INTO favorites
          (username, key, value)
        VALUES (?, ?, ?)
        ON CONFLICT(username, key)
        DO UPDATE SET value = excluded.value
        `
      )
      .bind(
        userName,
        key,
        JSON.stringify(favorite)
      )
      .run();
  }

  async getAllFavorites(
    userName: string
  ): Promise<{
    [key: string]: Favorite;
  }> {
    const result = await getDB()
      .prepare(
        `
        SELECT key, value
        FROM favorites
        WHERE username = ?
        `
      )
      .bind(userName)
      .all<D1Row>();

    const favorites: {
      [key: string]: Favorite;
    } = {};

    for (const row of result.results) {
      const value =
        parseJson<Favorite | null>(
          row.value,
          null
        );

      if (value) {
        favorites[row.key] = value;
      }
    }

    return favorites;
  }

  async deleteFavorite(
    userName: string,
    key: string
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        DELETE FROM favorites
        WHERE username = ? AND key = ?
        `
      )
      .bind(userName, key)
      .run();
  }

  async setFavoritesBatch(
    userName: string,
    favorites: {
      [key: string]: Favorite;
    }
  ): Promise<void> {
    const db = getDB();

    const statements = Object.entries(
      favorites
    ).map(([key, favorite]) =>
      db
        .prepare(
          `
          INSERT INTO favorites
            (username, key, value)
          VALUES (?, ?, ?)
          ON CONFLICT(username, key)
          DO UPDATE SET value = excluded.value
          `
        )
        .bind(
          userName,
          key,
          JSON.stringify(favorite)
        )
    );

    if (statements.length > 0) {
      await db.batch(statements);
    }
  }

  // ==================== 提醒 ====================

  async getReminder(
    userName: string,
    key: string
  ): Promise<Reminder | null> {
    const row = await getDB()
      .prepare(
        `
        SELECT value
        FROM reminders
        WHERE username = ? AND key = ?
        LIMIT 1
        `
      )
      .bind(userName, key)
      .first<D1Row>();

    if (!row) {
      return null;
    }

    return parseJson<Reminder | null>(
      row.value,
      null
    );
  }

  async setReminder(
    userName: string,
    key: string,
    reminder: Reminder
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        INSERT INTO reminders
          (username, key, value)
        VALUES (?, ?, ?)
        ON CONFLICT(username, key)
        DO UPDATE SET value = excluded.value
        `
      )
      .bind(
        userName,
        key,
        JSON.stringify(reminder)
      )
      .run();
  }

  async getAllReminders(
    userName: string
  ): Promise<{
    [key: string]: Reminder;
  }> {
    const result = await getDB()
      .prepare(
        `
        SELECT key, value
        FROM reminders
        WHERE username = ?
        `
      )
      .bind(userName)
      .all<D1Row>();

    const reminders: {
      [key: string]: Reminder;
    } = {};

    for (const row of result.results) {
      const value =
        parseJson<Reminder | null>(
          row.value,
          null
        );

      if (value) {
        reminders[row.key] = value;
      }
    }

    return reminders;
  }

  async deleteReminder(
    userName: string,
    key: string
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        DELETE FROM reminders
        WHERE username = ? AND key = ?
        `
      )
      .bind(userName, key)
      .run();
  }

  // ==================== 用户 V1 ====================

  async registerUser(
    userName: string,
    password: string
  ): Promise<void> {
    const passwordHash =
      hashPassword(password);

    await getDB()
      .prepare(
        `
        INSERT INTO users
          (username, password_hash, created_at)
        VALUES (?, ?, ?)
        `
      )
      .bind(
        userName,
        passwordHash,
        now()
      )
      .run();
  }

  async verifyUser(
    userName: string,
    password: string
  ): Promise<boolean> {
    const row = await getDB()
      .prepare(
        `
        SELECT password_hash
        FROM users
        WHERE username = ?
        LIMIT 1
        `
      )
      .bind(userName)
      .first<D1Row>();

    if (!row) {
      return false;
    }

    return verifyPassword(
      password,
      String(row.password_hash)
    );
  }

  async checkUserExist(
    userName: string
  ): Promise<boolean> {
    const row = await getDB()
      .prepare(
        `
        SELECT username
        FROM users
        WHERE username = ?
        LIMIT 1
        `
      )
      .bind(userName)
      .first<D1Row>();

    return !!row;
  }

  async changePassword(
    userName: string,
    newPassword: string
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        UPDATE users
        SET password_hash = ?
        WHERE username = ?
        `
      )
      .bind(
        hashPassword(newPassword),
        userName
      )
      .run();

    await getDB()
      .prepare(
        `
        UPDATE users_v2
        SET password = ?
        WHERE username = ?
        `
      )
      .bind(
        hashPassword(newPassword),
        userName
      )
      .run();
  }

  async deleteUser(
    userName: string
  ): Promise<void> {
    const db = getDB();

    await db.batch([
      db
        .prepare(
          `DELETE FROM users WHERE username = ?`
        )
        .bind(userName),

      db
        .prepare(
          `DELETE FROM users_v2 WHERE username = ?`
        )
        .bind(userName),

      db
        .prepare(
          `DELETE FROM play_records WHERE username = ?`
        )
        .bind(userName),

      db
        .prepare(
          `DELETE FROM favorites WHERE username = ?`
        )
        .bind(userName),

      db
        .prepare(
          `DELETE FROM reminders WHERE username = ?`
        )
        .bind(userName),

      db
        .prepare(
          `DELETE FROM search_history WHERE username = ?`
        )
        .bind(userName),

      db
        .prepare(
          `DELETE FROM skip_configs WHERE username = ?`
        )
        .bind(userName),

      db
        .prepare(
          `DELETE FROM episode_skip_configs WHERE username = ?`
        )
        .bind(userName),

      db
        .prepare(
          `DELETE FROM login_stats WHERE username = ?`
        )
        .bind(userName),

      db
        .prepare(
          `DELETE FROM emby_configs WHERE username = ?`
        )
        .bind(userName),
    ]);
  }

  // ==================== 用户 V2 ====================

  async createUserV2(
    userName: string,
    password: string,
    role:
      | 'owner'
      | 'admin'
      | 'user' = 'user',
    tags?: string[],
    oidcSub?: string,
    enabledApis?: string[]
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        INSERT INTO users_v2
          (
            username,
            password,
            role,
            banned,
            tags,
            enabled_apis,
            oidc_sub,
            created_at
          )
        VALUES (?, ?, ?, 0, ?, ?, ?, ?)
        ON CONFLICT(username)
        DO UPDATE SET
          password = excluded.password,
          role = excluded.role,
          tags = excluded.tags,
          enabled_apis = excluded.enabled_apis,
          oidc_sub = excluded.oidc_sub
        `
      )
      .bind(
        userName,
        hashPassword(password),
        role,
        tags
          ? JSON.stringify(tags)
          : null,
        enabledApis
          ? JSON.stringify(enabledApis)
          : null,
        oidcSub ?? null,
        now()
      )
      .run();
  }

  async verifyUserV2(
    userName: string,
    password: string
  ): Promise<boolean> {
    const row = await getDB()
      .prepare(
        `
        SELECT password, banned
        FROM users_v2
        WHERE username = ?
        LIMIT 1
        `
      )
      .bind(userName)
      .first<D1Row>();

    if (!row) {
      return false;
    }

    if (Number(row.banned) === 1) {
      return false;
    }

    return verifyPassword(
      password,
      String(row.password)
    );
  }

  async checkUserExistV2(
    userName: string
  ): Promise<boolean> {
    const row = await getDB()
      .prepare(
        `
        SELECT username
        FROM users_v2
        WHERE username = ?
        LIMIT 1
        `
      )
      .bind(userName)
      .first<D1Row>();

    return !!row;
  }

  async getUserByOidcSub(
    oidcSub: string
  ): Promise<string | null> {
    const row = await getDB()
      .prepare(
        `
        SELECT username
        FROM users_v2
        WHERE oidc_sub = ?
        LIMIT 1
        `
      )
      .bind(oidcSub)
      .first<D1Row>();

    return row
      ? String(row.username)
      : null;
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
    const row = await getDB()
      .prepare(
        `
        SELECT
          username,
          role,
          banned,
          tags,
          enabled_apis,
          oidc_sub,
          created_at
        FROM users_v2
        WHERE username = ?
        LIMIT 1
        `
      )
      .bind(userName)
      .first<D1Row>();

    if (!row) {
      return null;
    }

    return {
      username: String(row.username),
      role: row.role as
        | 'owner'
        | 'admin'
        | 'user',
      tags: parseJson<string[] | undefined>(
        row.tags,
        undefined
      ),
      enabledApis:
        parseJson<string[] | undefined>(
          row.enabled_apis,
          undefined
        ),
      banned: Number(row.banned) === 1,
      createdAt: Number(row.created_at),
      oidcSub:
        row.oidc_sub == null
          ? undefined
          : String(row.oidc_sub),
    };
  }

  // ==================== 搜索历史 ====================

  async getSearchHistory(
    userName: string
  ): Promise<string[]> {
    const result = await getDB()
      .prepare(
        `
        SELECT keyword
        FROM search_history
        WHERE username = ?
        ORDER BY created_at DESC
        LIMIT 20
        `
      )
      .bind(userName)
      .all<D1Row>();

    return result.results.map(
      (row) => String(row.keyword)
    );
  }

  async addSearchHistory(
    userName: string,
    keyword: string
  ): Promise<void> {
    const trimmed = keyword.trim();

    if (!trimmed) {
      return;
    }

    const db = getDB();
    const timestamp = now();

    await db
      .prepare(
        `
        INSERT INTO search_history
          (username, keyword, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(username, keyword)
        DO UPDATE SET created_at = excluded.created_at
        `
      )
      .bind(
        userName,
        trimmed,
        timestamp
      )
      .run();

    // 保持每个用户最多 20 条。
    await db
      .prepare(
        `
        DELETE FROM search_history
        WHERE username = ?
        AND keyword NOT IN (
          SELECT keyword
          FROM search_history
          WHERE username = ?
          ORDER BY created_at DESC
          LIMIT 20
        )
        `
      )
      .bind(
        userName,
        userName
      )
      .run();
  }

  async deleteSearchHistory(
    userName: string,
    keyword?: string
  ): Promise<void> {
    if (keyword) {
      await getDB()
        .prepare(
          `
          DELETE FROM search_history
          WHERE username = ? AND keyword = ?
          `
        )
        .bind(
          userName,
          keyword
        )
        .run();

      return;
    }

    await getDB()
      .prepare(
        `
        DELETE FROM search_history
        WHERE username = ?
        `
      )
      .bind(userName)
      .run();
  }

  async getAllUsers(): Promise<string[]> {
    const result = await getDB()
      .prepare(
        `
        SELECT username
        FROM users_v2
        UNION
        SELECT username
        FROM users
        ORDER BY username ASC
        `
      )
      .all<D1Row>();

    return result.results.map(
      (row) => String(row.username)
    );
  }

  // ==================== 管理员配置 ====================

  async getAdminConfig(): Promise<AdminConfig | null> {
    const row = await getDB()
      .prepare(
        `
        SELECT value
        FROM admin_config
        WHERE id = 1
        LIMIT 1
        `
      )
      .first<D1Row>();

    if (!row) {
      return null;
    }

    return parseJson<AdminConfig | null>(
      row.value,
      null
    );
  }

  async setAdminConfig(
    config: AdminConfig
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        INSERT INTO admin_config
          (id, value)
        VALUES (1, ?)
        ON CONFLICT(id)
        DO UPDATE SET value = excluded.value
        `
      )
      .bind(
        JSON.stringify(config)
      )
      .run();
  }

  // ==================== 跳过配置 ====================

  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<EpisodeSkipConfig | null> {
    const row = await getDB()
      .prepare(
        `
        SELECT value
        FROM skip_configs
        WHERE username = ?
          AND source = ?
          AND id = ?
        LIMIT 1
        `
      )
      .bind(
        userName,
        source,
        id
      )
      .first<D1Row>();

    if (!row) {
      return null;
    }

    return parseJson<
      EpisodeSkipConfig | null
    >(row.value, null);
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: EpisodeSkipConfig
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        INSERT INTO skip_configs
          (username, source, id, value)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(username, source, id)
        DO UPDATE SET value = excluded.value
        `
      )
      .bind(
        userName,
        source,
        id,
        JSON.stringify(config)
      )
      .run();
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        DELETE FROM skip_configs
        WHERE username = ?
          AND source = ?
          AND id = ?
        `
      )
      .bind(
        userName,
        source,
        id
      )
      .run();
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{
    [key: string]: EpisodeSkipConfig;
  }> {
    const result = await getDB()
      .prepare(
        `
        SELECT source, id, value
        FROM skip_configs
        WHERE username = ?
        `
      )
      .bind(userName)
      .all<D1Row>();

    const configs: {
      [key: string]: EpisodeSkipConfig;
    } = {};

    for (const row of result.results) {
      const key = `${row.source}+${row.id}`;

      const config =
        parseJson<EpisodeSkipConfig | null>(
          row.value,
          null
        );

      if (config) {
        configs[key] = config;
      }
    }

    return configs;
  }

  // ==================== 新版剧集跳过 ====================

  async getEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<EpisodeSkipConfig | null> {
    const row = await getDB()
      .prepare(
        `
        SELECT value
        FROM episode_skip_configs
        WHERE username = ?
          AND source = ?
          AND id = ?
        LIMIT 1
        `
      )
      .bind(
        userName,
        source,
        id
      )
      .first<D1Row>();

    if (!row) {
      return null;
    }

    return parseJson<
      EpisodeSkipConfig | null
    >(row.value, null);
  }

  async saveEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: EpisodeSkipConfig
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        INSERT INTO episode_skip_configs
          (username, source, id, value)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(username, source, id)
        DO UPDATE SET value = excluded.value
        `
      )
      .bind(
        userName,
        source,
        id,
        JSON.stringify(config)
      )
      .run();
  }

  async deleteEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        DELETE FROM episode_skip_configs
        WHERE username = ?
          AND source = ?
          AND id = ?
        `
      )
      .bind(
        userName,
        source,
        id
      )
      .run();
  }

  async getAllEpisodeSkipConfigs(
    userName: string
  ): Promise<{
    [key: string]: EpisodeSkipConfig;
  }> {
    const result = await getDB()
      .prepare(
        `
        SELECT source, id, value
        FROM episode_skip_configs
        WHERE username = ?
        `
      )
      .bind(userName)
      .all<D1Row>();

    const configs: {
      [key: string]: EpisodeSkipConfig;
    } = {};

    for (const row of result.results) {
      const key = `${row.source}+${row.id}`;

      const config =
        parseJson<EpisodeSkipConfig | null>(
          row.value,
          null
        );

      if (config) {
        configs[key] = config;
      }
    }

    return configs;
  }

  // ==================== 清空所有数据 ====================

  async clearAllData(): Promise<void> {
    const db = getDB();

    await db.batch([
      db.prepare(`DELETE FROM users`),
      db.prepare(`DELETE FROM users_v2`),
      db.prepare(`DELETE FROM play_records`),
      db.prepare(`DELETE FROM favorites`),
      db.prepare(`DELETE FROM reminders`),
      db.prepare(`DELETE FROM search_history`),
      db.prepare(`DELETE FROM skip_configs`),
      db.prepare(
        `DELETE FROM episode_skip_configs`
      ),
      db.prepare(`DELETE FROM admin_config`),
      db.prepare(`DELETE FROM cache`),
      db.prepare(`DELETE FROM login_stats`),
      db.prepare(`DELETE FROM emby_configs`),
      db.prepare(`DELETE FROM crash_logs`),
    ]);
  }

  // ==================== 缓存 ====================

  async getCache(
    key: string
  ): Promise<any | null> {
    const row = await getDB()
      .prepare(
        `
        SELECT value, expires_at
        FROM cache
        WHERE key = ?
        LIMIT 1
        `
      )
      .bind(key)
      .first<D1Row>();

    if (!row) {
      return null;
    }

    if (
      row.expires_at !== null &&
      row.expires_at !== undefined &&
      Number(row.expires_at) <= now()
    ) {
      await this.deleteCache(key);
      return null;
    }

    return parseJson(
      row.value,
      null
    );
  }

  async setCache(
    key: string,
    data: any,
    expireSeconds?: number
  ): Promise<void> {
    const expiresAt =
      expireSeconds &&
      expireSeconds > 0
        ? now() + expireSeconds * 1000
        : null;

    await getDB()
      .prepare(
        `
        INSERT INTO cache
          (key, value, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key)
        DO UPDATE SET
          value = excluded.value,
          expires_at = excluded.expires_at
        `
      )
      .bind(
        key,
        JSON.stringify(data),
        expiresAt
      )
      .run();
  }

  async deleteCache(
    key: string
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        DELETE FROM cache
        WHERE key = ?
        `
      )
      .bind(key)
      .run();
  }

  async clearExpiredCache(
    prefix?: string
  ): Promise<void> {
    const db = getDB();

    if (prefix) {
      await db
        .prepare(
          `
          DELETE FROM cache
          WHERE expires_at IS NOT NULL
            AND expires_at <= ?
            AND key LIKE ?
          `
        )
        .bind(
          now(),
          `${prefix}%`
        )
        .run();

      return;
    }

    await db
      .prepare(
        `
        DELETE FROM cache
        WHERE expires_at IS NOT NULL
          AND expires_at <= ?
        `
      )
      .bind(now())
      .run();
  }

  // ==================== 播放统计 ====================

  async getPlayStats(): Promise<PlayStatsResult> {
    const users = await this.getAllUsers();

    const userStats: UserPlayStat[] = [];

    let totalWatchTime = 0;
    let totalPlays = 0;

    const sourceMap = new Map<
      string,
      {
        plays: number;
        watchTime: number;
      }
    >();

    for (const username of users) {
      const stat =
        await this.getUserPlayStat(
          username
        );

      userStats.push(stat);

      totalWatchTime +=
        stat.totalWatchTime;

      totalPlays +=
        stat.totalPlays;

      for (const record of stat.recentRecords) {
        const source =
          record.source_name || '';

        const existing =
          sourceMap.get(source) || {
            plays: 0,
            watchTime: 0,
          };

        existing.plays += 1;

        existing.watchTime +=
          Number(record.play_time || 0);

        sourceMap.set(
          source,
          existing
        );
      }
    }

    const topSources = Array.from(
      sourceMap.entries()
    )
      .map(
        ([source, value]) => ({
          source,
          plays: value.plays,
          watchTime: value.watchTime,
        })
      )
      .sort(
        (a, b) =>
          b.plays - a.plays
      )
      .slice(0, 10);

    return {
      totalUsers: users.length,
      totalWatchTime,
      totalPlays,
      avgWatchTimePerUser:
        users.length > 0
          ? totalWatchTime /
            users.length
          : 0,
      avgPlaysPerUser:
        users.length > 0
          ? totalPlays /
            users.length
          : 0,
      userStats,
      topSources,
      dailyStats: [],
      registrationStats: {
        todayNewUsers: 0,
        totalRegisteredUsers:
          users.length,
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
    const result = await getDB()
      .prepare(
        `
        SELECT value
        FROM play_records
        WHERE username = ?
        ORDER BY json_extract(value, '$.save_time') DESC
        `
      )
      .bind(userName)
      .all<D1Row>();

    const records: PlayRecord[] = [];

    for (const row of result.results) {
      const record =
        parseJson<PlayRecord | null>(
          row.value,
          null
        );

      if (record) {
        records.push(record);
      }
    }

    const totalWatchTime =
      records.reduce(
        (sum, record) =>
          sum +
          Number(
            record.play_time || 0
          ),
        0
      );

    const totalPlays =
      records.length;

    const lastPlayTime =
      records.length > 0
        ? Number(
            records[0].save_time || 0
          )
        : 0;

    const sourceCount =
      new Map<string, number>();

    for (const record of records) {
      const source =
        record.source_name || '';

      sourceCount.set(
        source,
        (sourceCount.get(source) || 0) +
          1
      );
    }

    let mostWatchedSource = '';

    for (const [
      source,
      count,
    ] of sourceCount.entries()) {
      if (
        !mostWatchedSource ||
        count >
          (sourceCount.get(
            mostWatchedSource
          ) || 0)
      ) {
        mostWatchedSource = source;
      }
    }

    return {
      username: userName,
      totalWatchTime,
      totalPlays,
      lastPlayTime,
      recentRecords: records.slice(
        0,
        20
      ),
      avgWatchTime:
        totalPlays > 0
          ? totalWatchTime /
            totalPlays
          : 0,
      mostWatchedSource,
    };
  }

  async getContentStats(
    limit = 10
  ): Promise<ContentStat[]> {
    const result = await getDB()
      .prepare(
        `
        SELECT
          key,
          COUNT(*) AS play_count
        FROM play_records
        GROUP BY key
        ORDER BY play_count DESC
        LIMIT ?
        `
      )
      .bind(limit)
      .all<D1Row>();

    return result.results.map(
      (row) => ({
        key: String(row.key),
        count: Number(
          row.play_count
        ),
      }) as unknown as ContentStat
    );
  }

  async updatePlayStatistics(
    userName: string,
    source: string,
    id: string,
    watchTime: number
  ): Promise<void> {
    const key = `${source}+${id}`;

    const row = await getDB()
      .prepare(
        `
        SELECT value
        FROM play_records
        WHERE username = ?
          AND key = ?
        LIMIT 1
        `
      )
      .bind(
        userName,
        key
      )
      .first<D1Row>();

    if (!row) {
      return;
    }

    const record =
      parseJson<PlayRecord | null>(
        row.value,
        null
      );

    if (!record) {
      return;
    }

    record.play_time =
      Number(watchTime);

    record.save_time =
      now();

    await this.setPlayRecord(
      userName,
      key,
      record
    );
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
    const db = getDB();

    const existing = await db
      .prepare(
        `
        SELECT login_count
        FROM login_stats
        WHERE username = ?
        LIMIT 1
        `
      )
      .bind(userName)
      .first<D1Row>();

    const currentCount =
      existing
        ? Number(
            existing.login_count || 0
          )
        : 0;

    const loginCount =
      currentCount + 1;

    await db
      .prepare(
        `
        INSERT INTO login_stats
        (
          username,
          login_count,
          first_login_time,
          last_login_time,
          last_login_date,
          last_login_ip,
          last_login_location,
          last_login_device,
          last_login_browser,
          last_login_os
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(username)
        DO UPDATE SET
          login_count = excluded.login_count,
          last_login_time = excluded.last_login_time,
          last_login_date = excluded.last_login_date,
          last_login_ip = excluded.last_login_ip,
          last_login_location = excluded.last_login_location,
          last_login_device = excluded.last_login_device,
          last_login_browser = excluded.last_login_browser,
          last_login_os = excluded.last_login_os
        `
      )
      .bind(
        userName,
        loginCount,
        existing
          ? null
          : loginTime,
        loginTime,
        loginTime,
        loginMeta?.ip ?? null,
        loginMeta?.location ?? null,
        loginMeta?.device ?? null,
        loginMeta?.browser ?? null,
        loginMeta?.os ?? null
      )
      .run();

    void isFirstLogin;
  }

  // ==================== V1 密码删除 ====================

  async deleteV1Password(
    userName: string
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        DELETE FROM users
        WHERE username = ?
        `
      )
      .bind(userName)
      .run();
  }

  // ==================== Emby ====================

  async getUserEmbyConfig(
    userName: string
  ): Promise<any | null> {
    const row = await getDB()
      .prepare(
        `
        SELECT value
        FROM emby_configs
        WHERE username = ?
        LIMIT 1
        `
      )
      .bind(userName)
      .first<D1Row>();

    if (!row) {
      return null;
    }

    return parseJson(
      row.value,
      null
    );
  }

  async saveUserEmbyConfig(
    userName: string,
    config: any
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        INSERT INTO emby_configs
          (username, value)
        VALUES (?, ?)
        ON CONFLICT(username)
        DO UPDATE SET value = excluded.value
        `
      )
      .bind(
        userName,
        JSON.stringify(config)
      )
      .run();
  }

  async deleteUserEmbyConfig(
    userName: string
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        DELETE FROM emby_configs
        WHERE username = ?
        `
      )
      .bind(userName)
      .run();
  }

  // ==================== 崩溃日志 ====================

  async saveCrashLog(
    crashLog: CrashLog
  ): Promise<void> {
    const timestamp =
      String(
        (crashLog as any).timestamp ??
          now()
      );

    await getDB()
      .prepare(
        `
        INSERT INTO crash_logs
          (timestamp, value, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(timestamp)
        DO UPDATE SET
          value = excluded.value,
          created_at = excluded.created_at
        `
      )
      .bind(
        timestamp,
        JSON.stringify(crashLog),
        now()
      )
      .run();
  }

  async getCrashLogs(
    limit = 100
  ): Promise<CrashLog[]> {
    const result = await getDB()
      .prepare(
        `
        SELECT value
        FROM crash_logs
        ORDER BY created_at DESC
        LIMIT ?
        `
      )
      .bind(limit)
      .all<D1Row>();

    return result.results
      .map((row) =>
        parseJson<CrashLog | null>(
          row.value,
          null
        )
      )
      .filter(
        (
          value
        ): value is CrashLog =>
          value !== null
      );
  }

  async deleteCrashLog(
    timestamp: string
  ): Promise<void> {
    await getDB()
      .prepare(
        `
        DELETE FROM crash_logs
        WHERE timestamp = ?
        `
      )
      .bind(timestamp)
      .run();
  }

  async clearCrashLogs(): Promise<void> {
    await getDB()
      .prepare(
        `DELETE FROM crash_logs`
      )
      .run();
  }
}
