import { describe, it, expect } from "vitest";
import {
  detectToolColumns,
  splitCsvLine,
  buildSourceSummary,
  parseToolCsv,
  parseOwnTemplateCsv,
} from "./toolImport";

const NOX_HEADERS = [
  "频道链接",
  "频道名称",
  "Subscribers",
  "Audience Countries",
  "Engagement Rate",
  "Avg. Views",
  "Email",
];

describe("detectToolColumns", () => {
  it("maps common CN/EN variants of influencer tool exports", () => {
    const m = detectToolColumns(NOX_HEADERS);
    expect(m).not.toBeNull();
    expect(m!.identifier).toBe("频道链接");
    expect(m!.name).toBe("频道名称");
    expect(m!.subscribers).toBe("Subscribers");
    expect(m!.audienceCountry).toBe("Audience Countries");
    expect(m!.engagement).toBe("Engagement Rate");
    expect(m!.avgViews).toBe("Avg. Views");
    expect(m!.email).toBe("Email");
  });

  it("returns null when no identifier column (plain lines)", () => {
    expect(detectToolColumns(["name", "note"])).toBeNull();
  });
});

describe("splitCsvLine", () => {
  it("handles quoted commas", () => {
    expect(splitCsvLine('"a,b",c,"d""e"')).toEqual(["a,b", "c", 'd"e']);
  });
});

describe("buildSourceSummary", () => {
  it("joins recognized fields and skips empty ones", () => {
    const m = detectToolColumns(NOX_HEADERS)!;
    const row = Object.fromEntries(
      NOX_HEADERS.map((h, i) => [
        h,
        [
          "https://www.youtube.com/@a",
          "频道A",
          "12000",
          "US",
          "",
          "5K",
          "x@y.com",
        ][i],
      ]),
    );
    const s = buildSourceSummary(m, row);
    expect(s).toContain("[外部工具导出");
    expect(s).toContain("频道名称:频道A");
    expect(s).toContain("订阅:12000");
    expect(s).toContain("受众国家:US");
    expect(s).toContain("邮箱:x@y.com");
    expect(s).not.toContain("互动率"); // 空值跳过
  });
});

describe("parseToolCsv", () => {
  it("parses rows with mapped summary and lists unknown columns", () => {
    const csv = [
      NOX_HEADERS.join(",") + ",Extra Col",
      "https://www.youtube.com/@a,频道A,12000,US,4.2%,5K,a@b.com,随便",
      "@handleB,频道B,,,,,",
    ].join("\n");
    const r = parseToolCsv(csv, 20);
    expect(r.map).not.toBeNull();
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]!.input).toBe("https://www.youtube.com/@a");
    expect(r.rows[0]!.sourceSummary).toContain("受众国家:US");
    expect(r.rows[1]!.input).toBe("@handleB");
    expect(r.rows[0]!.unknownColumns).toEqual(["Extra Col"]);
  });

  it("respects maxRows cap", () => {
    const csv = ["channel_url", "@a", "@b", "@c"].join("\n");
    expect(parseToolCsv(csv, 2).rows).toHaveLength(2);
  });

  it("returns null map for own-template CSV (handled by parseOwnTemplateCsv)", () => {
    expect(
      parseToolCsv("channel_input,source_note\nUCxxx,note", 20).map,
    ).toBeNull();
    const own = parseOwnTemplateCsv(
      "channel_input,source_note,note\nUCxxx,搜索找到,优先核实",
      20,
    );
    expect(own).toHaveLength(1);
    expect(own[0]!.input).toBe("UCxxx");
    expect(own[0]!.sourceSummary).toContain("搜索找到");
  });
});
