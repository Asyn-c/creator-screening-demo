import { describe, it, expect } from "vitest";
import {
  dateInTz,
  contactReminders,
  buildTodoItems,
  normalizeChannelInput,
  parseImportText,
  buildCandidatesCsv,
  exportScopeCandidates,
  isActionable,
  type Candidate,
  type ContactEventRow,
  type TaskRow,
  type Workspace,
} from "./workbenchApi";

const baseCandidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: 1,
  first_name: "测试",
  last_name: null,
  channel_input: null,
  channel_id: "demo:t",
  screening_decision: "unassessed",
  screening_reason: null,
  do_not_contact: false,
  do_not_contact_reason: null,
  workspace_id: 1,
  assessment_draft: null,
  source_note: null,
  data_version: 0,
  api_cache: [],
  tasks: [],
  assessment: [],
  contact_events: [],
  ...overrides,
});

const baseWorkspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: 1,
  sales_id: 1,
  mode: "real",
  product: "激光水平仪",
  scene: "DIY",
  market: "美国",
  brief_version: 1,
  ...overrides,
});

const sentEvent = (
  hoursAgo: number,
  now: Date,
  overrides: Partial<ContactEventRow> = {},
): ContactEventRow => ({
  id: Math.random(),
  type: "sent",
  occurred_at: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
  note: null,
  voided_at: null,
  ...overrides,
});

const task = (dueDate: string, id: number): TaskRow => ({
  id,
  type: "collect_info",
  text: null,
  due_date: `${dueDate}T04:00:00.000Z`, // UTC 04:00 = 上海 12:00，自然日不跨
  done_date: null,
  cancelled_at: null,
});

describe("dateInTz", () => {
  it("converts UTC timestamps to Asia/Shanghai calendar date", () => {
    // 上海 = UTC+8：16:00Z 已是次日 00:00
    expect(dateInTz("2026-09-09T16:00:00Z")).toBe("2026-09-10");
    expect(dateInTz("2026-09-09T15:59:00Z")).toBe("2026-09-09");
  });
});

describe("contactReminders (PRD F4)", () => {
  // 固定时钟：2026-09-09 12:00 UTC
  const NOW = new Date("2026-09-09T12:00:00Z");

  it("does not trigger interval reminder at exactly 168 hours", () => {
    const c = baseCandidate({
      contact_events: [sentEvent(168, NOW)],
    });
    expect(contactReminders(c, NOW)).toEqual([]);
  });

  it("triggers interval reminder at 167h59m", () => {
    const c = baseCandidate({
      contact_events: [sentEvent(168 - 1 / 60, NOW)],
    });
    expect(contactReminders(c, NOW).map((r) => r.kind)).toEqual(["interval"]);
  });

  it("triggers count reminder at exactly 5 valid sends, not at 4", () => {
    const at4 = baseCandidate({
      contact_events: [
        sentEvent(200, NOW),
        sentEvent(210, NOW),
        sentEvent(220, NOW),
        sentEvent(230, NOW),
      ],
    });
    expect(contactReminders(at4, NOW)).toEqual([]);

    const at5 = baseCandidate({
      contact_events: [
        sentEvent(200, NOW),
        sentEvent(210, NOW),
        sentEvent(220, NOW),
        sentEvent(230, NOW),
        sentEvent(240, NOW),
      ],
    });
    expect(contactReminders(at5, NOW).map((r) => r.kind)).toEqual(["count"]);
  });

  it("excludes voided events and replied events from both rules", () => {
    // 4 有效 sent + 1 已撤销 sent + 1 replied（且最近一次有效 sent 在 168h 内由撤销前的旧事件构成？——撤销后按有效集合重算）
    const c = baseCandidate({
      contact_events: [
        sentEvent(200, NOW),
        sentEvent(210, NOW),
        sentEvent(220, NOW),
        sentEvent(230, NOW),
        sentEvent(2, NOW, { voided_at: new Date().toISOString() }), // 已撤销，不应触发 interval
        {
          id: 99,
          type: "replied",
          occurred_at: new Date(NOW.getTime() - 3_600_000).toISOString(),
          note: null,
          voided_at: null,
        },
      ],
    });
    expect(contactReminders(c, NOW)).toEqual([]);
  });

  it("recomputes from valid events after backdating an earlier one", () => {
    // 最近有效发信 20 天前：不触发 interval；5 次有效：触发 count
    const c = baseCandidate({
      contact_events: [
        sentEvent(24 * 20, NOW),
        sentEvent(24 * 21, NOW),
        sentEvent(24 * 22, NOW),
        sentEvent(24 * 23, NOW),
        sentEvent(24 * 25, NOW),
      ],
    });
    const r = contactReminders(c, NOW);
    expect(r.map((x) => x.kind)).toEqual(["count"]);
  });
});

