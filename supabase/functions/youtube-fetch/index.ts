import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { AuthMiddleware } from "../_shared/authentication.ts";
import { OptionsMiddleware } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  explainYouTubeError,
  mapChannel,
  mapVideos,
  type MappedVideo,
  type YouTubeChannelItem,
  type YouTubeVideoItem,
} from "./mapper.ts";

/**
 * youtube-fetch：为单个候选拉取频道资料与最近最多 10 条公开视频，写入 api_cache。
 * - Key 只从服务端环境读取（YOUTUBE_API_KEY），浏览器永远拿不到
 * - YOUTUBE_API_KEY=TESTKEY 时走受控测试 provider（不请求 YouTube，返回固定夹具），
 *   用于本地与 CI 验证管线，不消耗真实配额
 * - 示例空间（demo: 前缀 channel_id）拒绝请求真实接口
 * - 成功后删除旧缓存行、写入新行（source=youtube，30 天有效期）、递增 contacts.data_version
 *   → 旧判断进入待复核（前端 isReviewStale 数据版分支）
 */

const CACHE_TTL_DAYS = 30;
const MAX_VIDEOS = 10;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 受控测试 provider：固定夹具，覆盖「完整 / 部分缺失 / 0 值」三种形态 */
function testFixture(channelId: string) {
  const partial = channelId.endsWith("1");
  const channel: YouTubeChannelItem = {
    id: channelId.startsWith("@") ? "UCtest0000000000000000test" : channelId,
    snippet: {
      title: `【测试】频道 ${channelId}`,
      description: "受控测试数据，非真实 YouTube 返回",
      country: partial ? null : "US",
      publishedAt: "2023-01-01T00:00:00Z",
    },
    statistics: partial
      ? { hiddenSubscriberCount: true }
      : { subscriberCount: "42000" },
    contentDetails: {
      relatedPlaylists: { uploads: "UUtest0000000000000000test" },
    },
  };
  const videos: YouTubeVideoItem[] = [
    {
      id: "vid_test_1",
      snippet: {
        title: "测试视频 1：完整统计",
        publishedAt: "2026-09-01T00:00:00Z",
      },
      statistics: { viewCount: "12000", likeCount: "740", commentCount: "96" },
    },
    {
      id: "vid_test_2",
      snippet: {
        title: "测试视频 2：原始 0 值",
        publishedAt: "2026-08-20T00:00:00Z",
      },
      statistics: { viewCount: "0", likeCount: "0", commentCount: "0" },
    },
    {
      id: "vid_test_3",
      snippet: {
        title: "测试视频 3：统计缺失",
        publishedAt: "2026-08-10T00:00:00Z",
      },
      statistics: {},
    },
  ];
  return { channel, videos };
}

const YT_BASE = "https://www.googleapis.com/youtube/v3";

async function ytGet(
  key: string,
  path: string,
  params: Record<string, string>,
): Promise<
  { ok: true; data: any } | { ok: false; status: number; body: unknown }
