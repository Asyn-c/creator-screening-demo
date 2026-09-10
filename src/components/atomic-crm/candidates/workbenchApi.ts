import { getSupabaseClient } from "../providers/supabase/supabase";
import { FunctionsHttpError } from "@supabase/supabase-js";

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
  data_version: number;
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
       data_version,
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

// ---------- 联系事件（sent/replied 补录与撤销）与停止联系 ----------

export type ContactEventType = "sent" | "replied";

export async function recordContactEvent(input: {
  candidateId: number;
  workspaceId: number;
  type: ContactEventType;
  /** ISO 时间戳；服务端拒绝未来时间 */
  occurredAt: string;
  note?: string | null;
}): Promise<void> {
  const { error } = await getSupabaseClient().rpc("record_contact_event", {
    p_candidate_id: input.candidateId,
    p_workspace_id: input.workspaceId,
    p_type: input.type,
    p_occurred_at: input.occurredAt,
    p_note: input.note ?? null,
  });
  if (error) throw error;
}

export async function voidContactEvent(input: {
  eventId: number;
  candidateId: number;
  workspaceId: number;
}): Promise<void> {
  const { error } = await getSupabaseClient().rpc("void_contact_event", {
    p_event_id: input.eventId,
    p_candidate_id: input.candidateId,
    p_workspace_id: input.workspaceId,
  });
  if (error) throw error;
}

export async function setDoNotContact(input: {
  candidateId: number;
  workspaceId: number;
  reason: string;
}): Promise<void> {
  const { error } = await getSupabaseClient().rpc("set_do_not_contact", {
    p_candidate_id: input.candidateId,
    p_workspace_id: input.workspaceId,
    p_reason: input.reason,
  });
  if (error) throw error;
}

