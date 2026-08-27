/**
 * 舆情监控轮询器
 * Sentiment Monitoring Poller
 *
 * 从社交媒体平台轮询关键词相关帖子
 */

import type { CreateInboxEventInput } from "../food-safety-types.js";

export interface SentimentPollerConfig {
  /** 轮询间隔（毫秒） */
  interval: number;
  /** 关键词列表 */
  keywords: string[];
  /** 平台列表 */
  platforms: ("weibo" | "xiaohongshu" | "douyin" | "meituan" | "大众点评")[];
  /** 是否启用 */
  enabled: boolean;
}

export interface SentimentPost {
  platform: string;
  post_id: string;
  author: string;
  content: string;
  url: string;
  likes: number;
  shares: number;
  comments: number;
  publish_time: string;
  sentiment?: "positive" | "negative" | "neutral";
}

export interface PollerResult {
  success: boolean;
  posts: SentimentPost[];
  errors: string[];
  timestamp: string;
}

// ============================================================================
// 默认配置
// ============================================================================

export const DEFAULT_SENTIMENT_KEYWORDS = [
  "喜茶",
  "食安",
  "变质",
  "异物",
  "投诉",
  "赔偿",
];

export const DEFAULT_PLATFORMS: SentimentPollerConfig["platforms"] = [
  "weibo",
  "xiaohongshu",
  "大众点评",
];

export const DEFAULT_POLLER_CONFIG: SentimentPollerConfig = {
  interval: 5 * 60 * 1000, // 5 分钟
  keywords: DEFAULT_SENTIMENT_KEYWORDS,
  platforms: DEFAULT_PLATFORMS,
  enabled: true,
};

// ============================================================================
// 轮询器
// ============================================================================

let pollerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * 启动舆情轮询器
 */
export async function startSentimentPoller(
  config: Partial<SentimentPollerConfig> = {},
  onPost: (post: CreateInboxEventInput) => Promise<void>
): Promise<void> {
  const fullConfig = { ...DEFAULT_POLLER_CONFIG, ...config };

  if (!fullConfig.enabled) {
    console.log("[SentimentPoller] Disabled in config");
    return;
  }

  if (isRunning) {
    console.log("[SentimentPoller] Already running");
    return;
  }

  console.log(
    `[SentimentPoller] Starting with config:`,
    JSON.stringify(fullConfig, null, 2)
  );

  isRunning = true;

  // 立即执行一次
  await pollOnce(fullConfig, onPost);

  // 设置定时轮询
  pollerInterval = setInterval(async () => {
    await pollOnce(fullConfig, onPost);
  }, fullConfig.interval);
}

/**
 * 停止舆情轮询器
 */
export function stopSentimentPoller(): void {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
  }
  isRunning = false;
  console.log("[SentimentPoller] Stopped");
}

/**
 * 执行一次轮询
 */
async function pollOnce(
  config: SentimentPollerConfig,
  onPost: (post: CreateInboxEventInput) => Promise<void>
): Promise<PollerResult> {
  const result: PollerResult = {
    success: true,
    posts: [],
    errors: [],
    timestamp: new Date().toISOString(),
  };

  console.log(`[SentimentPoller] Polling at ${result.timestamp}...`);

  for (const platform of config.platforms) {
    try {
      const posts = await fetchPlatformPosts(platform, config.keywords);
      result.posts.push(...posts);

      for (const post of posts) {
        const event = sentimentPostToEvent(post);
        await onPost(event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${platform}: ${message}`);
      console.error(`[SentimentPoller] ${platform} error:`, message);
    }
  }

  console.log(
    `[SentimentPoller] Found ${result.posts.length} posts, ${result.errors.length} errors`
  );

  return result;
}

// ============================================================================
// 平台接入
// ============================================================================

/**
 * 获取指定平台的帖子
 * TODO: 实现实际的平台 API 接入
 */
async function fetchPlatformPosts(
  platform: SentimentPollerConfig["platforms"][number],
  keywords: string[]
): Promise<SentimentPost[]> {
  // TODO: 实现实际 API 调用
  // 这里是一个占位实现，实际需要接入各平台的 API 或爬虫服务

  switch (platform) {
    case "weibo":
      return fetchWeiboPosts(keywords);
    case "xiaohongshu":
      return fetchXiaohongshuPosts(keywords);
    case "大众点评":
      return fetchDianpingPosts(keywords);
    default:
      return [];
  }
}

/**
 * 微博帖子抓取
 * TODO: 接入微博 API 或爬虫服务
 */
async function fetchWeiboPosts(keywords: string[]): Promise<SentimentPost[]> {
  // 占位实现
  // 实际需要: 微博开放平台 API 或微博爬虫服务
  console.debug(`[SentimentPoller] Would fetch Weibo posts for: ${keywords.join(", ")}`);
  return [];
}

/**
 * 小红书帖子抓取
 * TODO: 接入小红书 API 或爬虫服务
 */
async function fetchXiaohongshuPosts(keywords: string[]): Promise<SentimentPost[]> {
  // 占位实现
  // 实际需要: 小红书 API 或小红书爬虫服务
  console.debug(`[SentimentPoller] Would fetch Xiaohongshu posts for: ${keywords.join(", ")}`);
  return [];
}

/**
 * 大众点评帖子抓取
 * TODO: 接入大众点评 API 或爬虫服务
 */
async function fetchDianpingPosts(keywords: string[]): Promise<SentimentPost[]> {
  // 占位实现
  // 实际需要: 大众点评开放平台 API 或爬虫服务
  console.debug(`[SentimentPoller] Would fetch Dianping posts for: ${keywords.join(", ")}`);
  return [];
}

// ============================================================================
// 转换函数
// ============================================================================

/**
 * 将舆情帖子转换为 Inbox 事件
 */
export function sentimentPostToEvent(post: SentimentPost): CreateInboxEventInput {
  return {
    source: "sentiment",
    raw_content: post.content,
    author: post.author,
    platform: post.platform,
    received_at: post.publish_time,
    metadata: {
      post_id: post.post_id,
      url: post.url,
      likes: post.likes,
      shares: post.shares,
      comments: post.comments,
      sentiment: post.sentiment,
    },
    tags: [post.platform, ...(post.sentiment ? [post.sentiment] : [])],
  };
}

// ============================================================================
// 关键词匹配
// ============================================================================

/**
 * 检查内容是否匹配关键词
 */
export function matchesKeywords(
  content: string,
  keywords: string[]
): boolean {
  const lowerContent = content.toLowerCase();
  return keywords.some((kw) => lowerContent.includes(kw.toLowerCase()));
}

/**
 * 从内容中提取匹配的关键词
 */
export function extractMatchedKeywords(
  content: string,
  keywords: string[]
): string[] {
  const lowerContent = content.toLowerCase();
  return keywords.filter((kw) => lowerContent.includes(kw.toLowerCase()));
}

/**
 * 计算舆情情感分数
 * 返回 -1 (负面) 到 1 (正面)
 */
export function calculateSentimentScore(content: string): number {
  // TODO: 接入实际的情感分析服务
  // 这里使用简单的关键词匹配

  const positiveWords = ["好喝", "喜欢", "棒", "赞", "推荐", "美味", "满意"];
  const negativeWords = ["难喝", "失望", "投诉", "异物", "变质", "差", "垃圾"];

  let score = 0;
  const lowerContent = content.toLowerCase();

  for (const word of positiveWords) {
    if (lowerContent.includes(word)) score += 0.2;
  }

  for (const word of negativeWords) {
    if (lowerContent.includes(word)) score -= 0.3;
  }

  return Math.max(-1, Math.min(1, score));
}
