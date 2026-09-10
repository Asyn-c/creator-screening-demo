import { getSupabaseClient } from "../providers/supabase/supabase";

/**
 * 初筛工作台数据访问层（M1/T12）
 * 隔离规则：所有查询/写入都必须携带 workspace_id —— 本地单操作者演示版，
 * 多租户 RLS 加固见 PRD v0.2 §6（P2）。
 */

export type Mode = "real" | "demo";
export type Decision =
  | "unassessed"
  | "priority_contact"
  | "needs_info"
  | "paused";
export type CheckValue = "yes" | "no" | "unknown";
export type TaskType =
  | "collect_info"
  | "first_contact"
  | "follow_up"
  | "review";

export const CHECK_KEYS = [
  "scene_fit",
  "entity_fit",
  "audience_evidence",
  "content_scale_fit",
  "category_experience",
] as const;
export type CheckKey = (typeof CHECK_KEYS)[number];

export const CHECK_LABELS: Record<CheckKey, string> = {
  scene_fit: "内容场景适配",
  entity_fit: "主体适合合作",
  audience_evidence: "受众市场依据",
  content_scale_fit: "内容与量级可接受",
  category_experience: "品类经验",
};

export const DECISION_LABELS: Record<Decision, string> = {
  unassessed: "未评估",
  priority_contact: "优先联系",
  needs_info: "待补资料",
  paused: "暂缓",
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  collect_info: "补资料",
  first_contact: "首次联系",
  follow_up: "跟进",
  review: "复核",
};

export interface Workspace {
  id: number;
  sales_id: number;
  mode: Mode;
  product: string | null;
  scene: string | null;
  market: string | null;
  brief_version: number;
}

export interface ApiCacheRow {
  id: number;
  kind: "channel" | "video";
  raw: {
    title?: string;
    description?: string;
    subscriber_count?: number | null;
    country?: string | null;
    published_at?: string;
    view_count?: number | null;
    like_count?: number | null;
    comment_count?: number | null;
  };
  source: string;
  fetched_at: string;
  expires_at: string;
}

export interface TaskRow {
  id: number;
  type: string | null;
  text: string | null;
  due_date: string;
  done_date: string | null;
  cancelled_at: string | null;
}

export interface AssessmentRow {
  id: number;
  scene_fit: CheckValue;
  entity_fit: CheckValue;
  audience_evidence: CheckValue;
  content_scale_fit: CheckValue;
  category_experience: CheckValue;
  decision: Decision;
  reason: string;
  evidence: string | null;
  open_questions: string | null;
  brief_version: number;
  data_version: number | null;
  created_at: string;
}

/** 编辑中的用户草稿：与已提交评估分离，提交成功后被清除（PRD §4.1 补充约定） */
export interface AssessmentDraft {
  checks: Record<CheckKey, CheckValue>;
  decision: Decision;
  reason: string;
  evidence: string;
  openQuestions: string;
  taskType: TaskType | "";
  taskDue: string;
  saved_at: string;
}

export interface ContactEventRow {
  id: number;
  type: "sent" | "replied";
  occurred_at: string;
  note: string | null;
  voided_at: string | null;
}

export interface Candidate {
  id: number;
  first_name: string | null;
  last_name: string | null;
  channel_input: string | null;
  channel_id: string | null;
  screening_decision: Decision;
  screening_reason: string | null;
  do_not_contact: boolean;
  do_not_contact_reason: string | null;
  workspace_id: number;
  assessment_draft: AssessmentDraft | null;
  api_cache: ApiCacheRow[];
  tasks: TaskRow[];
  assessment: AssessmentRow[];
  contact_events: ContactEventRow[];
}

const MODE_KEY = "workbench.mode";
const REMINDERS_KEY = "workbench.reminders";

export function getMode(): Mode {
  const m = localStorage.getItem(MODE_KEY);
  return m === "demo" ? "demo" : "real";
}

export function setMode(mode: Mode) {
  localStorage.setItem(MODE_KEY, mode);
}

/** 提醒展示开关（PRD F4：默认开启，关闭仅影响提醒展示） */
export function remindersEnabled(): boolean {
  return localStorage.getItem(REMINDERS_KEY) !== "off";
}

export function setRemindersEnabled(on: boolean) {
  localStorage.setItem(REMINDERS_KEY, on ? "on" : "off");
}

export async function fetchWorkspaces(): Promise<Workspace[]> {
  const { data, error } = await getSupabaseClient()
    .from("workspace")
    .select("*")
    .order("id");
  if (error) throw error;
  return (data ?? []) as Workspace[];
}

