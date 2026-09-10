import { useImperativeHandle, useMemo, useState } from "react";
import type { Ref } from "react";
import { useNotify } from "ra-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  contactReminders,
  dateInTz,
  isReviewStale,
  latestAssessment,
  openTask,
  remindersEnabled,
  saveAssessment,
  saveDraft,
  videos,
  type AssessmentDraft,
  type CheckKey,
  type CheckValue,
  type Candidate,
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
  ref,
}: {
  candidate: Candidate;
  workspace: Workspace;
  onClose: () => void;
  onChanged: () => void;
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
  const dirty = snapshot(form) !== baseline;

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

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
        dataVersion: null,
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
        dataVersion: latest.data_version,
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
          <h3 className="font-semibold">公开资料</h3>
          {ch ? (
            <div className="text-sm space-y-1">
              <div>
                订阅数：{" "}
                {ch.raw.subscriber_count != null
                  ? ch.raw.subscriber_count.toLocaleString()
                  : "未知"}
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
            </p>
            {vids.map((v) => (
              <div
                key={v.id}
                className="text-sm border rounded p-2 flex justify-between gap-2"
              >
                <span className="min-w-0 truncate">{v.raw.title}</span>
                <span className="text-muted-foreground shrink-0">
                  {v.raw.published_at?.slice(0, 10)} · 观看{" "}
                  {v.raw.view_count ?? "未知"} · 赞 {v.raw.like_count ?? "未知"}{" "}
                  · 评论 {v.raw.comment_count ?? "未知"}
                </span>
              </div>
            ))}
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

        {/* 联系区（M1 只读时间线 + 提醒；记录/撤销按钮在 M3） */}
        <section className="space-y-2">
          <h3 className="font-semibold">联系记录</h3>
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
          {(candidate.contact_events ?? []).filter((e) => e.voided_at === null)
            .length === 0 ? (
            <p className="text-sm text-muted-foreground">无联系记录</p>
          ) : (
            <div className="text-sm space-y-1">
              {(candidate.contact_events ?? [])
                .filter((e) => e.voided_at === null)
                .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
                .map((e) => (
                  <div key={e.id}>
                    {e.type === "sent" ? "发信" : "回复"} ·{" "}
                    {e.occurred_at.slice(0, 10)}
                    {e.note ? ` · ${e.note}` : ""}
                  </div>
                ))}
            </div>
          )}
        </section>
      </div>

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