describe("buildTodoItems (PRD §4.3)", () => {
  const NOW = new Date("2026-09-09T04:00:00Z"); // 上海 2026-09-09 12:00

  it("groups overdue / today / later and today is not overdue", () => {
    const cOverdue = baseCandidate({ tasks: [task("2026-09-08", 1)] });
    const cToday = baseCandidate({ tasks: [task("2026-09-09", 2)] });
    const cLater = baseCandidate({ tasks: [task("2026-09-10", 3)] });
    const { items, counts } = buildTodoItems([cOverdue, cToday, cLater], NOW);
    expect(counts).toEqual({ overdue: 1, today: 1, later: 1 });
    expect(items.map((i) => i.group)).toEqual(["overdue", "today", "later"]);
  });

  it("cross-midnight UTC dates use Asia/Shanghai calendar day", () => {
    // due 2026-09-09T16:00:00Z = 上海 2026-09-10 → later
    const c = baseCandidate({
      tasks: [
        { ...task("2026-09-09", 1), due_date: "2026-09-09T16:00:00.000Z" },
      ],
    });
    const { items } = buildTodoItems([c], NOW);
    expect(items[0]?.group).toBe("later");
  });

  it("excludes done and cancelled tasks", () => {
    const c = baseCandidate({
      tasks: [
        { ...task("2026-09-08", 1), done_date: "2026-09-08T10:00:00Z" },
        { ...task("2026-09-08", 2), cancelled_at: "2026-09-08T10:00:00Z" },
      ],
    });
    const { items, counts } = buildTodoItems([c], NOW);
    expect(items).toEqual([]);
    expect(counts).toEqual({ overdue: 0, today: 0, later: 0 });
  });

  it("sorts by due date then task id within a group", () => {
    const a = baseCandidate({ id: 10, tasks: [task("2026-09-11", 5)] });
    const b = baseCandidate({ id: 11, tasks: [task("2026-09-10", 6)] });
    const d = baseCandidate({ id: 12, tasks: [task("2026-09-10", 7)] });
    const { items } = buildTodoItems([a, b, d], NOW);
    expect(items.map((i) => i.task.id)).toEqual([6, 7, 5]);
  });
});

describe("normalizeChannelInput (PRD F1)", () => {
  it("accepts bare UC channel IDs (case-sensitive)", () => {
    expect(normalizeChannelInput("UCXuqSBlHAE6Xw-yeJA0Tunw")).toEqual({
      ok: true,
      kind: "channel_id",
      channel_id: "UCXuqSBlHAE6Xw-yeJA0Tunw",
    });
    // 小写 uc / 位数不足不是合法 ID
    expect(normalizeChannelInput("ucXuqSBlHAE6Xw-yeJA0Tunw").ok).toBe(false);
    expect(normalizeChannelInput("UCshort").ok).toBe(false);
  });

  it("accepts bare @handle", () => {
    expect(normalizeChannelInput("@linustechtips")).toEqual({
      ok: true,
      kind: "handle",
      channel_id: "@linustechtips",
    });
  });

  it("accepts /channel/ and /@ URLs with www/m, trailing slash, query params", () => {
    expect(
      normalizeChannelInput(
        "https://www.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw?si=abc",
      ),
    ).toEqual({
      ok: true,
      kind: "channel_id",
      channel_id: "UCXuqSBlHAE6Xw-yeJA0Tunw",
    });
    expect(normalizeChannelInput("https://m.youtube.com/@somehandle/")).toEqual(
      { ok: true, kind: "handle", channel_id: "@somehandle" },
    );
  });

  it("rejects video / short / legacy /c//user/ links with explicit reason", () => {
    expect(
      normalizeChannelInput("https://www.youtube.com/watch?v=abc").error,
    ).toContain("视频链接不支持");
    expect(normalizeChannelInput("https://youtu.be/abc123").error).toContain(
      "短链接不支持",
    );
    expect(
      normalizeChannelInput("https://www.youtube.com/c/somename").error,
    ).toContain("不支持");
    expect(
      normalizeChannelInput("https://www.youtube.com/user/somename").error,
    ).toContain("不支持");
  });
});