export async function updateTaskBackground(
  wsId: number,
  patch: { product: string; scene: string; market: string },
): Promise<Workspace> {
  // 读当前版本 → 写回并递增 brief_version（任务背景变化触发旧判断待复核）
  const { data: cur, error: e1 } = await getSupabaseClient()
    .from("workspace")
    .select("brief_version")
    .eq("id", wsId)
    .single();
  if (e1) throw e1;
  const { data, error } = await getSupabaseClient()
    .from("workspace")
    .update({
      product: patch.product,
      scene: patch.scene,
      market: patch.market,
      brief_version: (cur?.brief_version ?? 0) + 1,
    })
    .eq("id", wsId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Workspace;
}

export async function fetchCandidates(wsId: number): Promise<Candidate[]> {
  const { data, error } = await getSupabaseClient()
    .from("contacts")
    .select(
      `id, first_name, last_name, channel_input, channel_id, screening_decision,
       screening_reason, do_not_contact, do_not_contact_reason, workspace_id, assessment_draft,
       api_cache(id, kind, raw, source, fetched_at, expires_at),
       tasks(id, type, text, due_date, done_date, cancelled_at),
       assessment(id, scene_fit, entity_fit, audience_evidence, content_scale_fit,
                  category_experience, decision, reason, evidence, open_questions,
                  brief_version, data_version, created_at),
       contact_events(id, type, occurred_at, note, voided_at)`,
    )
    .eq("workspace_id", wsId)
    .order("id");
  if (error) throw error;
  return (data ?? []) as unknown as Candidate[];
}

export interface SaveAssessmentInput {
  candidateId: number;
  workspaceId: number;
  checks: Record<CheckKey, CheckValue>;
  decision: Exclude<Decision, "unassessed">;
  reason: string;
  evidence: string | null;
  openQuestions: string | null;
  briefVersion: number;
  dataVersion: number | null;
  taskType: TaskType | null;
  taskDue: string | null; // YYYY-MM-DD
  /** 显式复核（「确认仍适用」）：内容不变也追加一条复核版本 */
  forceVersion?: boolean;
}

export async function saveAssessment(
  input: SaveAssessmentInput,
): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc("save_assessment", {
    p_candidate_id: input.candidateId,
    p_workspace_id: input.workspaceId,
    p_scene_fit: input.checks.scene_fit,
    p_entity_fit: input.checks.entity_fit,
    p_audience_evidence: input.checks.audience_evidence,
    p_content_scale_fit: input.checks.content_scale_fit,
    p_category_experience: input.checks.category_experience,
    p_decision: input.decision,
    p_reason: input.reason,
    p_evidence: input.evidence,
    p_open_questions: input.openQuestions,
    p_brief_version: input.briefVersion,
    p_data_version: input.dataVersion,
    p_task_type: input.taskType,
    p_task_due: input.taskDue,
    p_force_version: input.forceVersion ?? false,
  });
  if (error) throw error;
  return data as number;
}

// ---------- 草稿（临时保存，不进入可行动名单、不触碰 screening_decision） ----------

export async function saveDraft(
  candidateId: number,
  workspaceId: number,
  draft: Omit<AssessmentDraft, "saved_at">,
): Promise<void> {
  const payload: Record<string, unknown> = {
    checks: draft.checks,
    decision: draft.decision,
    reason: draft.reason,
    evidence: draft.evidence,
    open_questions: draft.openQuestions,
    task_type: draft.taskType === "" ? null : draft.taskType,
    task_due: draft.taskDue || null,
    saved_at: new Date().toISOString(),
  };
  const { error } = await getSupabaseClient()
    .from("contacts")
    .update({ assessment_draft: payload })
    .eq("id", candidateId)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
}

export async function clearDraft(
  candidateId: number,
  workspaceId: number,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("contacts")
    .update({ assessment_draft: null })
    .eq("id", candidateId)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
}

// ---------- 完成任务（可选下一步，同事务） ----------

export async function completeTask(input: {
  taskId: number;
  candidateId: number;
  workspaceId: number;
  nextType?: TaskType | null;
  nextDue?: string | null;
  nextNote?: string | null;
}): Promise<void> {
  const { error } = await getSupabaseClient().rpc("complete_task", {
    p_task_id: input.taskId,
    p_candidate_id: input.candidateId,
    p_workspace_id: input.workspaceId,
    p_next_type: input.nextType ?? null,
    p_next_due: input.nextDue ?? null,
    p_next_note: input.nextNote ?? null,
  });
  if (error) throw error;
}

// ---------- 派生工具 ----------

export function latestAssessment(c: Candidate): AssessmentRow | null {
  const rows = [...(c.assessment ?? [])].sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1,
  );
  return rows[0] ?? null;
}

