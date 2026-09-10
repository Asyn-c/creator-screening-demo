/**
 * YouTube API 响应 → api_cache 行的纯映射。
 * 规则（PRD F2）：只搬运原始字段；缺失显示未知（不补 0、不补造）；
 * null 与 0 分开保留；不计算派生指标。
 */

export interface CacheRaw {
  title?: string;
  description?: string;
  subscriber_count?: number | null;
  country?: string | null;
  published_at?: string;
  view_count?: number | null;
  like_count?: number | null;
  comment_count?: number | null;
}

export interface MappedChannel {
  kind: "channel";
  raw: CacheRaw;
  uploads_playlist_id: string | null;
}

export interface MappedVideo {
  kind: "video";
  raw: CacheRaw;
}

export interface YouTubeChannelItem {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    country?: string;
    publishedAt?: string;
  };
  statistics?: {
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
  };
  contentDetails?: {
    relatedPlaylists?: { uploads?: string };
  };
}

export interface YouTubeVideoItem {
  id?: string;
  snippet?: { title?: string; publishedAt?: string };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
}

export function mapChannel(item: YouTubeChannelItem): MappedChannel {
  return {
    kind: "channel",
    raw: {
      title: item.snippet?.title,
      description: item.snippet?.description,
      // hiddenSubscriberCount=true 时订阅数是「被隐藏」（未知），不是 0
      subscriber_count:
        item.statistics?.hiddenSubscriberCount === true
          ? null
          : item.statistics?.subscriberCount != null
            ? Number(item.statistics.subscriberCount)
            : null,
      country: item.snippet?.country ?? null,
      published_at: item.snippet?.publishedAt,
    },
    uploads_playlist_id: item.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

export function mapVideos(items: YouTubeVideoItem[]): MappedVideo[] {
  return items
    .filter((v) => v.id)
    .map((v) => ({
      kind: "video" as const,
      raw: {
        title: v.snippet?.title,
        published_at: v.snippet?.publishedAt,
        view_count:
          v.statistics?.viewCount != null
            ? Number(v.statistics.viewCount)
            : null,
        like_count:
          v.statistics?.likeCount != null
            ? Number(v.statistics.likeCount)
            : null,
        comment_count:
          v.statistics?.commentCount != null
            ? Number(v.statistics.commentCount)
            : null,
      },
    }));
}

/** YouTube API 错误 → 可读原因（权限/额度不重试，临时错误由调用方决定重试） */
export function explainYouTubeError(status: number, body: unknown): string {
  const reason =
    (body as any)?.error?.errors?.[0]?.reason ??
    (body as any)?.error?.status ??
    "";
  if (status === 400 && /keyInvalid|API_KEY|badRequest/i.test(String(reason)))
    return "API Key 无效或未启用 YouTube Data API";
  if (status === 403 && /quota/i.test(String(reason)))
    return "API 配额不足，请明天重试或提升配额";
  if (status === 403)
    return "API 权限不足（Key 被限制或 Referer/IP 白名单拦截）";
  if (status === 404) return "频道不存在或已删除";
  if (status >= 500) return "YouTube 服务临时异常，可稍后重试";
  return `获取失败（HTTP ${status}${reason ? " " + reason : ""}）`;
}