export async function unsetDoNotContact(input: {
  candidateId: number;
  workspaceId: number;
  reason: string;
}): Promise<void> {
  const { error } = await getSupabaseClient().rpc("unset_do_not_contact", {
    p_candidate_id: input.candidateId,
    p_workspace_id: input.workspaceId,
    p_reason: input.reason,
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
  if (a.brief_version < ws.brief_version) return true;
  // 外部资料刷新后（data_version 递增），按旧资料做出的判断进入待复核
  if (a.data_version != null && a.data_version < (c.data_version ?? 0))
    return true;
  return false;
}

export function dataStatus(c: Candidate): string {
  const rows = c.api_cache ?? [];
  if (rows.length === 0) {
    // 无缓存：真实空间视为身份未核实/资料未获取，demo 空间不应出现该状态
    return c.channel_id?.startsWith("demo:") ? "待获取" : "未核实";
  }
  const ch = channelStats(c);
  if (ch && new Date(ch.expires_at) < new Date()) return "待更新";
  const missing = videos(c).some(
    (v) => v.raw.view_count == null || v.raw.like_count == null,
  );
  if (ch && ch.source === "synthetic") return "演示资料";
  if (ch && ch.source === "test") return "测试资料";
  return missing ? "部分缺失" : "已获取";
}

export function displayName(c: Candidate): string {
  const n = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  if (n) return n;
  // 展示名回退到资料缓存标题：其生命周期跟随缓存刷新/过期，不写入永久字段
  const title = channelStats(c)?.raw.title;
  return title || c.channel_id || `候选 #${c.id}`;
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

// ---------- 频道入口归一化（PRD F1：先本地预检，未配置 Key 时不冒充已核实身份） ----------

export type ChannelInputKind = "channel_id" | "handle";

export interface NormalizedInput {
  ok: boolean;
  kind?: ChannelInputKind;
  channel_id?: string;
  error?: string;
}

/** UC 频道 ID：24 字符、大小写敏感（UC + 22 个 base64 字符） */
const UC_ID_RE = /^UC[\w-]{22}$/;

export function normalizeChannelInput(raw: string): NormalizedInput {
  const input = raw.trim();
  if (!input) return { ok: false, error: "输入为空" };

  // 1) 裸 UC ID
  if (UC_ID_RE.test(input))
    return { ok: true, kind: "channel_id", channel_id: input };

  // 2) 裸 @handle
  if (/^@[\w.-]{3,30}$/.test(input))
    return { ok: true, kind: "handle", channel_id: input };

  // 3) URL：接受 www/m 域名与末尾斜杠，去掉查询参数
  const urlMatch = input.match(
    /^https?:\/\/(www\.|m\.)?youtube\.com\/(channel\/|@)([^\s/?]+)\/?(?:\?.*)?$/i,
  );
  if (urlMatch) {
    const [, , pathKind, value] = urlMatch;
    if (pathKind === "channel/") {
      if (UC_ID_RE.test(value))
        return { ok: true, kind: "channel_id", channel_id: value };
      return { ok: false, error: `/channel/ 后不是有效的 UC 频道 ID` };
    }
    return { ok: true, kind: "handle", channel_id: `@${value}` };
  }

  // 4) 明确不支持的入口：报原因，不猜测匹配
  if (/youtu\.be\//i.test(input))
    return { ok: false, error: "短链接不支持，请提供频道 ID 或 @handle" };
  if (/youtube\.com\/(watch|shorts)[/]?/i.test(input))
    return { ok: false, error: "视频链接不支持，请提供频道 ID 或 @handle" };
  if (/youtube\.com\/(c|user)\//i.test(input))
    return {
      ok: false,
      error: "旧版 /c/、/user/ 路径不支持，请提供频道 ID 或 @handle",
    };
  if (/youtube\.com/i.test(input))
    return {
      ok: false,
      error: "无法识别的 YouTube 链接，请提供频道 ID 或 @handle",
    };

  return { ok: false, error: "请提供频道 ID（UC…）或 @handle" };
}

// ---------- 导入（本地解析 + 空间内排重；未配置 Key 时不调用外部接口） ----------

export const IMPORT_MAX_ROWS = 20;
export const IMPORT_MAX_BYTES = 1024 * 1024;

export interface ImportRowResult {
  line: number;
  input: string;
  status: "new" | "exists" | "invalid" | "duplicate";
  channel_id?: string;
  error?: string;
}

/** 解析多行输入（每行一个入口）；返回逐行结果，不写库 */
export function parseImportText(
  text: string,
  existingChannelIds: string[],
): ImportRowResult[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  const seen = new Set<string>();
  const existing = new Set(existingChannelIds);
  return lines.map((line, i) => {
    const norm = normalizeChannelInput(line);
    if (!norm.ok) {
      return {
        line: i + 1,
        input: line,
        status: "invalid" as const,
        error: norm.error,
      };
    }
    const cid = norm.channel_id!;
    if (seen.has(cid)) {
      return {
        line: i + 1,
        input: line,
        status: "duplicate" as const,
        channel_id: cid,
      };
    }
    seen.add(cid);
    if (existing.has(cid)) {
      return {
        line: i + 1,
        input: line,
        status: "exists" as const,
        channel_id: cid,
      };
    }
    return {
      line: i + 1,
      input: line,
      status: "new" as const,
      channel_id: cid,
    };
  });
}

export interface ImportCounts {
  total: number;
  created: number;
  existed: number;
  invalid: number;
  duplicate: number;
}

export async function importCandidates(
  wsId: number,
  results: ImportRowResult[],
): Promise<ImportCounts> {
  const salesIdRes = await getSupabaseClient()
    .from("workspace")
    .select("sales_id")
    .eq("id", wsId)
    .single();
  if (salesIdRes.error) throw salesIdRes.error;

  const toCreate = results.filter((r) => r.status === "new" && r.channel_id);
  for (const r of toCreate) {
    // 未配置 Key 时身份未经官方接口核实：channel_id 直接承载规范化入口（UC ID 或 @handle），
    // 资料状态显示「未核实」，配置 Key 后用「更新资料」完成核实
    const { error } = await getSupabaseClient().from("contacts").insert({
      workspace_id: wsId,
      sales_id: salesIdRes.data.sales_id,
      channel_input: r.input,
      channel_id: r.channel_id,
      screening_decision: "unassessed",
    });
    if (error) throw error;
  }
  const counts: ImportCounts = {
    total: results.length,
    created: toCreate.length,
    existed: results.filter((r) => r.status === "exists").length,
    invalid: results.filter((r) => r.status === "invalid").length,
    duplicate: results.filter((r) => r.status === "duplicate").length,
  };
  // 互斥计数校验：总和必须等于总行数
  if (
    counts.created + counts.existed + counts.invalid + counts.duplicate !==
    counts.total
  ) {
    throw new Error("导入计数不一致");
  }
  return counts;
}

// ---------- CSV 导出（PRD F5：17 字段、BOM、转义、公式防护、模式标记） ----------

export type ExportScope = "actionable" | "filtered";

export const EXPORT_COLUMNS = [
  "channel_input",
  "channel_id",
  "channel_url",
  "channel_name",
  "source_note",
  "decision",
  "reason",
  "evidence_refs",
  "open_questions",
  "next_action",
  "next_action_date",
  "last_contact_at",
  "contact_count",
  "do_not_contact",
  "reviewed_at",
  "review_stale",
  "data_mode",
] as const;

/** 可行动名单条件（PRD §4.3）：正式候选 + 优先联系/待补资料 + open 任务 + 未停止联系 + 非待复核 */
export function isActionable(c: Candidate, ws: Workspace): boolean {
  if (c.channel_id == null) return false;
  if (
    c.screening_decision !== "priority_contact" &&
    c.screening_decision !== "needs_info"
  )
    return false;
  if (!openTask(c)) return false;
  if (c.do_not_contact) return false;
  if (isReviewStale(c, ws)) return false;
  return true;
}

export function exportScopeCandidates(
  candidates: Candidate[],
  ws: Workspace,
  scope: ExportScope,
): Candidate[] {
  return scope === "actionable"
    ? candidates.filter((c) => isActionable(c, ws))
    : candidates;
}

/** 单元格转义：含逗号/引号/换行加引号；以 =+-@ 开头按表格安全文本转义（防公式执行） */
function csvCell(value: string): string {
  const v =
    /^[=+@]/.test(value) || /^-[^0-9]/.test(value) || /^-$/.test(value)
      ? `'${value}`
      : value;
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function buildCandidatesCsv(
  candidates: Candidate[],
  ws: Workspace,
  scope: ExportScope,
): string {
  const rows = exportScopeCandidates(candidates, ws, scope);
  const lines = [EXPORT_COLUMNS.join(",")];
  for (const c of rows) {
    const latest = latestAssessment(c);
    const task = openTask(c);
    const isDemo = c.channel_id?.startsWith("demo:") || ws.mode === "demo";
    const cells = [
      c.channel_input ?? "",
      c.channel_id ?? "",
      c.channel_id && /^UC[\w-]{22}$/.test(c.channel_id)
        ? `https://www.youtube.com/channel/${c.channel_id}`
        : "",
      displayName(c),
      "", // source_note：本版无独立来源备注列
      DECISION_LABELS[c.screening_decision],
      latest?.reason ?? "",
      latest?.evidence ?? "",
      latest?.open_questions ?? "",
      task ? (TASK_TYPE_LABELS[task.type as TaskType] ?? task.type ?? "") : "",
      task ? dateInTz(task.due_date) : "",
      lastSentAt(c)?.slice(0, 10) ?? "",
      String(validSentEvents(c).length),
      c.do_not_contact ? "TRUE" : "FALSE",
      latest ? dateInTz(latest.created_at) : "",
      isReviewStale(c, ws) ? "TRUE" : "FALSE",
      isDemo ? "synthetic" : "real",
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  // UTF-8 BOM：Excel/Sheets 直接打开不乱码
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- 资料获取（Edge Function 服务端持有 Key；示例空间不请求真实接口） ----------

export interface FetchResult {
  configured: boolean;
  error?: string;
  videos?: number;
  warning?: string;
}

export async function fetchChannelData(
  candidateId: number,
  workspaceId: number,
): Promise<FetchResult> {
  const { data, error } = await getSupabaseClient().functions.invoke(
    "youtube-fetch",
    { body: { candidate_id: candidateId, workspace_id: workspaceId } },
  );
  if (error) {
    if (error instanceof FunctionsHttpError) {
      // 函数返回非 2xx：错误原因在 context（原始 Response）里
      const body = await (error as any).context?.json?.().catch(() => null);
      return {
        configured: true,
        error: (body as any)?.error ?? "资料获取失败",
      };
    }
    return {
      configured: true,
      error: (error as any).message ?? "资料获取失败",
    };
  }
  return data as FetchResult;
}