export function openTask(c: Candidate): TaskRow | null {
  return (
    (c.tasks ?? []).find(
      (t) => t.done_date === null && t.cancelled_at === null,
    ) ?? null
  );
}

export function channelStats(c: Candidate): ApiCacheRow | null {
  return (c.api_cache ?? []).find((r) => r.kind === "channel") ?? null;
}

export function videos(c: Candidate): ApiCacheRow[] {
  return (c.api_cache ?? []).filter((r) => r.kind === "video");
}

export function validSentEvents(c: Candidate): ContactEventRow[] {
  return (c.contact_events ?? []).filter(
    (e) => e.type === "sent" && e.voided_at === null,
  );
}

export function lastSentAt(c: Candidate): string | null {
  const evts = validSentEvents(c);
  if (evts.length === 0) return null;
  return evts
    .map((e) => e.occurred_at)
    .sort()
    .reverse()[0];
}

export function isReviewStale(c: Candidate, ws: Workspace): boolean {
  const a = latestAssessment(c);
  if (!a) return false;
  return a.brief_version < ws.brief_version;
}

export function dataStatus(c: Candidate): string {
  const rows = c.api_cache ?? [];
  if (rows.length === 0) return "待获取";
  const ch = channelStats(c);
  const missing = videos(c).some(
    (v) => v.raw.view_count == null || v.raw.like_count == null,
  );
  if (ch && ch.source === "synthetic") return "演示资料";
  return missing ? "部分缺失" : "已获取";
}

export function displayName(c: Candidate): string {
  const n = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return n || c.channel_id || `候选 #${c.id}`;
}

// ---------- 时区日期工具（PRD §7：due_date 按 Asia/Shanghai 自然日，不用 UTC 零点） ----------

/** 默认展示时区：本 Demo 的业务时区 */
export const BUSINESS_TZ = "Asia/Shanghai";

/** 取时间戳在指定时区的自然日期（YYYY-MM-DD） */
export function dateInTz(d: Date | string, tz: string = BUSINESS_TZ): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts; // en-CA 输出即 YYYY-MM-DD
}

// ---------- 提醒规则（PRD F4：仅两条固定 Demo 规则，可关闭展示） ----------

export const SENT_COUNT_THRESHOLD = 5;
/** 168 小时间隔提醒阈值；恰好 168 小时不触发 */
export const SENT_INTERVAL_HOURS = 168;

export interface ContactReminder {
  kind: "count" | "interval";
  label: string;
}

/** 时钟可注入（now?: Date），默认真实时间 */
export function contactReminders(
  c: Candidate,
  now: Date = new Date(),
): ContactReminder[] {
  const sent = validSentEvents(c);
  const reminders: ContactReminder[] = [];
  if (sent.length >= SENT_COUNT_THRESHOLD) {
    reminders.push({
      kind: "count",
      label: `已累计发信 ${sent.length} 次（达到 ${SENT_COUNT_THRESHOLD} 次提醒线）`,
    });
  }
  const last = lastSentAt(c);
  if (last) {
    const hours = (now.getTime() - new Date(last).getTime()) / 3_600_000;
    if (hours < SENT_INTERVAL_HOURS) {
      reminders.push({
        kind: "interval",
        label: `距最近发信不足 ${SENT_INTERVAL_HOURS} 小时（约 ${Math.floor(hours)} 小时前）`,
      });
    }
  }
  return reminders;
}

// ---------- 待办分组（PRD §4.3：逾期 / 今天 / 之后；今天未完成不算逾期） ----------

export type TodoGroup = "overdue" | "today" | "later";

export interface TodoItem {
  candidate: Candidate;
  task: TaskRow;
  group: TodoGroup;
}

/** 组内排序：日期升序，同日期按任务创建先后（id 升序） */
export function buildTodoItems(
  candidates: Candidate[],
  now: Date = new Date(),
): { items: TodoItem[]; counts: Record<TodoGroup, number> } {
  const today = dateInTz(now);
  const items: TodoItem[] = [];
  for (const c of candidates) {
    const t = openTask(c);
    if (!t) continue;
    const due = dateInTz(t.due_date);
    const group: TodoGroup =
      due < today ? "overdue" : due === today ? "today" : "later";
    items.push({ candidate: c, task: t, group });
  }
  items.sort(
    (a, b) =>
      a.task.due_date.localeCompare(b.task.due_date) || a.task.id - b.task.id,
  );
  const counts: Record<TodoGroup, number> = { overdue: 0, today: 0, later: 0 };
  for (const it of items) counts[it.group]++;
  return { items, counts };
}
