/**
 * 代理状态检测相关的类型定义
 * 用于 Cloudflare 部署时的类型安全
 */

export interface HealthStatus {
  healthy: boolean;
  responseTime?: number;
  error?: string;
}

export interface ProxyStatusResponse {
  timestamp: string;
  tvboxProxy: {
    enabled: boolean;
    proxyUrl: string | null;
    health: HealthStatus;
  };
  videoProxy: {
    enabled: boolean;
    proxyUrl: string | null;
    health: HealthStatus;
  };
}

/**
 * 本地状态管理
 */
export interface ProxyStatusState {
  healthy: boolean;
  responseTime?: number;
  error?: string | null;
  lastCheck?: string;
}
