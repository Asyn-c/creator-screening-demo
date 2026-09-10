import { describe, it, expect } from "vitest";
import { mapChannel, mapVideos, explainYouTubeError } from "./mapper.ts";

describe("mapChannel (PRD F2: 未知与 0 分开)", () => {
  it("maps full channel item", () => {
    const m = mapChannel({
      id: "UCtest",
      snippet: {
        title: "频道",
        description: "描述",
        country: "US",
        publishedAt: "2023-01-01T00:00:00Z",
      },
      statistics: { subscriberCount: "1234" },
      contentDetails: { relatedPlaylists: { uploads: "UUtest" } },
    });
    expect(m.raw.subscriber_count).toBe(1234);
    expect(m.raw.country).toBe("US");
    expect(m.uploads_playlist_id).toBe("UUtest");
  });

  it("hidden subscriber count → null (未知), not 0", () => {
    const m = mapChannel({ statistics: { hiddenSubscriberCount: true } });
    expect(m.raw.subscriber_count).toBeNull();
  });

  it("missing statistics → null fields", () => {
    const m = mapChannel({});
    expect(m.raw.subscriber_count).toBeNull();
    expect(m.raw.country).toBeNull();
    expect(m.uploads_playlist_id).toBeNull();
  });
});

describe("mapVideos", () => {
  it("keeps raw 0 values as 0 and missing as null", () => {
    const vs = mapVideos([
      {
        id: "v1",
        snippet: { title: "零值", publishedAt: "2026-01-01T00:00:00Z" },
        statistics: { viewCount: "0", likeCount: "0", commentCount: "0" },
      },
      { id: "v2", snippet: { title: "缺失" }, statistics: {} },
      { id: undefined }, // 无 id 的脏行被过滤
    ]);
    expect(vs).toHaveLength(2);
    expect(vs[0]!.raw.view_count).toBe(0);
    expect(vs[1]!.raw.view_count).toBeNull();
  });
});

describe("explainYouTubeError", () => {
  it("distinguishes key / quota / permission / not-found / transient", () => {
    expect(
      explainYouTubeError(400, {
        error: { errors: [{ reason: "keyInvalid" }] },
      }),
    ).toContain("Key 无效");
    expect(
      explainYouTubeError(403, {
        error: { errors: [{ reason: "quotaExceeded" }] },
      }),
    ).toContain("配额不足");
    expect(explainYouTubeError(403, {})).toContain("权限不足");
    expect(explainYouTubeError(404, {})).toContain("频道不存在");
    expect(explainYouTubeError(503, {})).toContain("临时异常");
  });
});