> {
  const url = new URL(`${YT_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", key);
  const res = await fetch(url, { method: "GET" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, body };
  return { ok: true, data: body };
}

async function handler(req: Request): Promise<Response> {
  const apiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (!apiKey) {
    return json({
      configured: false,
      error: "未配置 YouTube API Key，自动资料获取未启用（可继续人工判断）",
    });
  }

  let payload: { candidate_id?: number; workspace_id?: number };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const candidateId = Number(payload.candidate_id);
  const workspaceId = Number(payload.workspace_id);
  if (!candidateId || !workspaceId) {
    return json({ error: "candidate_id 与 workspace_id 必填" }, 400);
  }

  // 作用域校验：候选必须属于该 workspace
  const { data: candidate, error: candErr } = await supabaseAdmin
    .from("contacts")
    .select("id, channel_id, workspace_id, data_version")
    .eq("id", candidateId)
    .eq("workspace_id", workspaceId)
    .single();
  if (candErr || !candidate) {
    return json({ error: "candidate not found in workspace" }, 404);
  }
  const channelId: string = candidate.channel_id ?? "";
  if (!channelId) {
    return json({ error: "该候选没有频道标识" }, 400);
  }
  if (channelId.startsWith("demo:")) {
    return json({ error: "演示数据不请求真实接口" }, 400);
  }

  // --- 取得频道 + 视频（真实接口或测试夹具） ---
  let channelItem: YouTubeChannelItem | null = null;
  let videoItems: YouTubeVideoItem[] = [];

  if (apiKey === "TESTKEY") {
    const fix = testFixture(channelId);
    channelItem = fix.channel;
    videoItems = fix.videos;
  } else {
    const chRes = channelId.startsWith("@")
      ? await ytGet(apiKey, "channels", {
          part: "snippet,statistics,contentDetails",
          forHandle: channelId,
        })
      : await ytGet(apiKey, "channels", {
          part: "snippet,statistics,contentDetails",
          id: channelId,
        });
    if (!chRes.ok)
      return json(
        { error: explainYouTubeError(chRes.status, chRes.body) },
        502,
      );
    const item = chRes.data.items?.[0];
    if (!item) {
      return json(
        {
          error: channelId.startsWith("@")
            ? "未找到该 handle 对应的频道（handle 可能已改名）"
            : "频道不存在或已删除",
        },
        404,
      );
    }
    channelItem = item;

    const uploads = item.contentDetails?.relatedPlaylists?.uploads;
    if (uploads) {
      const plRes = await ytGet(apiKey, "playlistItems", {
        part: "contentDetails",
        playlistId: uploads,
        maxResults: String(MAX_VIDEOS),
      });
      if (plRes.ok) {
        const ids = (plRes.data.items ?? [])
          .map((i: any) => i.contentDetails?.videoId)
          .filter(Boolean)
          .slice(0, MAX_VIDEOS);
        if (ids.length > 0) {
          const vRes = await ytGet(apiKey, "videos", {
            part: "snippet,statistics",
            id: ids.join(","),
          });
          if (vRes.ok) {
            videoItems = vRes.data.items ?? [];
          }
          // 视频列表失败不整体失败：频道身份已确认，已确认候选可进入人工工作流
        }
      }
    }
  }

  const mappedChannel = mapChannel(channelItem);
  const mappedVideos: MappedVideo[] = mapVideos(videoItems);

  // --- 写库：清旧缓存 → 写新缓存 → 递增资料版本（单候选内顺序执行） ---
  const now = new Date();
  const expires = new Date(now.getTime() + CACHE_TTL_DAYS * 86_400_000);
  const del = await supabaseAdmin
    .from("api_cache")
    .delete()
    .eq("candidate_id", candidateId)
    .eq("workspace_id", workspaceId);
  if (del.error) return json({ error: del.error.message }, 500);

  const rows = [
    {
      candidate_id: candidateId,
      workspace_id: workspaceId,
      kind: "channel",
      raw: mappedChannel.raw,
      source: apiKey === "TESTKEY" ? "test" : "youtube",
      fetched_at: now.toISOString(),
      expires_at: expires.toISOString(),
    },
    ...mappedVideos.map((v) => ({
      candidate_id: candidateId,
      workspace_id: workspaceId,
      kind: "video",
      raw: v.raw,
      source: apiKey === "TESTKEY" ? "test" : "youtube",
      fetched_at: now.toISOString(),
      expires_at: expires.toISOString(),
    })),
  ];
  const ins = await supabaseAdmin.from("api_cache").insert(rows);
  if (ins.error) return json({ error: ins.error.message }, 500);

  const newVersion = (candidate.data_version ?? 0) + 1;
  const upd = await supabaseAdmin
    .from("contacts")
    .update({ data_version: newVersion })
    .eq("id", candidateId)
    .eq("workspace_id", workspaceId);
  if (upd.error) return json({ error: upd.error.message }, 500);

  return json({
    configured: true,
    videos: mappedVideos.length,
    data_version: newVersion,
    warning: mappedVideos.length === 0 ? "频道没有可展示的近期视频" : undefined,
  });
}

Deno.serve((req: Request) =>
  OptionsMiddleware(req, () => AuthMiddleware(req, handler)),
);
