CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users_v2 (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  banned INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  enabled_apis TEXT,
  oidc_sub TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_v2_oidc_sub
ON users_v2(oidc_sub);

CREATE TABLE IF NOT EXISTS play_records (
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (username, key)
);

CREATE INDEX IF NOT EXISTS idx_play_records_username
ON play_records(username);

CREATE TABLE IF NOT EXISTS favorites (
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (username, key)
);

CREATE INDEX IF NOT EXISTS idx_favorites_username
ON favorites(username);

CREATE TABLE IF NOT EXISTS reminders (
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (username, key)
);

CREATE INDEX IF NOT EXISTS idx_reminders_username
ON reminders(username);

CREATE TABLE IF NOT EXISTS search_history (
  username TEXT NOT NULL,
  keyword TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (username, keyword)
);

CREATE INDEX IF NOT EXISTS idx_search_history_username
ON search_history(username, created_at DESC);

CREATE TABLE IF NOT EXISTS skip_configs (
  username TEXT NOT NULL,
  source TEXT NOT NULL,
  id TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (username, source, id)
);

CREATE INDEX IF NOT EXISTS idx_skip_configs_username
ON skip_configs(username);

CREATE TABLE IF NOT EXISTS episode_skip_configs (
  username TEXT NOT NULL,
  source TEXT NOT NULL,
  id TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (username, source, id)
);

CREATE INDEX IF NOT EXISTS idx_episode_skip_configs_username
ON episode_skip_configs(username);

CREATE TABLE IF NOT EXISTS admin_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER
);

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
);

CREATE INDEX IF NOT EXISTS idx_login_stats_last_login
ON login_stats(last_login_time);

CREATE TABLE IF NOT EXISTS emby_configs (
  username TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crash_logs (
  timestamp TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crash_logs_created_at
ON crash_logs(created_at DESC);
