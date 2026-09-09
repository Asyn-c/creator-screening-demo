import { useState } from "react";
import { useNotify } from "ra-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  isReviewStale,
  latestAssessment,
  saveAssessment,
  videos,
  type CheckKey,
  type CheckValue,
  type Candidate,
  type Decision,
  type TaskType,
  type Workspace,
} from "./workbenchApi";

export interface EditableAssessment {
  checks: Record<CheckKey, CheckValue>;
  decision: Decision;
  reason: string;
  evidence: string;
  openQuestions: string;
  taskType: TaskType | "";
  taskDue: string;
}

const THREE_STATE: { value: CheckValue; label: string }[] = [
  { value: "yes", label: "符合" },
  { value: "no", label: "不符合" },
  { value: "unknown", label: "未知" },
];

export function CandidateDetailSidebar({
  candidate,
  workspace,
  onClose,
  onChanged,
}: {
  candidate: Candidate;
  workspace: Workspace;
  onClose: () => void;
  onChanged: () => void;
}) {
  const notify = useNotify();
  const latest = latestAssessment(candidate);
  const stale = isReviewStale(candidate, workspace);
  const ch = channelStats(candidate);
  const vids = videos(candidate);
  const isDemo = candidate.channel_id?.startsWith("demo:");

  const [checks, setChecks] = useState<Record<CheckKey, CheckValue>>({
    scene_fit: latest?.scene_fit ?? "unknown",
    entity_fit: latest?.entity_fit ?? "unknown",
    audience_evidence: latest?.audience_evidence ?? "unknown",
    content_scale_fit: latest?.content_scale_fit ?? "unknown",
    category_experience: latest?.category_experience ?? "unknown",
  });
  const [decision, setDecision] = useState<Decision>(
    latest?.decision ?? "unassessed",
  );
  const [reason, setReason] = useState(latest?.reason ?? "");
  const [evidence, setEvidence] = useState(latest?.evidence ?? "");
  const [openQuestions, setOpenQuestions] = useState(
    latest?.open_questions ?? "",
  );
  const [taskType, setTaskType] = useState<TaskType | "">("");
  const [taskDue, setTaskDue] = useState("");
  const [saving, setSaving] = useState(false);

  const validate = (): string | null => {
    if (decision === "priority_contact") {
      if (!reason.trim()) return "优先联系需要填写理由";
      if (!evidence.trim()) return "优先联系需要至少一条证据";
      if (checks.scene_fit !== "yes")
        return "优先联系要求「内容场景适配=符合」";
      if (!taskType || !taskDue) return "优先联系需要设置下一步动作与日期";
    }
    if (decision === "needs_info") {
      if (!openQuestions.trim()) return "待补资料需要至少一个待确认问题";
      if (!taskType || !taskDue) return "待补资料需要设置下一步动作与日期";
    }
    if (decision === "paused" && !reason.trim()) return "暂缓需要填写原因";
    return null;
  };

  const save = async () => {
    if (decision === "unassessed") {
      notify("请先选择初筛结论", { type: "warning" });
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
        checks,
        decision: decision as Exclude<Decision, "unassessed">,
        reason,
        evidence: evidence || null,
        openQuestions: openQuestions || null,
        briefVersion: workspace.brief_version,
        dataVersion: null,
        taskType: taskType === "" ? null : (taskType as TaskType),
        taskDue: taskDue || null,
      });
      notify("初筛结论已保存", { type: "success" });
      onChanged();
    } catch (e: any) {
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
        taskType: null,
        taskDue: null,
      });
      notify("已确认仍适用", { type: "success" });
      onChanged();
    } catch (e: any) {
      notify(e.message ?? "操作失败", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

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

          {CHECK_KEYS.map((key) => (
            <CheckRow
              key={key}
              label={CHECK_LABELS[key]}
              value={checks[key]}
              onChange={(v) => setChecks((c) => ({ ...c, [key]: v }))}
            />
          ))}

          <label className="block text-sm space-y-1">
            <span>初筛结论</span>
            <Select
              value={decision}
              onValueChange={(v) => setDecision(v as Decision)}
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
            <span>理由{decision === "paused" ? "（必填）" : ""}</span>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="为什么做出这个判断"
            />
          </label>

          <label className="block text-sm space-y-1">
            <span>
              证据
              {decision === "priority_contact"
                ? "（必填，链接+你的观察）"
                : "（可选）"}
            </span>
            <Textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="例：某条视频链接 + 该视频展示了什么场景"
            />
          </label>

          <label className="block text-sm space-y-1">
            <span>
              待确认问题{decision === "needs_info" ? "（必填）" : "（可选）"}
            </span>
            <Textarea
              value={openQuestions}
              onChange={(e) => setOpenQuestions(e.target.value)}
              placeholder="例：受众地区是否以美国为主？"
            />
          </label>

          {decision !== "unassessed" && decision !== "paused" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm space-y-1">
                <span>下一步动作</span>
                <Select
                  value={taskType}
                  onValueChange={(v) => setTaskType(v as TaskType)}
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
                  value={taskDue}
                  onChange={(e) => setTaskDue(e.target.value)}
                />
              </label>
            </div>
          )}

          <Button onClick={save} disabled={saving || decision === "unassessed"}>
            {saving ? "保存中…" : "保存初筛结论"}
          </Button>
        </section>

        {/* 联系区（M1 只读时间线；记录按钮在 M3） */}
        <section className="space-y-2">
          <h3 className="font-semibold">联系记录</h3>
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
    </div>
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
