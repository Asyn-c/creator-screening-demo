import { useImperativeHandle, useMemo, useState } from "react";
import type { Ref } from "react";
import { useNotify } from "ra-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CHECK_KEYS,
  CHECK_LABELS,
  DECISION_LABELS,
  TASK_TYPE_LABELS,
  channelStats,
  clearDraft,
  completeTask,
  COMMENT_LIKE_THRESHOLD,
  contactReminders,
  dateInTz,
  deleteCandidate,
  displayName,
  engagementRates,
  fetchChannelData,
  isReviewStale,
  latestAssessment,
  LIKE_VIEW_THRESHOLD,
  openTask,
  recordContactEvent,
  remindersEnabled,
  saveAssessment,
  saveDraft,
  setDoNotContact,
  unsetDoNotContact,
  validSentEvents,
  videoUrl,
  videos,
  voidContactEvent,
  type AssessmentDraft,
  type CheckKey,
  type CheckValue,
  type Candidate,
  type ContactEventType,
  type Decision,
  type TaskType,
  type Workspace,
} from "./workbenchApi";

/** 表单可序列化快照（脏检查基线） */
interface FormState {
  checks: Record<CheckKey, CheckValue>;
  decision: Decision;
  reason: string;
  evidence: string;
  openQuestions: string;
  taskType: TaskType | "";
  taskDue: string;
}

const snapshot = (f: FormState) => JSON.stringify(f);

/** 父组件通过该句柄实现「未保存切换提示」（A19） */
export interface SidebarHandle {
  isDirty: () => boolean;
  saveDraftNow: () => Promise<void>;
}

const THREE_STATE: { value: CheckValue; label: string }[] = [
  { value: "yes", label: "符合" },
  { value: "no", label: "不符合" },
  { value: "unknown", label: "未知" },
];

function initialForm(c: Candidate): FormState {
  const draft = c.assessment_draft;
  if (draft) {
    return {
      checks: draft.checks,
      decision: draft.decision,
      reason: draft.reason ?? "",
      evidence: draft.evidence ?? "",
      openQuestions: draft.openQuestions ?? "",
      taskType: draft.taskType ?? "",
      taskDue: draft.taskDue ?? "",
    };
  }
  const latest = latestAssessment(c);
  if (latest) {
    return {
      checks: {
        scene_fit: latest.scene_fit,
        entity_fit: latest.entity_fit,
        audience_evidence: latest.audience_evidence,
        content_scale_fit: latest.content_scale_fit,
        category_experience: latest.category_experience,
      },
      decision: latest.decision,
      reason: latest.reason ?? "",
      evidence: latest.evidence ?? "",
      openQuestions: latest.open_questions ?? "",
      taskType: "",
      taskDue: "",
    };
  }
  return {
    checks: {
      scene_fit: "unknown",
      entity_fit: "unknown",
      audience_evidence: "unknown",
      content_scale_fit: "unknown",
      category_experience: "unknown",
    },
    decision: "unassessed",
    reason: "",
    evidence: "",
    openQuestions: "",
    taskType: "",
    taskDue: "",
  };
}

