import { describe, it, expect } from "vitest";
import {
  dateInTz,
  contactReminders,
  buildTodoItems,
  type Candidate,
  type ContactEventRow,
  type TaskRow,
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
  api_cache: [],
  tasks: [],
  assessment: [],
  contact_events: [],
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
