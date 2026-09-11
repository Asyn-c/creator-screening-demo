/**
 * 外部红人工具（Nox/Modash/HypeAuditor 等）导出 CSV 的列识别与摘要构建。
 * 设计（DECISIONS D9）：工具导出的是**结论/估算**，不进 api_cache 原始缓存，
 * 而是构建为来源备注（source_note）挂到候选，作为可追溯的人工判断依据。
 * 列名变体表：识别常见中英文列名；未识别列在预检中列为「本版不导入」。
 */

export interface ToolColumnMap {
  /** 必填：频道入口列 */
  identifier: string;
  name?: string;
  subscribers?: string;
  audienceCountry?: string;
  engagement?: string;
  avgViews?: string;
  email?: string;
}

/** 归一化表头单元格：小写、去空格与常见装饰符 */
const norm = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s_\-().（）【】,，、.]/g, "");

const VARIANTS: Record<keyof Omit<ToolColumnMap, never>, string[]> = {
  identifier: [
    "channelurl",
    "channellink",
    "channel",
    "url",
    "link",
    "homepage",
    "频道链接",
    "频道地址",
    "频道url",
    "频道",
    "博主链接",
    "主页",
  ],
  name: [
    "channelname",
    "channeltitle",
    "title",
    "name",
    "creator",
    "nickname",
    "频道名称",
    "博主名称",
    "红人名称",
    "昵称",
  ],
  subscribers: [
    "subscribers",
    "subscribercount",
    "subs",
    "fans",
    "followers",
    "订阅数",
    "粉丝数",
    "粉丝",
  ],
  audienceCountry: [
    "audiencecountry",
    "audiencegeo",
    "audiencelocation",
    "audiencecountries",
    "受众国家",
    "受众地区",
    "观众地区",
    "粉丝地区",
    "受众分布",
  ],
  engagement: ["engagementrate", "engagement", "互动率"],
  avgViews: [
    "avgviews",
    "averageviews",
    "avgview",
    "平均观看",
    "平均播放量",
    "均播",
  ],
  email: ["email", "businessemail", "邮箱", "商务邮箱"],
};

/** 从表头行识别列映射；无频道入口列返回 null（非工具导出格式）。
 * channel_input 是本工具标准模板列名（PRD F1），显式排除避免误判为工具导出 */
export function detectToolColumns(headers: string[]): ToolColumnMap | null {
  const map: ToolColumnMap = { identifier: "" };
  const normalized = headers.map(norm);
  const isOwnTemplate = (h: string) =>
    h === "channelinput" || h === "sourcenote" || h === "note";
  for (const [field, variants] of Object.entries(VARIANTS) as [
    keyof Omit<ToolColumnMap, never>,
    string[],
  ][]) {
    const idx = normalized.findIndex(
      (h) =>
        !isOwnTemplate(h) && variants.some((v) => h === v || h.includes(v)),
    );
    if (idx >= 0) map[field] = headers[idx];
  }
  return map.identifier ? map : null;
}

/** 本工具标准模板 CSV（channel_input[,source_note[,note]]）→ 按行解析 */
export function parseOwnTemplateCsv(
  text: string,
  maxRows: number,
): { input: string; sourceSummary: string }[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const headers = splitCsvLine(lines[0]).map((h) => norm(h));
  if (!headers.includes("channelinput")) return [];
  const iId = headers.indexOf("channelinput");
  const iSrc = headers.indexOf("sourcenote");
  const iNote = headers.indexOf("note");
  const rows: { input: string; sourceSummary: string }[] = [];
  for (const line of lines.slice(1)) {
    if (rows.length >= maxRows) break;
    const cells = splitCsvLine(line);
    const input = (cells[iId] ?? "").trim();
    if (!input) continue;
    const src = iSrc >= 0 ? cells[iSrc]?.trim() : "";
    const note = iNote >= 0 ? cells[iNote]?.trim() : "";
    const parts = [src, note].filter(Boolean);
    rows.push({
      input,
      sourceSummary: parts.length
        ? `[模板导入 ${new Date().toISOString().slice(0, 10)}] ${parts.join("；")}`
        : "",
    });
  }
  return rows;
}

/** 简易 CSV 行解析（处理引号内逗号/换行；工具导出通常无多行单元格） */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

/** 从映射后的行构建来源摘要（只收录识别到的字段，缺省跳过） */
export function buildSourceSummary(
  map: ToolColumnMap,
  row: Record<string, string>,
  toolLabel = "外部工具导出",
): string {
  const parts: string[] = [];
  const get = (k: keyof Omit<ToolColumnMap, never>) => {
    const col = map[k];
    const v = col ? row[col]?.trim() : "";
    return v ? `${v}` : null;
  };
  const pairs: [string, string | null][] = [
    ["频道名称", get("name")],
    ["订阅", get("subscribers")],
    ["受众国家", get("audienceCountry")],
    ["均播", get("avgViews")],
    ["互动率", get("engagement")],
    ["邮箱", get("email")],
  ];
  for (const [label, v] of pairs) if (v) parts.push(`${label}:${v}`);
  if (parts.length === 0) return "";
  const date = new Date().toISOString().slice(0, 10);
  return `[${toolLabel} ${date}] ${parts.join("；")}`;
}

export interface ParsedToolRow {
  input: string;
  sourceSummary: string;
  unknownColumns: string[];
}

export interface ToolCsvParseResult {
  map: ToolColumnMap | null;
  rows: ParsedToolRow[];
  totalColumns: number;
}

/** 解析工具导出 CSV 文本；首行表头无频道入口列时返回 map=null（交回纯行解析） */
export function parseToolCsv(
  text: string,
  maxRows: number,
): ToolCsvParseResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length === 0) return { map: null, rows: [], totalColumns: 0 };
  const headers = splitCsvLine(lines[0]);
  const map = detectToolColumns(headers);
  if (!map) return { map: null, rows: [], totalColumns: headers.length };

  const rows: ParsedToolRow[] = [];
  for (const line of lines.slice(1)) {
    if (rows.length >= maxRows) break;
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    const input = (row[map.identifier] ?? "").trim();
    if (!input) continue;
    rows.push({
      input,
      sourceSummary: buildSourceSummary(map, row),
      unknownColumns: headers.filter((h) => !Object.values(map).includes(h)),
    });
  }
  return { map, rows, totalColumns: headers.length };
}