export function CandidateDetailSidebar({
  candidate,
  workspace,
  onClose,
  onChanged,
  onDeleted,
  ref,
}: {
  candidate: Candidate;
  workspace: Workspace;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  ref?: Ref<SidebarHandle>;
}) {
  const notify = useNotify();
  const latest = latestAssessment(candidate);
  const stale = isReviewStale(candidate, workspace);
  const ch = channelStats(candidate);
  const vids = videos(candidate);
  const isDemo = candidate.channel_id?.startsWith("demo:");
  const task = openTask(candidate);
  const today = dateInTz(new Date());
  const reminders = useMemo(
    () => (remindersEnabled() ? contactReminders(candidate) : []),
    [candidate],
  );

  const [form, setForm] = useState<FormState>(() => initialForm(candidate));
  const [baseline, setBaseline] = useState(() => snapshot(form));
  const [saving, setSaving] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [logOpen, setLogOpen] = useState<ContactEventType | null>(null);
  const [dncOpen, setDncOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const dirty = snapshot(form) !== baseline;

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const refreshData = async () => {
    setFetching(true);
    try {
      const r = await fetchChannelData(candidate.id, workspace.id);
      if (!r.configured) {
        notify(r.error ?? "自动资料获取未启用（未配置 Key）", {
          type: "warning",
        });
      } else if (r.error) {
        notify(`资料获取失败：${r.error}（已有资料保留，显示旧采集时间）`, {
          type: "error",
        });
      } else {
        notify(
          r.warning ?? `资料已更新：${r.videos} 条近期视频（旧判断将提示复核）`,
          { type: "success" },
        );
        onChanged();
      }
    } catch (e: any) {
      notify(e.message ?? "资料获取失败", { type: "error" });
    } finally {
      setFetching(false);
    }
  };

  const saveDraftNow = async () => {
    try {
      await saveDraft(candidate.id, workspace.id, {
        checks: form.checks,
        decision: form.decision,
        reason: form.reason,
        evidence: form.evidence,
        openQuestions: form.openQuestions,
        taskType: form.taskType,
        taskDue: form.taskDue,
      } satisfies Omit<AssessmentDraft, "saved_at">);
      setBaseline(snapshot(form));
      notify("草稿已保存", { type: "success" });
      onChanged();
    } catch (e: any) {
      // 服务失败保留输入（A19），仅提示
      notify(e.message ?? "草稿保存失败", { type: "error" });
      throw e;
    }
  };

  // 暴露给父级：脏检查 + 「保存草稿并继续」
  // useImperativeHandle: 卸载时 React 自动置 null，避免残留句柄拦截后续切换
  useImperativeHandle(ref, () => ({
    isDirty: () => snapshot(form) !== baseline,
    saveDraftNow,
  }));

  const validate = (): string | null => {
    if (form.decision === "priority_contact") {
      if (!form.reason.trim()) return "优先联系需要填写理由";
      if (!form.evidence.trim()) return "优先联系需要至少一条证据";
      if (form.checks.scene_fit !== "yes")
        return "优先联系要求「内容场景适配=符合」";
      if ((!form.taskType || !form.taskDue) && !task)
        return "优先联系需要设置下一步动作与日期";
    }
    if (form.decision === "needs_info") {
      if (!form.openQuestions.trim()) return "待补资料需要至少一个待确认问题";
      if ((!form.taskType || !form.taskDue) && !task)
        return "待补资料需要设置下一步动作与日期";
    }
    if (form.decision === "paused" && !form.reason.trim())
      return "暂缓需要填写原因";
    return null;
  };

  const save = async () => {
    if (form.decision === "unassessed") {
      notify("请先选择初筛结论（或先保存草稿）", { type: "warning" });
      return;
    }
    const err = validate();
    if (err) {
      notify(err, { type: "warning" });
      return;
    }
    setSaving(true);
    try {
      await saveAssessment({
        candidateId: candidate.id,
        workspaceId: workspace.id,
        checks: form.checks,
        decision: form.decision as Exclude<Decision, "unassessed">,
        reason: form.reason,
        evidence: form.evidence || null,
        openQuestions: form.openQuestions || null,
        briefVersion: workspace.brief_version,
        dataVersion: candidate.data_version ?? 0,
        taskType: form.taskType === "" ? null : (form.taskType as TaskType),
        taskDue: form.taskDue || null,
      });
      notify("初筛结论已保存", { type: "success" });
      setBaseline(snapshot(form));
      onChanged();
    } catch (e: any) {
      // 服务失败保留输入（A19）
      notify(e.message ?? "保存失败", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const confirmStillValid = async () => {
    if (!latest) return;
    setSaving(true);
    try {
      await saveAssessment({
        candidateId: candidate.id,
        workspaceId: workspace.id,
        checks: {
          scene_fit: latest.scene_fit,
          entity_fit: latest.entity_fit,
          audience_evidence: latest.audience_evidence,
          content_scale_fit: latest.content_scale_fit,
          category_experience: latest.category_experience,
        },
        decision: latest.decision as Exclude<Decision, "unassessed">,
        reason: latest.reason,
        evidence: latest.evidence,
        openQuestions: latest.open_questions,
        briefVersion: workspace.brief_version,
        // 确认仍适用 = 已按当前任务背景与当前资料版本重新核对
        dataVersion: candidate.data_version ?? 0,
        taskType: null, // 不动现有 open 任务
        taskDue: null,
        forceVersion: true, // 显式复核：内容不变也记录新版本
      });
      notify("已确认仍适用", { type: "success" });
      onChanged();
    } catch (e: any) {
      notify(e.message ?? "操作失败", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const discardDraft = async () => {
    try {
      await clearDraft(candidate.id, workspace.id);
      const restored = initialForm({ ...candidate, assessment_draft: null });
      setForm(restored);
      setBaseline(snapshot(restored));
      notify("草稿已放弃", { type: "success" });
      onChanged();
    } catch (e: any) {
      notify(e.message ?? "操作失败", { type: "error" });
    }
  };

  const taskOverdue = task ? dateInTz(task.due_date) < today : false;

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-background border-l shadow-xl z-50 overflow-y-auto">
      <div className="p-4 border-b flex items-start justify-between sticky top-0 bg-background z-10">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold">
              {candidate.first_name} {candidate.last_name ?? ""}
            </h2>
            {isDemo && <Badge variant="destructive">演示数据</Badge>}
            {candidate.do_not_contact && (
              <Badge variant="destructive">停止联系</Badge>
            )}
            {stale && <Badge>待复核</Badge>}
            {dirty && <Badge variant="outline">未保存</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            频道 {candidate.channel_id ?? "未知"} ·{" "}
            {ch
              ? `来源 ${ch.source} · 采集 ${ch.fetched_at.slice(0, 10)}`
              : "无资料缓存"}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          关闭
        </Button>
      </div>

      <div className="p-4 space-y-6">
        {/* 资料区 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">公开资料</h3>
            <Button
              size="sm"
              variant="outline"
              onClick={refreshData}
              disabled={fetching}
              title={
                isDemo
                  ? "演示数据不请求真实接口"
                  : "从 YouTube 拉取频道资料与最近视频（需要已配置 API Key）"
              }
            >
              {fetching ? "获取中…" : "更新资料"}
            </Button>
          </div>
          {ch ? (
            <div className="text-sm space-y-1">
              <div>
                订阅数：{" "}
                {ch.raw.subscriber_count != null
                  ? ch.raw.subscriber_count.toLocaleString()
                  : "未知"}
              </div>
              <div>
                频道总播放量：{" "}
                {ch.raw.view_count != null
                  ? ch.raw.view_count.toLocaleString()
                  : "未知"}
                <span className="text-muted-foreground">
                  {" "}
                  · 公开视频{" "}
                  {ch.raw.video_count != null
                    ? ch.raw.video_count.toLocaleString()
                    : "未知"}{" "}
                  条（近 {vids.length} 条见下）
                </span>
              </div>
              <div>
                频道关联国家：{ch.raw.country ?? "未知"}
                <span className="text-muted-foreground">
                  （受众国家可能不同）
                </span>
              </div>
              {ch.raw.description && (
                <div className="text-muted-foreground">
                  {ch.raw.description}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">暂无频道资料</p>
          )}
          <div className="space-y-1">
            <p className="text-sm font-medium">
              近期公开视频：{vids.length} 条
              <span className="text-muted-foreground font-normal">
                （互动率参考：赞/观看 ≥{LIKE_VIEW_THRESHOLD}%、评/赞 ≥
                {COMMENT_LIKE_THRESHOLD}% 绿显）
              </span>
            </p>
            {vids.map((v) => {
              const url = videoUrl(v.raw.video_id);
              const { likeViewRate, commentLikeRate } = engagementRates(v.raw);
              const desc = v.raw.description?.trim();
              const sponsorHit =
                desc && /sponsor|感谢.*赞助|品牌合作/i.test(desc);
              return (
                <div
                  key={v.id}
                  className="text-sm border rounded p-2 space-y-1"
                >
                  <div className="flex justify-between gap-2">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 truncate hover:underline font-medium"
                        title={v.raw.title}
                      >
                        {v.raw.title}
                      </a>
                    ) : (
                      <span className="min-w-0 truncate" title={v.raw.title}>
                        {v.raw.title}
                      </span>
                    )}
                    <span className="text-muted-foreground shrink-0">
                      {v.raw.published_at?.slice(0, 10)}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    观看 {v.raw.view_count?.toLocaleString() ?? "未知"} · 赞{" "}
                    {v.raw.like_count?.toLocaleString() ?? "未知"} · 评论{" "}
                    {v.raw.comment_count?.toLocaleString() ?? "未知"}
                  </div>
                  <div>
                    {likeViewRate != null ? (
                      <span
                        className={
                          likeViewRate >= LIKE_VIEW_THRESHOLD
                            ? "text-green-600 font-medium"
                            : ""
                        }
                      >
                        赞/观看 {likeViewRate}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        赞/观看 未知
                      </span>
                    )}
                    {" · "}
                    {commentLikeRate != null ? (
                      <span
                        className={
                          commentLikeRate >= COMMENT_LIKE_THRESHOLD
                            ? "text-green-600 font-medium"
                            : ""
                        }
                      >
                        评/赞 {commentLikeRate}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">评/赞 未知</span>
                    )}
                  </div>
                  {desc && (
                    <div
                      className="text-muted-foreground line-clamp-2"
                      title={desc}
                    >
                      {sponsorHit && (
                        <Badge
                          variant="outline"
                          className="mr-1 border-amber-500 text-amber-600"
                        >
                          疑似商业植入
                        </Badge>
                      )}
                      {desc}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* 判断区 */}
        <section className="space-y-3">
          <h3 className="font-semibold">人工初筛</h3>
          <div className="text-sm text-muted-foreground">
            任务背景：{workspace.product} · {workspace.scene} ·{" "}
            {workspace.market}（版本 v{workspace.brief_version}）
          </div>

          {stale && (
            <div className="border rounded p-3 text-sm space-y-2 bg-amber-50">
              <p>
                资料或任务背景已变化，上一次判断（
                {latest ? DECISION_LABELS[latest.decision] : ""}）需要复核。
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={confirmStillValid}
                disabled={saving}
              >
                确认仍适用
              </Button>
            </div>
          )}

          {candidate.assessment_draft && (
            <div className="border rounded p-3 text-sm flex items-center justify-between gap-2 bg-blue-50">
              <span>
                已恢复未提交草稿（保存于{" "}
                {candidate.assessment_draft.saved_at
                  .slice(5, 16)
                  .replace("T", " ")}
                ）
              </span>
              <Button size="sm" variant="ghost" onClick={discardDraft}>
                放弃草稿
              </Button>
            </div>
          )}

          {CHECK_KEYS.map((key) => (
            <CheckRow
              key={key}
              label={CHECK_LABELS[key]}
              value={form.checks[key]}
              onChange={(v) => patch({ checks: { ...form.checks, [key]: v } })}
            />
          ))}

          <label className="block text-sm space-y-1">
            <span>初筛结论</span>
            <Select
              value={form.decision}
              onValueChange={(v) => patch({ decision: v as Decision })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DECISION_LABELS) as Decision[]).map((d) => (
                  <SelectItem key={d} value={d}>
                    {DECISION_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="block text-sm space-y-1">
            <span>理由{form.decision === "paused" ? "（必填）" : ""}</span>
            <Textarea
              value={form.reason}
              onChange={(e) => patch({ reason: e.target.value })}
              placeholder="为什么做出这个判断"
            />
          </label>

          <label className="block text-sm space-y-1">
            <span>
              证据
              {form.decision === "priority_contact"
                ? "（必填，链接+你的观察）"
                : "（可选）"}
            </span>
            <Textarea
              value={form.evidence}
              onChange={(e) => patch({ evidence: e.target.value })}
              placeholder="例：某条视频链接 + 该视频展示了什么场景"
            />
          </label>

          <label className="block text-sm space-y-1">
            <span>
              待确认问题
              {form.decision === "needs_info" ? "（必填）" : "（可选）"}
            </span>
            <Textarea
              value={form.openQuestions}
              onChange={(e) => patch({ openQuestions: e.target.value })}
              placeholder="例：受众地区是否以美国为主？"
            />
          </label>

          {form.decision !== "unassessed" && form.decision !== "paused" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm space-y-1">
                <span>下一步动作{task ? "（留空保留现有任务）" : ""}</span>
                <Select
                  value={form.taskType}
                  onValueChange={(v) => patch({ taskType: v as TaskType })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择动作" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TASK_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="text-sm space-y-1">
                <span>日期</span>
                <Input
                  type="date"
                  value={form.taskDue}
                  onChange={(e) => patch({ taskDue: e.target.value })}
                />
              </label>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={save} disabled={saving}>
              {saving ? "保存中…" : "保存初筛结论"}
            </Button>
            <Button
              variant="outline"
              onClick={saveDraftNow}
              disabled={saving}
              title="临时保存编辑内容，不影响已提交结论，也不进入可行动名单"
            >
              保存草稿
            </Button>
          </div>
        </section>

        {/* 下一步任务区 */}
        <section className="space-y-2">
          <h3 className="font-semibold">下一步任务</h3>
          {task ? (
            <div className="text-sm border rounded p-3 space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {TASK_TYPE_LABELS[task.type as TaskType] ?? task.type}
                </span>
                <span
                  className={
                    taskOverdue
                      ? "text-destructive font-medium"
                      : "text-muted-foreground"
                  }
                >
                  {task.due_date.slice(0, 10)}
                  {taskOverdue ? " · 已逾期" : ""}
                </span>
              </div>
              {task.text && (
                <div className="text-muted-foreground">{task.text}</div>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCompleteOpen(true)}
              >
                完成任务
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">未设置下一步</p>
          )}
        </section>

        {/* 联系区：记录/撤销/停止联系（PRD F4） */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">联系记录</h3>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLogOpen("sent")}
              >
                记录已联系
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLogOpen("replied")}
              >
                记录已回复
              </Button>
            </div>
          </div>

          {reminders.length > 0 && (
            <div className="border rounded p-3 text-sm space-y-1 bg-amber-50">
              {reminders.map((r) => (
                <p key={r.kind}>⏰ {r.label}</p>
              ))}
              <p className="text-muted-foreground">
                提醒可在「任务背景设置」中关闭（仅影响展示）
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 text-sm border rounded p-3">
            <span>
              {candidate.do_not_contact ? (
                <>
                  <Badge variant="destructive">停止联系</Badge>
                  <span className="text-muted-foreground ml-2">
                    {candidate.do_not_contact_reason}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  未标记停止联系（有效发信 {validSentEvents(candidate).length}{" "}
                  次）
                </span>
              )}
            </span>
            {candidate.do_not_contact ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDncOpen(true)}
              >
                解除标记
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDncOpen(true)}
              >
                停止联系
              </Button>
            )}
          </div>

          {(candidate.contact_events ?? []).filter((e) => e.voided_at === null)
            .length === 0 ? (
            <p className="text-sm text-muted-foreground">
              无联系记录（不推断从未联系过）
            </p>
          ) : (
            <div className="text-sm space-y-1">
              {(candidate.contact_events ?? [])
                .filter((e) => e.voided_at === null)
                .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
                .map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span>
                      {e.type === "sent" ? "发信" : "回复"} ·{" "}
                      {e.occurred_at.slice(0, 10)}
                      {e.note ? ` · ${e.note}` : ""}
                    </span>
                    <button
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      onClick={async () => {
                        try {
                          await voidContactEvent({
                            eventId: e.id,
                            candidateId: candidate.id,
                            workspaceId: workspace.id,
                          });
                          notify("已撤销（统计排除该记录）", {
                            type: "success",
                          });
                          onChanged();
                        } catch (err: any) {
                          notify(err.message ?? "撤销失败", { type: "error" });
                        }
                      }}
                    >
                      撤销
                    </button>
                  </div>
                ))}
            </div>
          )}
        </section>

        {/* 危险区：单条删除（A20） */}
        <section className="border-t pt-4 space-y-2">
          <h3 className="font-semibold text-destructive">危险操作</h3>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              删除该候选及其评估、任务、联系记录与资料缓存（不可恢复）
            </span>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive shrink-0"
              onClick={() => setDeleteOpen(true)}
            >
              删除候选
            </Button>
          </div>
        </section>
      </div>

      {/* 记录联系事件对话框（sent/replied 补录，未来时间被服务端拒绝） */}
      <LogContactDialog
        candidate={candidate}
        workspace={workspace}
        type={logOpen}
        onClose={() => setLogOpen(null)}
        onDone={() => {
          setLogOpen(null);
          onChanged();
        }}
      />

      {/* 删除候选确认对话框（A20：明确列出将删除的内容并确认） */}
      <DeleteCandidateDialog
        candidate={candidate}
        workspace={workspace}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          setDeleteOpen(false);
          onDeleted();
        }}
      />

      {/* 停止联系 / 解除对话框（原因必填；设置时自动取消联系类任务） */}
      <DoNotContactDialog
        candidate={candidate}
        workspace={workspace}
        open={dncOpen}
        onClose={() => setDncOpen(false)}
        onDone={() => {
          setDncOpen(false);
          onChanged();
        }}
      />

      {/* 完成任务对话框：可选设置新动作与日期 */}
      <CompleteTaskDialog
        candidate={candidate}
        workspace={workspace}
        task={task}
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        onDone={() => {
          setCompleteOpen(false);
          onChanged();
        }}
      />
    </div>
  );
}

function CompleteTaskDialog({
  candidate,
  workspace,
  task,
  open,
  onOpenChange,
  onDone,
}: {
  candidate: Candidate;
  workspace: Workspace;
  task: ReturnType<typeof openTask>;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const notify = useNotify();
  const [nextType, setNextType] = useState<TaskType | "">("");
  const [nextDue, setNextDue] = useState("");
  const [nextNote, setNextNote] = useState("");
  const [saving, setSaving] = useState(false);
  if (!task) return null;

  const complete = async () => {
    if (nextType && !nextDue) {
      notify("选择了新动作时需要填写日期", { type: "warning" });
      return;
    }
    setSaving(true);
    try {
      await completeTask({
        taskId: task.id,
        candidateId: candidate.id,
        workspaceId: workspace.id,
        nextType: nextType === "" ? null : (nextType as TaskType),
        nextDue: nextDue || null,
        nextNote: nextNote || null,
      });
      notify(
        nextType ? "任务已完成，已创建新的下一步" : "任务已完成，暂无下一步",
        { type: "success" },
      );
      setNextType("");
      setNextDue("");
      setNextNote("");
      onDone();
    } catch (e: any) {
      notify(e.message ?? "操作失败", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>完成任务</DialogTitle>
          <DialogDescription>
            {TASK_TYPE_LABELS[task.type as TaskType] ?? task.type} ·{" "}
            {task.due_date.slice(0, 10)}
            。可选择新的下一步动作与日期；不设置则进入「已完成，暂无下一步」。
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm space-y-1">
            <span>新动作（可选）</span>
            <Select
              value={nextType}
              onValueChange={(v) => setNextType(v as TaskType)}
            >
              <SelectTrigger>
                <SelectValue placeholder="不设置" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TASK_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="text-sm space-y-1">
            <span>新日期（选了动作必填）</span>
            <Input
              type="date"
              value={nextDue}
              onChange={(e) => setNextDue(e.target.value)}
            />
          </label>
        </div>
        <label className="text-sm space-y-1 block">
          <span>补充说明（可选）</span>
          <Input
            value={nextNote}
            onChange={(e) => setNextNote(e.target.value)}
            placeholder="一句话说明"
          />
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={complete} disabled={saving}>
            {saving ? "处理中…" : "确认完成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CheckRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CheckValue;
  onChange: (v: CheckValue) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <div className="flex gap-1">
        {THREE_STATE.map((s) => (
          <Button
            key={s.value}
            size="sm"
            variant={value === s.value ? "default" : "outline"}
            onClick={() => onChange(s.value)}
          >
            {s.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** 记录已联系/已回复：实际发生时间（默认现在，可补录过去；未来时间被服务端拒绝） */
function LogContactDialog({
  candidate,
  workspace,
  type,
  onClose,
  onDone,
}: {
  candidate: Candidate;
  workspace: Workspace;
  type: ContactEventType | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const notify = useNotify();
  const [occurredAt, setOccurredAt] = useState(() =>
    new Date().toISOString().slice(0, 16),
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  if (!type) return null;

  const save = async () => {
    setSaving(true);
    try {
      await recordContactEvent({
        candidateId: candidate.id,
        workspaceId: workspace.id,
        type,
        occurredAt: new Date(occurredAt).toISOString(),
        note: note || null,
      });
      notify(
        type === "sent"
          ? "已记录发信（仅统计你确认真实发送的记录）"
          : "已记录回复（不自动判定合作意愿）",
        { type: "success" },
      );
      setNote("");
      onDone();
    } catch (e: any) {
      notify(e.message ?? "记录失败", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {type === "sent" ? "记录已联系" : "记录已回复"}
          </DialogTitle>
          <DialogDescription>
            {type === "sent"
              ? "只有你确认真实发送才记一次；复制内容、导出、创建任务都不算发信。"
              : "记录实际收到回复的时间与摘要；不自动判定同意合作。"}
            时间不能晚于现在（可补录过去）。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="text-sm space-y-1 block">
            <span>实际发生时间</span>
            <Input
              type="datetime-local"
              value={occurredAt}
              max={new Date().toISOString().slice(0, 16)}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </label>
          <label className="text-sm space-y-1 block">
            <span>备注（可选）</span>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                type === "sent"
                  ? "例：首封开发信（Review Invitation）"
                  : "例：对方回复暂不考虑"
              }
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "记录中…" : "确认记录"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 设置/解除停止联系：原因必填；设置时服务端自动取消联系/跟进类 open 任务 */
function DoNotContactDialog({
  candidate,
  workspace,
  open,
  onClose,
  onDone,
}: {
  candidate: Candidate;
  workspace: Workspace;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const notify = useNotify();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  if (!open) return null;
  const isSet = !candidate.do_not_contact;

  const save = async () => {
    if (!reason.trim()) {
      notify("需要填写原因", { type: "warning" });
      return;
    }
    setSaving(true);
    try {
      if (isSet) {
        await setDoNotContact({
          candidateId: candidate.id,
          workspaceId: workspace.id,
          reason,
        });
        notify("已标记停止联系：未完成的联系/跟进任务已取消，历史记录保留", {
          type: "success",
        });
      } else {
        await unsetDoNotContact({
          candidateId: candidate.id,
          workspaceId: workspace.id,
          reason,
        });
        notify("已解除停止联系", { type: "success" });
      }
      setReason("");
      onDone();
    } catch (e: any) {
      notify(e.message ?? "操作失败", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isSet ? "设置停止联系" : "解除停止联系"}</DialogTitle>
          <DialogDescription>
            {isSet
              ? "将自动取消未完成的联系/跟进任务（保留补资料/复核任务），默认可行动名单与导出排除该候选；历史联系记录保留，期间仍可补记历史事实。"
              : "解除后该候选恢复参与可行动名单；解除需再次确认并填写原因。"}
          </DialogDescription>
        </DialogHeader>
        <label className="text-sm space-y-1 block">
          <span>原因（必填）</span>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              isSet
                ? "例：过往合作条款分歧，暂停触达"
                : "例：对方更换商务后恢复联系"
            }
          />
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            variant={isSet ? "destructive" : "default"}
          >
            {saving ? "处理中…" : isSet ? "确认停止联系" : "确认解除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 删除候选确认（A20）：列出将删除的全部内容，勾选确认后执行；跨空间拒绝由服务端兜底 */
function DeleteCandidateDialog({
  candidate,
  workspace,
  open,
  onClose,
  onDeleted,
}: {
  candidate: Candidate;
  workspace: Workspace;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const notify = useNotify();
  const [ack, setAck] = useState(false);
  const [deleting, setDeleting] = useState(false);
  if (!open) return null;

  const n = (v: number | undefined) => v ?? 0;
  const rows = [
    `评估版本 ${n(candidate.assessment?.length)} 条（含全部历史版本与草稿）`,
    `下一步任务 ${n(candidate.tasks?.length)} 条（含已完成/已取消）`,
    `联系事件 ${n(candidate.contact_events?.length)} 条（含已撤销）`,
    `资料缓存 ${n(candidate.api_cache?.length)} 条`,
  ];
  const isDemo = candidate.channel_id?.startsWith("demo:");

  const del = async () => {
    setDeleting(true);
    try {
      const c = await deleteCandidate({
        candidateId: candidate.id,
        workspaceId: workspace.id,
      });
      notify(
        `已删除候选及关联记录：评估 ${c.assessments}、任务 ${c.tasks}、联系事件 ${c.contact_events}、缓存 ${c.api_cache}`,
        { type: "success" },
      );
      onDeleted();
    } catch (e: any) {
      notify(e.message ?? "删除失败", { type: "error" });
      setDeleting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除候选</DialogTitle>
          <DialogDescription>
            将永久删除「{displayName(candidate)}」（
            {candidate.channel_id ?? "无频道标识"}
            ）及其全部关联记录。此操作不可恢复；其他候选与
            {isDemo ? "真实" : "示例"}空间不受影响。
          </DialogDescription>
        </DialogHeader>
        <ul className="text-sm space-y-1 border rounded p-3">
          {rows.map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />
          我已了解将删除以上全部内容，且无法恢复
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={del}
            disabled={!ack || deleting}
          >
            {deleting ? "删除中…" : "确认删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
