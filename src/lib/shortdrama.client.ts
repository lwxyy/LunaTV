/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { getCache, setCache, getCacheKey } from '@/lib/cache.client';

export interface ShortDramaItem {
  id: string;
  name: string;
  pic?: string;
  remarks?: string;
}

const SHORTDRAMA_CACHE_EXPIRE = {
  recommends: 3600,
  lists: 1800,
  episodes: 7200,
};

const pendingRequests = new Map<string, Promise<any>>();

function getApiBase(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return '/api/shortdrama';
}

// 获取推荐短剧
export async function getShortDramaRecommends(): Promise<ShortDramaItem[]> {
  const cacheKey = getCacheKey('recommends', {});

  try {
    // 检查缓存
    const cached = await getCache(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await fetch(`${getApiBase()}/recommends`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = (await response.json()) as any;

    // 只缓存非空结果，避免缓存错误/空数据
    if (Array.isArray(result) && result.length > 0) {
      await setCache(cacheKey, result, SHORTDRAMA_CACHE_EXPIRE.recommends);
    }
    return result;
  } catch (error) {
    console.error('获取推荐短剧失败:', error);
    return [];
  }
}

// 获取分类短剧列表（分页）
export async function getShortDramaList(
  category: number,
  page = 1,
  size = 20
): Promise<{ list: ShortDramaItem[]; hasMore: boolean }> {
  const cacheKey = getCacheKey('lists', { category, page, size });

  try {
    // 检查缓存
    const cached = await getCache(cacheKey);
    if (cached) {
      return cached;
    }

    // 🔄 请求去重
    const pendingKey = `list-${cacheKey}`;
    if (pendingRequests.has(pendingKey)) {
      console.log(`短剧列表请求去重: ${category}/${page}`);
      return pendingRequests.get(pendingKey)!;
    }

    const requestPromise = (async () => {
      // 🕐 超时保护：30秒后自动清理
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(pendingKey);
        console.warn(`短剧列表请求超时: ${category}/${page}`);
      }, 30000);

      try {
        // 使用内部 API 代理
        const apiUrl = `${getApiBase()}/list?categoryId=${category}&page=${page}&size=${size}`;

        const response = await fetch(apiUrl);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = (await response.json()) as any;

        // 只缓存非空结果，避免缓存错误/空数据
        if (result?.list && Array.isArray(result.list) && result.list.length > 0) {
          const cacheTime = page === 1 ? SHORTDRAMA_CACHE_EXPIRE.lists * 2 : SHORTDRAMA_CACHE_EXPIRE.lists;
          await setCache(cacheKey, result, cacheTime);
        }
        clearTimeout(timeoutId);
        return result;
      } finally {
        clearTimeout(timeoutId);
        pendingRequests.delete(pendingKey);
      }
    })();

    pendingRequests.set(pendingKey, requestPromise);
    return requestPromise;
  } catch (error) {
    console.error('获取短剧列表失败:', error);
    return { list: [], hasMore: false };
  }
}

// 搜索短剧
export async function searchShortDramas(
  query: string,
  page = 1,
  size = 20
): Promise<{ list: ShortDramaItem[]; hasMore: boolean }> {
  try {
    // 使用内部 API 代理
    const apiUrl = `${getApiBase()}/search?query=${encodeURIComponent(query)}&page=${page}&size=${size}`;

    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = (await response.json()) as any;
    return result;
  } catch (error) {
    console.error('搜索短剧失败:', error);
    return { list: [], hasMore: false };
  }
}

// 兼容项目其他模块使用的函数名称
export const getRecommendedShortDramas = getShortDramaRecommends;
