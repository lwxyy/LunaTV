/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { getCloudflareContext } from '@opennextjs/cloudflare';
import { createHash } from 'crypto';

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
  isHashed,
} from './password';

type D1Result<T = any> = {
  results?: T[];
  success?: boolean;
  meta?: any;
};

type D1DatabaseLike = {
  prepare(query: string): any;
  batch(statements: any[]): Promise<any[]>;
  exec(query: string): Promise<any>;
};

function getDB(): D1DatabaseLike {
  const { env } = getCloudflareContext();

  if (!env || !(env as any).DB) {
    throw new Error(
      '[LunaTV] Cloudflare D1 binding "DB" not found. ' +
        'Please configure [[d1_databases]] binding = "DB" in wrangler.toml.'
    );
  }

  return (env as any).DB as D1DatabaseLike;
}

function parseJSON<T>(value: string | null | undefined): T | null {
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function toJSON(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

export class D1Storage implements IStorage {
  // ============================================================
  // 初始化
  // ============================================================

  async initTables(): Promise<void> {
    const db = getDB();

    await db.batch([
      db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
          username TEXT PRIMARY KEY,
          password_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `),

      db.prepare(`
        CREATE TABLE IF NOT EXISTS users_v2 (
          username TEXT PRIMARY KEY,
          password TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user',
          banned INTEGER NOT NULL DEFAULT 0,
          tags TEXT,
          enabled_apis TEXT,
          oidc_sub TEXT,
          created_at INTEGER NOT NULL
        )
      `),

      db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_users_v2_oidc_sub
        ON users_v2(oidc_sub)
      `),

      db.prepare(`
        CREATE TABLE IF NOT EXISTS play_records (
          username TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (username, key)
        )
      `),

      db.prepare(`
        CREATE TABLE IF NOT EXISTS favorites (
          username TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (username, key)
        )
      `),

      db.prepare(`
        CREATE TABLE IF NOT EXISTS reminders (
          username TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (username, key)
        )
      `),

      db.prepare(`
        CREATE TABLE IF NOT EXISTS search_history (
          username TEXT NOT NULL,
          keyword TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (username, keyword)
        )
      `),

      db.prepare(`
        CREATE TABLE IF NOT EXISTS skip_configs (
          username TEXT NOT NULL,
          source TEXT NOT NULL,
          id TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (username, source, id)
        )
      `),

      db.prepare(`
        CREATE TABLE IF NOT EXISTS episode_skip_configs (
          username TEXT NOT NULL,
          source TEXT NOT NULL,
          id TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (username, source, id)
        )
      `),

      db.prepare(`
        CREATE TABLE IF NOT EXISTS admin_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          value TEXT NOT NULL
        )
      `),

      db.prepare(`
        CREATE TABLE IF NOT EXISTS cache (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          expires_at INTEGER
        )
      `),

      db.prepare(`
        CREATE TABLE IF NOT EXISTS login_stats (
          username TEXT PRIMARY KEY,
          login_count INTEGER NOT NULL DEFAULT 0,
          first_login_time INTEGER,
          last_login_time INTEGER,
          last_login_date INTEGER,
          last_login_ip TEXT,
          last_login_location TEXT,
          last_login_device TEXT,
          last_login_browser TEXT,
          last_login_os TEXT
        )
      `),

      db.prepare(`
        CREATE TABLE IF NOT EXISTS emby_configs (
          username TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `),

      db.prepare(`
        CREATE TABLE IF NOT EXISTS crash_logs (
          timestamp TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `),

      db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_play_records_username
        ON play_records(username)
      `),

      db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_favorites_username
        ON favorites(username)
      `),

      db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_reminders_username
        ON reminders(username)
      `),

      db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_search_history_username
        ON search_history(username, created_at DESC)
      `),

      db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_skip_configs_username
        ON skip_configs(username)
      `),

      db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_episode_skip_configs_username
        ON episode_skip_configs(username)
      `),

      db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_login_stats_last_login
        ON login_stats(last_login_time)
      `),

      db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_crash_logs_created_at
        ON crash_logs(created_at DESC)
      `),
    ]);
  }

  // ============================================================
  // 播放记录
  // ============================================================

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const db = getDB();

    const row = await db
      .prepare(`
        SELECT value
        FROM play_records
        WHERE username = ? AND key = ?
      `)
      .bind(userName, key)
      .first();

    return parseJSON<PlayRecord>(row?.value);
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    const db = getDB();

    await db
      .prepare(`
        INSERT INTO play_records (username, key, value)
        VALUES (?, ?, ?)
        ON CONFLICT(username, key)
        DO UPDATE SET value = excluded.value
      `)
      .bind(userName, key, toJSON(record))
      .run();

    await this.deleteCache('play_stats_summary');
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<{ [key: string]: PlayRecord }> {
    const db = getDB();

    const result = (await db
      .prepare(`
        SELECT key, value
        FROM play_records
        WHERE username = ?
      `)
      .bind(userName)
      .all()) as D1Result<{ key: string; value: string }>;

    const records: { [key: string]: PlayRecord } = {};

    for (const row of result.results || []) {
      const record = parseJSON<PlayRecord>(row.value);

      if (record) {
        records[row.key] = record;
      }
    }

    return records;
  }

  async deletePlayRecord(
    userName: string,
    key: string
  ): Promise<void> {
    const db = getDB();

    await db
      .prepare(`
        DELETE FROM play_records
        WHERE username = ? AND key = ?
      `)
      .bind(userName, key)
      .run();

    await this.deleteCache('play_stats_summary');
  }

  async setPlayRecordsBatch(
    userName: string,
    records: { [key: string]: PlayRecord }
  ): Promise<void> {
    const db = getDB();

    const statements = Object.entries(records).map(([key, record]) =>
      db
        .prepare(`
          INSERT INTO play_records (username, key, value)
          VALUES (?, ?, ?)
          ON CONFLICT(username, key)
          DO UPDATE SET value = excluded.value
        `)
        .bind(userName, key, toJSON(record))
    );

    if (statements.length > 0) {
      await db.batch(statements);
    }

    await this.deleteCache('play_stats_summary');
  }

  // ============================================================
  // 收藏
  // ============================================================

  async getFavorite(
    userName: string,
    key: string
  ): Promise<Favorite | null> {
    const db = getDB();

    const row = await db
      .prepare(`
        SELECT value
        FROM favorites
        WHERE username = ? AND key = ?
      `)
      .bind(userName, key)
      .first();

    return parseJSON<Favorite>(row?.value);
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    const db = getDB();

    await db
      .prepare(`
        INSERT INTO favorites (username, key, value)
        VALUES (?, ?, ?)
        ON CONFLICT(username, key)
        DO UPDATE SET value = excluded.value
      `)
      .bind(userName, key, toJSON(favorite))
      .run();
  }

  async getAllFavorites(
    userName: string
  ): Promise<{ [key: string]: Favorite }> {
    const db = getDB();

    const result = (await db
      .prepare(`
        SELECT key, value
        FROM favorites
        WHERE username = ?
      `)
      .bind(userName)
      .all()) as D1Result<{ key: string; value: string }>;

    const favorites: { [key: string]: Favorite } = {};

    for (const row of result.results || []) {
      const favorite = parseJSON<Favorite>(row.value);

      if (favorite) {
        favorites[row.key] = favorite;
      }
    }

    return favorites;
  }

  async deleteFavorite(
    userName: string,
    key: string
  ): Promise<void> {
    const db = getDB();

    await db
      .prepare(`
        DELETE FROM favorites
        WHERE username = ? AND key = ?
      `)
      .bind(userName, key)
      .run();
  }

  async setFavoritesBatch(
    userName: string,
    favorites: { [key: string]: Favorite }
  ): Promise<void> {
    const db = getDB();

    const statements = Object.entries(favorites).map(([key, favorite]) =>
      db
        .prepare(`
          INSERT INTO favorites (username, key, value)
          VALUES (?, ?, ?)
          ON CONFLICT(username, key)
          DO UPDATE SET value = excluded.value
        `)
        .bind(userName, key, toJSON(favorite))
    );

    if (statements.length > 0) {
      await db.batch(statements);
    }
  }

  // ============================================================
  // 提醒
  // ============================================================

  async getReminder(
    userName: string,
    key: string
  ): Promise<Reminder | null> {
    const db = getDB();

    const row = await db
      .prepare(`
        SELECT value
        FROM reminders
        WHERE username = ? AND key = ?
      `)
      .bind(userName, key)
      .first();

    return parseJSON<Reminder>(row?.value);
  }

  async setReminder(
    userName: string,
    key: string,
    reminder: Reminder
  ): Promise<void> {
    const db = getDB();

    await db
      .prepare(`
        INSERT INTO reminders (username, key, value)
        VALUES (?, ?, ?)
        ON CONFLICT(username, key)
        DO UPDATE SET value = excluded.value
      `)
      .bind(userName, key, toJSON(reminder))
      .run();
  }

  async getAllReminders(
    userName: string
  ): Promise<{ [key: string]: Reminder }> {
    const db = getDB();

    const result = (await db
      .prepare(`
        SELECT key, value
        FROM reminders
        WHERE username = ?
      `)
      .bind(userName)
      .all()) as D1Result<{ key: string; value: string }>;

    const reminders: { [key: string]: Reminder } = {};

    for (const row of result.results || []) {
      const reminder = parseJSON<Reminder>(row.value);

      if (reminder) {
        reminders[row.key] = reminder;
      }
    }

    return reminders;
  }

  async deleteReminder(
    userName: string,
    key: string
  ): Promise<void> {
    const db = getDB();

    await db
      .prepare(`
        DELETE FROM reminders
        WHERE username = ? AND key = ?
      `)
      .bind(userName, key)
      .run();
  }

  // ============================================================
  // V1 用户
  // ============================================================

  async registerUser(
    userName: string,
    password: string
  ): Promise<void> {
    const db = getDB();

    const exists = await this.checkUserExist(userName);

    if (exists) {
      throw new Error('用户已存在');
    }

    const now = Date.now();
    const passwordHash = hashPassword(password);

    await db
      .prepare(`
        INSERT INTO users (username, password_hash, created_at)
        VALUES (?, ?, ?)
      `)
      .bind(userName, passwordHash, now)
      .run();
  }

  async verifyUser(
    userName: string,
    password: string
  ): Promise<boolean> {
    const db = getDB();

    const row = await db
      .prepare(`
        SELECT password_hash
        FROM users
        WHERE username = ?
      `)
      .bind(userName)
      .first();

    if (!row?.password_hash) {
      return false;
    }

    return verifyPassword(password, row.password_hash);
  }

  async checkUserExist(userName: string): Promise<boolean> {
    const db = getDB();

    const row = await db
      .prepare(`
        SELECT username
        FROM users
        WHERE username = ?
      `)
      .bind(userName)
      .first();

    return !!row;
  }

  async changePassword(
    userName: string,
    newPassword: string
  ): Promise<void> {
    const db = getDB();

    const passwordHash = hashPassword(newPassword);

    await db
      .prepare(`
        UPDATE users
        SET password_hash = ?
        WHERE username = ?
      `)
      .bind(passwordHash, userName)
      .run();
  }

  async deleteUser(userName: string): Promise<void> {
    const db = getDB();

    await db.batch([
      db.prepare(`DELETE FROM users WHERE username = ?`).bind(userName),
      db.prepare(`DELETE FROM users_v2 WHERE username = ?`).bind(userName),
      db.prepare(`DELETE FROM play_records WHERE username = ?`).bind(userName),
      db.prepare(`DELETE FROM favorites WHERE username = ?`).bind(userName),
      db.prepare(`DELETE FROM reminders WHERE username = ?`).bind(userName),
      db.prepare(`DELETE FROM search_history WHERE username = ?`).bind(userName),
      db.prepare(`DELETE FROM skip_configs WHERE username = ?`).bind(userName),
      db.prepare(`DELETE FROM episode_skip_configs WHERE username = ?`).bind(userName),
      db.prepare(`DELETE FROM login_stats WHERE username = ?`).bind(userName),
      db.prepare(`DELETE FROM emby_configs WHERE username = ?`).bind(userName),
    ]);

    await this.deleteCache('play_stats_summary');
  }

  // ============================================================
  // V2 用户 / OIDC
  // ============================================================

  async createUserV2(
    userName: string,
    password: string,
    role: 'owner' | 'admin' | 'user' = 'user',
    tags?: string[],
    oidcSub?: string,
    enabledApis?: string[]
  ): Promise<void> {
    const db = getDB();

    const exists = await this.checkUserExistV2(userName);

    if (exists) {
      throw new Error('用户已存在');
    }

    const now = Date.now();

    // 使用现有 LunaTV 密码格式。
    const passwordHash = hashPassword(password);

    await db
      .prepare(`
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
      `)
      .bind(
        userName,
        passwordHash,
        role,
        tags ? toJSON(tags) : null,
        enabledApis ? toJSON(enabledApis) : null,
        oidcSub ?? null,
        now
      )
      .run();
  }

  async verifyUserV2(
    userName: string,
    password: string
  ): Promise<boolean> {
    const db = getDB();

    const row = await db
      .prepare(`
        SELECT password, banned
        FROM users_v2
        WHERE username = ?
      `)
      .bind(userName)
      .first();

    if (!row?.password) {
      return false;
    }

    if (Number(row.banned) === 1) {
      return false;
    }

    const storedPassword = String(row.password);

    // 新格式：salt:hash
    if (isHashed(storedPassword)) {
      return verifyPassword(password, storedPassword);
    }

    // 兼容旧版 V2 的 SHA-256 密码。
    const oldHash = sha256(password);

    return oldHash === storedPassword;
  }

  async checkUserExistV2(userName: string): Promise<boolean> {
    const db = getDB();

    const row = await db
      .prepare(`
        SELECT username
        FROM users_v2
        WHERE username = ?
      `)
      .bind(userName)
      .first();

    return !!row;
  }

  async getUserByOidcSub(
    oidcSub: string
  ): Promise<string | null> {
    const db = getDB();

    const row = await db
      .prepare(`
        SELECT username
        FROM users_v2
        WHERE oidc_sub = ?
        LIMIT 1
      `)
      .bind(oidcSub)
      .first();

    return row?.username ?? null;
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
    const db = getDB();

    const row = await db
      .prepare(`
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
      `)
      .bind(userName)
      .first();

    if (!row) {
      return null;
    }

    return {
      username: row.username,
      role: row.role,
      tags: parseJSON<string[]>(row.tags) ?? undefined,
      enabledApis:
        parseJSON<string[]>(row.enabled_apis) ?? undefined,
      banned: Number(row.banned) === 1,
      createdAt: Number(row.created_at),
      oidcSub: row.oidc_sub ?? undefined,
    };
  }

  // ============================================================
  // 搜索历史
  // ============================================================

  async getSearchHistory(
    userName: string
  ): Promise<string[]> {
    const db = getDB();

    const result = (await db
      .prepare(`
        SELECT keyword
        FROM search_history
        WHERE username = ?
        ORDER BY created_at DESC
        LIMIT 20
      `)
      .bind(userName)
      .all()) as D1Result<{ keyword: string }>;

    return (result.results || []).map((row) => row.keyword);
  }

  async addSearchHistory(
    userName: string,
    keyword: string
  ): Promise<void> {
    const db = getDB();

    const now = Date.now();

    await db
      .prepare(`
        INSERT INTO search_history
        (username, keyword, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(username, keyword)
        DO UPDATE SET created_at = excluded.created_at
      `)
      .bind(userName, keyword, now)
      .run();

    // 保留最近20条
    await db
      .prepare(`
        DELETE FROM search_history
        WHERE username = ?
        AND keyword NOT IN (
          SELECT keyword
          FROM search_history
          WHERE username = ?
          ORDER BY created_at DESC
          LIMIT 20
        )
      `)
      .bind(userName, userName)
      .run();
  }

  async deleteSearchHistory(
    userName: string,
    keyword?: string
  ): Promise<void> {
    const db = getDB();

    if (keyword) {
      await db
        .prepare(`
          DELETE FROM search_history
          WHERE username = ? AND keyword = ?
        `)
        .bind(userName, keyword)
        .run();
    } else {
      await db
        .prepare(`
          DELETE FROM search_history
          WHERE username = ?
        `)
        .bind(userName)
        .run();
    }
  }

  // ============================================================
  // 用户列表
  // ============================================================

  async getAllUsers(): Promise<string[]> {
    const db = getDB();

    const result = (await db
      .prepare(`
        SELECT username
        FROM users
        UNION
        SELECT username
        FROM users_v2
        ORDER BY username
      `)
      .all()) as D1Result<{ username: string }>;

    return (result.results || []).map((row) => row.username);
  }

  // ============================================================
  // 管理员配置
  // ============================================================

  async getAdminConfig(): Promise<AdminConfig | null> {
    const db = getDB();

    const row = await db
      .prepare(`
        SELECT value
        FROM admin_config
        WHERE id = 1
      `)
      .first();

    return parseJSON<AdminConfig>(row?.value);
  }

  async setAdminConfig(
    config: AdminConfig
  ): Promise<void> {
    const db = getDB();

    await db
      .prepare(`
        INSERT INTO admin_config (id, value)
        VALUES (1, ?)
        ON CONFLICT(id)
        DO UPDATE SET value = excluded.value
      `)
      .bind(toJSON(config))
      .run();
  }

  // ============================================================
  // 跳过片头片尾
  // ============================================================

  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<EpisodeSkipConfig | null> {
    const db = getDB();

    const row = await db
      .prepare(`
        SELECT value
        FROM skip_configs
        WHERE username = ? AND source = ? AND id = ?
      `)
      .bind(userName, source, id)
      .first();

    return parseJSON<EpisodeSkipConfig>(row?.value);
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: EpisodeSkipConfig
  ): Promise<void> {
    const db = getDB();

    await db
      .prepare(`
        INSERT INTO skip_configs
        (username, source, id, value)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(username, source, id)
        DO UPDATE SET value = excluded.value
      `)
      .bind(userName, source, id, toJSON(config))
      .run();
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const db = getDB();

    await db
      .prepare(`
        DELETE FROM skip_configs
        WHERE username = ? AND source = ? AND id = ?
      `)
      .bind(userName, source, id)
      .run();
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: EpisodeSkipConfig }> {
    const db = getDB();

    const result = (await db
      .prepare(`
        SELECT source, id, value
        FROM skip_configs
        WHERE username = ?
      `)
      .bind(userName)
      .all()) as D1Result<{
      source: string;
      id: string;
      value: string;
    }>;

    const configs: {
      [key: string]: EpisodeSkipConfig;
    } = {};

    for (const row of result.results || []) {
      const config = parseJSON<EpisodeSkipConfig>(row.value);

      if (config) {
        configs[`${row.source}+${row.id}`] = config;
      }
    }

    return configs;
  }

  // ============================================================
  // 新版多片段跳过配置
  // ============================================================

  async getEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<EpisodeSkipConfig | null> {
    const db = getDB();

    const row = await db
      .prepare(`
        SELECT value
        FROM episode_skip_configs
        WHERE username = ? AND source = ? AND id = ?
      `)
      .bind(userName, source, id)
      .first();

    return parseJSON<EpisodeSkipConfig>(row?.value);
  }

  async saveEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: EpisodeSkipConfig
  ): Promise<void> {
    const db = getDB();

    await db
      .prepare(`
        INSERT INTO episode_skip_configs
        (username, source, id, value)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(username, source, id)
        DO UPDATE SET value = excluded.value
      `)
      .bind(userName, source, id, toJSON(config))
      .run();
  }

  async deleteEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const db = getDB();

    await db
      .prepare(`
        DELETE FROM episode_skip_configs
        WHERE username = ? AND source = ? AND id = ?
      `)
      .bind(userName, source, id)
      .run();
  }

  async getAllEpisodeSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: EpisodeSkipConfig }> {
    const db = getDB();

    const result = (await db
      .prepare(`
        SELECT source, id, value
        FROM episode_skip_configs
        WHERE username = ?
      `)
      .bind(userName)
      .all()) as D1Result<{
      source: string;
      id: string;
      value: string;
    }>;

    const configs: {
      [key: string]: EpisodeSkipConfig;
    } = {};

    for (const row of result.results || []) {
      const config = parseJSON<EpisodeSkipConfig>(row.value);

      if (config) {
        configs[`${row.source}+${row.id}`] = config;
      }
    }

    return configs;
  }

  // ============================================================
  // 清空全部数据
  // ============================================================

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
      db.prepare(`DELETE FROM episode_skip_configs`),
      db.prepare(`DELETE FROM admin_config`),
      db.prepare(`DELETE FROM cache`),
      db.prepare(`DELETE FROM login_stats`),
      db.prepare(`DELETE FROM emby_configs`),
      db.prepare(`DELETE FROM crash_logs`),
    ]);
  }

  // ============================================================
  // Cache
  // ============================================================

  async getCache(key: string): Promise<any | null> {
    const db = getDB();

    const row = await db
      .prepare(`
        SELECT value, expires_at
        FROM cache
        WHERE key = ?
      `)
      .bind(key)
      .first();

    if (!row) {
      return null;
    }

    const expiresAt =
      row.expires_at === null || row.expires_at === undefined
        ? null
        : Number(row.expires_at);

    if (expiresAt !== null && expiresAt <= Date.now()) {
      await this.deleteCache(key);
      return null;
    }

    return parseJSON<any>(row.value);
  }

  async setCache(
    key: string,
    data: any,
    expireSeconds?: number
  ): Promise<void> {
    const db = getDB();

    const expiresAt =
      expireSeconds && expireSeconds > 0
        ? Date.now() + expireSeconds * 1000
        : null;

    await db
      .prepare(`
        INSERT INTO cache (key, value, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key)
        DO UPDATE SET
          value = excluded.value,
          expires_at = excluded.expires_at
      `)
      .bind(key, toJSON(data), expiresAt)
      .run();
  }

  async deleteCache(key: string): Promise<void> {
    const db = getDB();

    await db
      .prepare(`
        DELETE FROM cache
        WHERE key = ?
      `)
      .bind(key)
      .run();
  }

  async clearExpiredCache(prefix?: string): Promise<void> {
    const db = getDB();

    if (prefix) {
      await db
        .prepare(`
          DELETE FROM cache
          WHERE expires_at IS NOT NULL
          AND expires_at <= ?
          AND key LIKE ?
        `)
        .bind(Date.now(), `${prefix}%`)
        .run();
    } else {
      await db
        .prepare(`
          DELETE FROM cache
          WHERE expires_at IS NOT NULL
          AND expires_at <= ?
        `)
        .bind(Date.now())
        .run();
    }
  }

  // ============================================================
  // 播放统计
  // ============================================================

  async getUserPlayStat(
    userName: string
  ): Promise<UserPlayStat> {
    const records = await this.getAllPlayRecords(userName);

    const recordList = Object.values(records);

    let totalWatchTime = 0;
    let totalPlays = 0;
    let lastPlayTime = 0;

    const sourceCounts: Record<string, number> = {};

    for (const record of recordList) {
      const watchTime = Number(record.play_time || 0);

      totalWatchTime += watchTime;
      totalPlays += 1;

      if (Number(record.save_time || 0) > lastPlayTime) {
        lastPlayTime = Number(record.save_time || 0);
      }

      sourceCounts[record.source_name] =
        (sourceCounts[record.source_name] || 0) + 1;
    }

    let mostWatchedSource = '';

    for (const [source, count] of Object.entries(sourceCounts)) {
      if (
        !mostWatchedSource ||
        count > (sourceCounts[mostWatchedSource] || 0)
      ) {
        mostWatchedSource = source;
      }
    }

    const recentRecords = [...recordList]
      .sort(
        (a, b) =>
          Number(b.save_time || 0) -
          Number(a.save_time || 0)
      )
      .slice(0, 10);

    const loginRow = await this.getLoginStatsRow(userName);

    const createdAt =
      await this.getUserCreatedAt(userName);

    const firstLoginTime = loginRow?.first_login_time
      ? Number(loginRow.first_login_time)
      : undefined;

    const lastLoginTime = loginRow?.last_login_time
      ? Number(loginRow.last_login_time)
      : undefined;

    return {
      username: userName,
      totalWatchTime,
      totalPlays,
      lastPlayTime,
      recentRecords,
      avgWatchTime:
        totalPlays > 0
          ? totalWatchTime / totalPlays
          : 0,
      mostWatchedSource,

      totalMovies: recordList.length,

      firstWatchDate:
        recordList.length > 0
          ? Math.min(
              ...recordList.map((r) =>
                Number(r.save_time || 0)
              )
            )
          : undefined,

      lastUpdateTime: lastPlayTime,
      createdAt,

      loginCount: loginRow?.login_count
        ? Number(loginRow.login_count)
        : 0,

      firstLoginTime,
      lastLoginTime,

      lastLoginDate: loginRow?.last_login_date
        ? Number(loginRow.last_login_date)
        : undefined,

      lastLoginIp:
        loginRow?.last_login_ip ?? undefined,

      lastLoginLocation:
        loginRow?.last_login_location ?? undefined,

      lastLoginDevice:
        loginRow?.last_login_device ?? undefined,

      lastLoginBrowser:
        loginRow?.last_login_browser ?? undefined,

      lastLoginOs:
        loginRow?.last_login_os ?? undefined,
    };
  }

  async getPlayStats(): Promise<PlayStatsResult> {
    const cached =
      await this.getCache('play_stats_summary');

    if (cached) {
      return cached as PlayStatsResult;
    }

    const users = await this.getAllUsers();

    const userStats = [];

    let totalWatchTime = 0;
    let totalPlays = 0;

    const sourceCounts: Record<string, number> = {};

    const dailyMap: Record<
      string,
      { watchTime: number; plays: number }
    > = {};

    for (const username of users) {
      const stat = await this.getUserPlayStat(username);

      totalWatchTime += stat.totalWatchTime;
      totalPlays += stat.totalPlays;

      for (const record of stat.recentRecords) {
        sourceCounts[record.source_name] =
          (sourceCounts[record.source_name] || 0) + 1;
      }

      const loginRow =
        await this.getLoginStatsRow(username);

      const createdAt =
        stat.createdAt || 0;

      const registrationDays =
        createdAt > 0
          ? Math.floor(
              (Date.now() - createdAt) /
                86400000
            ) + 1
          : 0;

      userStats.push({
        username,
        totalWatchTime: stat.totalWatchTime,
        totalPlays: stat.totalPlays,
        lastPlayTime: stat.lastPlayTime,
        recentRecords: stat.recentRecords,
        avgWatchTime: stat.avgWatchTime,
        mostWatchedSource: stat.mostWatchedSource,
        registrationDays,
        lastLoginTime:
          loginRow?.last_login_time
            ? Number(loginRow.last_login_time)
            : 0,
        loginCount:
          loginRow?.login_count
            ? Number(loginRow.login_count)
            : 0,
        createdAt,
        lastLoginIp:
          loginRow?.last_login_ip ?? undefined,
        lastLoginLocation:
          loginRow?.last_login_location ?? undefined,
        lastLoginDevice:
          loginRow?.last_login_device ?? undefined,
        lastLoginBrowser:
          loginRow?.last_login_browser ?? undefined,
        lastLoginOs:
          loginRow?.last_login_os ?? undefined,
      });

      const records =
        await this.getAllPlayRecords(username);

      for (const record of Object.values(records)) {
        const timestamp =
          Number(record.save_time || 0);

        if (!timestamp) continue;

        const date = new Date(timestamp)
          .toISOString()
          .slice(0, 10);

        if (!dailyMap[date]) {
          dailyMap[date] = {
            watchTime: 0,
            plays: 0,
          };
        }

        dailyMap[date].watchTime +=
          Number(record.play_time || 0);

        dailyMap[date].plays += 1;
      }
    }

    const now = new Date();

    const dailyStats = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date(
        now.getTime() - i * 86400000
      )
        .toISOString()
        .slice(0, 10);

      dailyStats.push({
        date,
        watchTime:
          dailyMap[date]?.watchTime || 0,
        plays:
          dailyMap[date]?.plays || 0,
      });
    }

    const topSources = Object.entries(sourceCounts)
      .map(([source, count]) => ({
        source,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const registrationTrend: Array<{
      date: string;
      newUsers: number;
    }> = [];

    const today = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(
        today.getTime() - i * 86400000
      )
        .toISOString()
        .slice(0, 10);

      const start = new Date(
        `${date}T00:00:00.000Z`
      ).getTime();

      const end = start + 86400000;

      const db = getDB();

      const row = await db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM (
            SELECT created_at
            FROM users
            WHERE created_at >= ? AND created_at < ?

            UNION ALL

            SELECT created_at
            FROM users_v2
            WHERE created_at >= ? AND created_at < ?
          )
        `)
        .bind(start, end, start, end)
        .first();

      registrationTrend.push({
        date,
        newUsers: Number(row?.count || 0),
      });
    }

    const todayStart =
      new Date(
        today.toISOString().slice(0, 10)
      ).getTime();

    const totalRegisteredUsers =
      users.length;

    const todayNewUsers =
      registrationTrend[6]?.newUsers || 0;

    const activeUsers =
      await this.getActiveUsers();

    const result: PlayStatsResult = {
      totalUsers: users.length,
      totalWatchTime,
      totalPlays,
      avgWatchTimePerUser:
        users.length > 0
          ? totalWatchTime / users.length
          : 0,
      avgPlaysPerUser:
        users.length > 0
          ? totalPlays / users.length
          : 0,
      userStats,
      topSources,
      dailyStats,
      registrationStats: {
        todayNewUsers,
        totalRegisteredUsers,
        registrationTrend,
      },
      activeUsers,
    };

    // 避免 unused 变量警告
    void todayStart;

    await this.setCache(
      'play_stats_summary',
      result,
      300
    );

    return result;
  }

  async getContentStats(
    limit = 10
  ): Promise<ContentStat[]> {
    const users = await this.getAllUsers();

    const map = new Map<
      string,
      ContentStat
    >();

    for (const username of users) {
      const records =
        await this.getAllPlayRecords(username);

      for (const [key, record] of Object.entries(
        records
      )) {
        const source =
          record.source_name || '';

        const id =
          key.includes('+')
            ? key.substring(
                key.indexOf('+') + 1
              )
            : key;

        const mapKey =
          `${source}+${id}`;

        if (!map.has(mapKey)) {
          map.set(mapKey, {
            source,
            id,
            title: record.title,
            source_name: record.source_name,
            cover: record.cover,
            year: record.year,
            playCount: 0,
            totalWatchTime: 0,
            averageWatchTime: 0,
            lastPlayed: 0,
            uniqueUsers: 0,
          });
        }

        const item = map.get(mapKey)!;

        item.playCount += 1;
        item.totalWatchTime +=
          Number(record.play_time || 0);

        item.lastPlayed = Math.max(
          item.lastPlayed,
          Number(record.save_time || 0)
        );

        item.uniqueUsers += 1;
      }
    }

    const result = Array.from(map.values())
      .map((item) => ({
        ...item,
        averageWatchTime:
          item.playCount > 0
            ? item.totalWatchTime /
              item.playCount
            : 0,
      }))
      .sort(
        (a, b) =>
          b.playCount - a.playCount
      )
      .slice(0, limit);

    return result;
  }

  async updatePlayStatistics(
    _userName: string,
    _source: string,
    _id: string,
    _watchTime: number
  ): Promise<void> {
    await this.deleteCache(
      'play_stats_summary'
    );
  }

  // ============================================================
  // 登录统计
  // ============================================================

  private async getLoginStatsRow(
    userName: string
  ): Promise<any | null> {
    const db = getDB();

    return db
      .prepare(`
        SELECT *
        FROM login_stats
        WHERE username = ?
      `)
      .bind(userName)
      .first();
  }

  async updateUserLoginStats(
    userName: string,
    loginTime: number,
    _isFirstLogin?: boolean,
    loginMeta?: {
      ip?: string;
      location?: string;
      device?: string;
      browser?: string;
      os?: string;
    }
  ): Promise<void> {
    const db = getDB();

    const existing =
      await this.getLoginStatsRow(userName);

    const firstLoginTime =
      existing?.first_login_time
        ? Number(existing.first_login_time)
        : loginTime;

    const loginCount =
      existing?.login_count
        ? Number(existing.login_count) + 1
        : 1;

    const loginDate = new Date(loginTime)
      .toISOString()
      .slice(0, 10);

    const loginDateTimestamp =
      new Date(
        `${loginDate}T00:00:00.000Z`
      ).getTime();

    await db
      .prepare(`
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
          first_login_time = excluded.first_login_time,
          last_login_time = excluded.last_login_time,
          last_login_date = excluded.last_login_date,
          last_login_ip = excluded.last_login_ip,
          last_login_location = excluded.last_login_location,
          last_login_device = excluded.last_login_device,
          last_login_browser = excluded.last_login_browser,
          last_login_os = excluded.last_login_os
      `)
      .bind(
        userName,
        loginCount,
        firstLoginTime,
        loginTime,
        loginDateTimestamp,
        loginMeta?.ip ?? existing?.last_login_ip ?? null,
        loginMeta?.location ??
          existing?.last_login_location ??
          null,
        loginMeta?.device ??
          existing?.last_login_device ??
          null,
        loginMeta?.browser ??
          existing?.last_login_browser ??
          null,
        loginMeta?.os ??
          existing?.last_login_os ??
          null
      )
      .run();

    await this.deleteCache(
      'play_stats_summary'
    );
  }

  // ============================================================
  // Emby
  // ============================================================

  async getUserEmbyConfig(
    userName: string
  ): Promise<any | null> {
    const db = getDB();

    const row = await db
      .prepare(`
        SELECT value
        FROM emby_configs
        WHERE username = ?
      `)
      .bind(userName)
      .first();

    return parseJSON<any>(row?.value);
  }

  async saveUserEmbyConfig(
    userName: string,
    config: any
  ): Promise<void> {
    const db = getDB();

    await db
      .prepare(`
        INSERT INTO emby_configs
        (username, value)
        VALUES (?, ?)
        ON CONFLICT(username)
        DO UPDATE SET value = excluded.value
      `)
      .bind(userName, toJSON(config))
      .run();
  }

  async deleteUserEmbyConfig(
    userName: string
  ): Promise<void> {
    const db = getDB();

    await db
      .prepare(`
        DELETE FROM emby_configs
        WHERE username = ?
      `)
      .bind(userName)
      .run();
  }

  // ============================================================
  // 崩溃日志
  // ============================================================

  async saveCrashLog(
    crashLog: CrashLog
  ): Promise<void> {
    const db = getDB();

    const createdAt =
      crashLog.serverReceivedAt
        ? new Date(
            crashLog.serverReceivedAt
          ).getTime()
        : Date.now();

    await db
      .prepare(`
        INSERT INTO crash_logs
        (timestamp, value, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(timestamp)
        DO UPDATE SET
          value = excluded.value,
          created_at = excluded.created_at
      `)
      .bind(
        crashLog.timestamp,
        toJSON(crashLog),
        createdAt
      )
      .run();
  }

  async getCrashLogs(
    limit = 100
  ): Promise<CrashLog[]> {
    const db = getDB();

    const result = (await db
      .prepare(`
        SELECT value
        FROM crash_logs
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .bind(limit)
      .all()) as D1Result<{
      value: string;
    }>;

    const logs: CrashLog[] = [];

    for (const row of result.results || []) {
      const log = parseJSON<CrashLog>(
        row.value
      );

      if (log) {
        logs.push(log);
      }
    }

    return logs;
  }

  async deleteCrashLog(
    timestamp: string
  ): Promise<void> {
    const db = getDB();

    await db
      .prepare(`
        DELETE FROM crash_logs
        WHERE timestamp = ?
      `)
      .bind(timestamp)
      .run();
  }

  async clearCrashLogs(): Promise<void> {
    const db = getDB();

    await db
      .prepare(`
        DELETE FROM crash_logs
      `)
      .run();
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  private async getUserCreatedAt(
    userName: string
  ): Promise<number | undefined> {
    const db = getDB();

    const v1 = await db
      .prepare(`
        SELECT created_at
        FROM users
        WHERE username = ?
      `)
      .bind(userName)
      .first();

    if (v1?.created_at) {
      return Number(v1.created_at);
    }

    const v2 = await db
      .prepare(`
        SELECT created_at
        FROM users_v2
        WHERE username = ?
      `)
      .bind(userName)
      .first();

    if (v2?.created_at) {
      return Number(v2.created_at);
    }

    return undefined;
  }

  private async getActiveUsers(): Promise<{
    daily: number;
    weekly: number;
    monthly: number;
  }> {
    const db = getDB();

    const now = Date.now();

    const dayAgo =
      now - 24 * 60 * 60 * 1000;

    const weekAgo =
      now - 7 * 24 * 60 * 60 * 1000;

    const monthAgo =
      now - 30 * 24 * 60 * 60 * 1000;

    const daily = await db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM login_stats
        WHERE last_login_time >= ?
      `)
      .bind(dayAgo)
      .first();

    const weekly = await db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM login_stats
        WHERE last_login_time >= ?
      `)
      .bind(weekAgo)
      .first();

    const monthly = await db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM login_stats
        WHERE last_login_time >= ?
      `)
      .bind(monthAgo)
      .first();

    return {
      daily: Number(daily?.count || 0),
      weekly: Number(weekly?.count || 0),
      monthly: Number(monthly?.count || 0),
    };
  }

  // ============================================================
  // 兼容 db.ts 中可能调用的迁移方法
  // ============================================================

  async migrateData(): Promise<void> {
    // D1 使用 migrations 管理数据库结构。
    // 因此这里不执行 Node/SQLite 文件迁移。
    //
    // 保留此方法是为了兼容 DbManager 的启动逻辑。
    return;
  }

  async migratePasswords(): Promise<void> {
    // D1 新用户直接使用 LunaTV 的 salt:hash 格式。
    // 已存在的密码在登录时兼容验证。
    return;
  }
}