describe("parseImportText", () => {
  it("classifies new / exists / invalid / duplicate with exclusive counts", () => {
    const rows = parseImportText(
      [
        "UCXuqSBlHAE6Xw-yeJA0Tunw",
        "@newhandle",
        "UCXuqSBlHAE6Xw-yeJA0Tunw",
        "https://youtu.be/bad",
        "# comment line",
        "",
      ].join("\n"),
      ["@newhandle"],
    );
    expect(rows.map((r) => r.status)).toEqual([
      "new",
      "exists",
      "duplicate",
      "invalid",
    ]);
  });
});

describe("candidates CSV export (PRD F5)", () => {
  const ws = baseWorkspace();
  const make = (o: Partial<Candidate>) => baseCandidate(o);

  it("filters actionable scope: decision + open task + not dnc + not stale", () => {
    const pcOk = make({
      id: 1,
      channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa",
      screening_decision: "priority_contact",
      tasks: [task("2026-09-10", 1)],
    });
    const paused = make({ id: 2, screening_decision: "paused" });
    const dnc = make({
      id: 3,
      screening_decision: "needs_info",
      do_not_contact: true,
      tasks: [task("2026-09-10", 2)],
    });
    const noTask = make({ id: 4, screening_decision: "needs_info" });
    const stale = make({
      id: 5,
      screening_decision: "needs_info",
      tasks: [task("2026-09-10", 3)],
      data_version: 2,
      assessment: [
        {
          id: 1,
          scene_fit: "unknown",
          entity_fit: "unknown",
          audience_evidence: "unknown",
          content_scale_fit: "unknown",
          category_experience: "unknown",
          decision: "needs_info",
          reason: "r",
          evidence: null,
          open_questions: null,
          brief_version: 1,
          data_version: 1,
          created_at: "2026-09-01T00:00:00Z",
        },
      ],
    });
    const picked = exportScopeCandidates(
      [pcOk, paused, dnc, noTask, stale],
      ws,
      "actionable",
    );
    expect(picked.map((c) => c.id)).toEqual([1]);
    expect(isActionable(pcOk, ws)).toBe(true);
  });

  it("escapes quotes/commas/newlines and neutralizes formula prefixes", () => {
    const c = make({
      channel_input: "=SUM(A1)",
      channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa",
      assessment: [
        {
          id: 1,
          scene_fit: "unknown",
          entity_fit: "unknown",
          audience_evidence: "unknown",
          content_scale_fit: "unknown",
          category_experience: "unknown",
          decision: "needs_info",
          reason: '他说"贵"，然后走了',
          evidence: null,
          open_questions: "第一行\n第二行",
          brief_version: 1,
          data_version: 0,
          created_at: "2026-09-01T00:00:00Z",
        },
      ],
    });
    const csv = buildCandidatesCsv([c], ws, "filtered");
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(csv).toContain("'=SUM(A1)"); // 公式前缀被中和
    expect(csv).toContain('"他说""贵""，然后走了"'); // 引号转义
    expect(csv).toContain('"第一行\n第二行"'); // 换行封在单元格内
  });

  it("marks demo rows data_mode=synthetic and real rows real", () => {
    const demo = make({ channel_id: "demo:01" });
    const real = make({ channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa" });
    const csv = buildCandidatesCsv([demo, real], ws, "filtered");
    expect(csv).toContain("synthetic");
    expect(csv).toContain("real");
    // demo 频道不生成 channel_url
    expect(csv).not.toContain("youtube.com/channel/demo:01");
  });
});
