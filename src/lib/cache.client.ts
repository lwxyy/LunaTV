/* eslint-disable @typescript-eslint/no-explicit-any */

type CacheValue = any;

interface CacheItem {
  value: CacheValue;
  expiresAt: number;
}

const memoryCache = new Map<string, CacheItem>();

export function getCacheKey(
  type: string,
  params: Record<string, any> = {}
): string {
  const sortedParams = Object.keys(params)
    .sort()
    .reduce<Record<string, any>>((result, key) => {
      result[key] = params[key];
      return result;
    }, {});

  return `shortdrama:${type}:${JSON.stringify(sortedParams)}`;
}

export async function getCache(key: string): Promise<CacheValue | null> {
  const item = memoryCache.get(key);

  if (!item) {
    return null;
  }

  if (item.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }

  return item.value;
}

export async function setCache(
  key: string,
  value: CacheValue,
  expireSeconds: number
): Promise<void> {
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + expireSeconds * 1000,
  });
}
