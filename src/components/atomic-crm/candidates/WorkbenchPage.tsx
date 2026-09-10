import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNotify } from "ra-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  CandidateDetailSidebar,
  type SidebarHandle,
} from "./CandidateDetailSidebar";
import { ExportDialog, ImportDialog } from "./ImportExportDialogs";
import {
  DECISION_LABELS,
  TASK_TYPE_LABELS,
  buildTodoItems,
  contactReminders,
  dataStatus,
  dateInTz,
  displayName,
  fetchCandidates,
  fetchWorkspaces,
  getMode,
  isReviewStale,
  lastSentAt,
  latestAssessment,
  openTask,
  remindersEnabled,
  setMode,
  setRemindersEnabled,
  updateTaskBackground,
  type Candidate,
  type Decision,
  type Mode,
  type TaskType,
  type TodoGroup,
  type Workspace,
} from "./workbenchApi";

type View = "all" | "todo";

const TODO_GROUP_META: Record<TodoGroup, { title: string; hint: string }> = {
  overdue: { title: "逾期", hint: "日期早于今天" },
  today: { title: "今天", hint: "今天未完成不算逾期" },
  later: { title: "之后", hint: "" },
};

export const CandidateWorkbench = () => {
  const notify = useNotify();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [mode, setModeState] = useState<Mode>(getMode());
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<"all" | Decision>("all");
  const [view, setView] = useState<View>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [remindersOn, setRemindersOn] = useState(remindersEnabled());
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const sidebarRef = useRef<SidebarHandle | null>(null);

  const workspace = useMemo(
    () => workspaces.find((w) => w.mode === mode) ?? null,
    [workspaces, mode],
  );

  const reload = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      setCandidates(await fetchCandidates(workspace.id));
    } catch (e: any) {
      notify(e.message ?? "加载失败", { type: "error" });
    } finally {
      setLoading(false);
    }
  }, [workspace, notify]);

  useEffect(() => {
    fetchWorkspaces()
      .then(setWorkspaces)
      .catch((e) => notify(e.message ?? "空间加载失败", { type: "error" }));
  }, [notify]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** 未保存切换守卫（A19）：侧栏有改动时先弹「保存/放弃/继续编辑」 */
  const guarded = (action: () => void) => {
    if (sidebarRef.current?.isDirty()) {
      setPendingAction(() => action);
    } else {
      action();
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setModeState(m);
    setSelectedId(null);
  };

  const filtered = candidates.filter((c) => {
    const q = search.trim().toLowerCase();
    const matchQ =
      !q ||
      displayName(c).toLowerCase().includes(q) ||
      (c.channel_id ?? "").toLowerCase().includes(q);
    const matchD =
      decisionFilter === "all" || c.screening_decision === decisionFilter;
    return matchQ && matchD;
  });

  const selected = candidates.find((c) => c.id === selectedId) ?? null;

  const runPending = async (saveFirst: boolean) => {
    if (saveFirst) {
      try {
        await sidebarRef.current?.saveDraftNow();
      } catch {
        return; // 保存失败：留在当前编辑，不切换
      }
    }
    const action = pendingAction;
    setPendingAction(null);
    action?.();
  };

  return (
    <div className="p-2">
      {/* 顶部：任务背景 + 模式 + 动作 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="text-xl font-bold">达人初筛工作台</h1>
        <Badge variant={mode === "demo" ? "destructive" : "secondary"}>
          {mode === "demo" ? "演示数据" : "真实数据"}
        </Badge>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => setSettingsOpen((v) => !v)}>
          任务背景设置
        </Button>
        <Button
          variant="outline"
          onClick={() => setImportOpen(true)}
          title="粘贴频道 ID/handle/链接或上传 CSV，本地预检后导入"
        >
          导入候选
        </Button>
        <Button
          variant="outline"
          onClick={() => setExportOpen(true)}
          title="导出可行动名单或当前筛选结果"
        >
          导出
        </Button>
      </div>

      {settingsOpen && workspace && (
        <div className="space-y-3 mb-4">
          <TaskBackgroundPanel
            workspace={workspace}
            onSaved={(ws) => {
              setWorkspaces((ws0) => ws0.map((w) => (w.id === ws.id ? ws : w)));
              setSettingsOpen(false);
              reload();
            }}
            onCancel={() => setSettingsOpen(false)}
          />
          <div className="border rounded-lg p-4 flex items-center gap-2">
            <Checkbox
              id="reminders-toggle"
              checked={remindersOn}
              onCheckedChange={(v) => {
                const on = v === true;
                setRemindersEnabled(on);
                setRemindersOn(on);
              }}
            />
            <Label htmlFor="reminders-toggle" className="text-sm font-normal">
              联系提醒（累计发信 5 次或距最近发信不足 168
              小时时提示；关闭仅影响展示，不改变历史事实）
            </Label>
          </div>
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Input
          placeholder="搜索频道名 / 频道 ID"
          className="w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={decisionFilter}
          onValueChange={(v) => setDecisionFilter(v as any)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部结论</SelectItem>
            <SelectItem value="unassessed">未评估</SelectItem>
            <SelectItem value="priority_contact">优先联系</SelectItem>
            <SelectItem value="needs_info">待补资料</SelectItem>
            <SelectItem value="paused">暂缓</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <div className="flex gap-1">
          <Button
            variant={view === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("all")}
          >
            全部候选
          </Button>
          <Button
            variant={view === "todo" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("todo")}
          >
            待办
          </Button>
        </div>
        <div className="flex gap-1">
          <Button
            variant={mode === "real" ? "default" : "outline"}
            size="sm"
            onClick={() => guarded(() => switchMode("real"))}
          >
            真实空间
          </Button>
          <Button
            variant={mode === "demo" ? "default" : "outline"}
            size="sm"
            onClick={() => guarded(() => switchMode("demo"))}
          >
            体验示例
          </Button>
        </div>
      </div>

      {/* 候选列表 / 待办视图 */}
      {loading ? (
        <p className="text-muted-foreground">加载中…</p>
      ) : view === "todo" ? (
        <TodoView
          candidates={filtered}
          onOpen={(id) => guarded(() => setSelectedId(id))}
          activeId={selectedId}
        />
      ) : filtered.length === 0 ? (
        <div className="border rounded-lg p-8 text-center space-y-3">
          <p className="text-muted-foreground">
            {mode === "real"
              ? "真实空间暂无候选。可以通过「导入候选」粘贴频道入口，或切到示例空间体验完整流程。"
              : "演示空间为空。可重跑 demo-data/synthetic-candidates.sql 恢复 10 位合成候选（一键重置入口在 M3 提供）。"}
          </p>
          {mode === "real" && (
            <Button
              variant="outline"
              onClick={() => guarded(() => switchMode("demo"))}
            >
              体验示例
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {filtered.map((c) => (
            <CandidateRow
              key={c.id}
              candidate={c}
              workspace={workspace}
              remindersOn={remindersOn}
              onOpen={() => guarded(() => setSelectedId(c.id))}
              active={selectedId === c.id}
            />
          ))}
        </div>
      )}

      {/* 详情侧栏：key 保证切换候选时重建表单状态（防串数据） */}
      {selected && workspace && (
        <CandidateDetailSidebar
          key={selected.id}
          ref={sidebarRef}
          candidate={selected}
          workspace={workspace}
          onClose={() => guarded(() => setSelectedId(null))}
          onChanged={reload}
        />
      )}

      {/* 导入 / 导出 */}
      {workspace && (
        <>
          <ImportDialog
            workspace={workspace}
            candidates={candidates}
            open={importOpen}
            onOpenChange={setImportOpen}
            onImported={reload}
          />
          <ExportDialog
            workspace={workspace}
            candidates={candidates}
            filtered={filtered}
            open={exportOpen}
            onOpenChange={setExportOpen}
          />
        </>
      )}

      {/* 未保存更改对话框（A19：提示保存/放弃，不静默丢弃） */}
      <Dialog
        open={pendingAction !== null}
        onOpenChange={(v) => !v && setPendingAction(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>有未保存的修改</DialogTitle>
            <DialogDescription>
              详情侧栏中的编辑内容尚未保存。可先保存为草稿再继续，或放弃这些更改。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingAction(null)}>
              继续编辑
            </Button>
            <Button variant="outline" onClick={() => runPending(false)}>
              放弃更改
            </Button>
            <Button onClick={() => runPending(true)}>保存草稿并继续</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

function TodoView({
  candidates,
  onOpen,
  activeId,
}: {
  candidates: Candidate[];
  onOpen: (id: number) => void;
  activeId: number | null;
}) {
  const { items, counts } = useMemo(
    () => buildTodoItems(candidates),
    [candidates],
  );

  if (items.length === 0) {
    return (
      <div className="border rounded-lg p-8 text-center text-muted-foreground">
        待办为空：没有未完成的下一步任务。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(["overdue", "today", "later"] as TodoGroup[]).map((g) => {
        const groupItems = items.filter((i) => i.group === g);
        if (groupItems.length === 0) return null;
        return (
          <div key={g}>
            <div className="flex items-baseline gap-2 mb-2">
              <h2
                className={`font-semibold ${g === "overdue" ? "text-destructive" : ""}`}
              >
                {TODO_GROUP_META[g].title}
              </h2>
              <span className="text-sm text-muted-foreground">
                {counts[g]} 项
                {TODO_GROUP_META[g].hint && ` · ${TODO_GROUP_META[g].hint}`}
              </span>
            </div>
            <div className="border rounded-lg divide-y">
              {groupItems.map(({ candidate: c, task }) => {
                const latest = latestAssessment(c);
                return (
                  <button
                    key={c.id}
                    className={`w-full text-left px-4 py-3 hover:bg-muted/60 transition ${activeId === c.id ? "bg-muted/40" : ""}`}
                    onClick={() => onOpen(c.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">
                          {displayName(c)}
                          {c.do_not_contact && (
                            <Badge variant="destructive" className="ml-2">
                              停止联系
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">
                          {TASK_TYPE_LABELS[task.type as TaskType] ?? task.type}
                          {task.text ? ` · ${task.text}` : ""}
                        </div>
                        {latest?.open_questions && (
                          <div className="text-sm text-muted-foreground truncate">
                            待确认：{latest.open_questions}
                          </div>
                        )}
                      </div>
                      <div className="text-sm text-right shrink-0">
                        <Badge
                          variant={
                            c.screening_decision === "priority_contact"
                              ? "default"
                              : c.screening_decision === "paused"
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {DECISION_LABELS[c.screening_decision]}
                        </Badge>
                        <div
                          className={
                            g === "overdue"
                              ? "text-destructive mt-1 font-medium"
                              : "text-muted-foreground mt-1"
                          }
                        >
                          {dateInTz(task.due_date)}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CandidateRow({
  candidate: c,
  workspace,
  remindersOn,
  onOpen,
  active,
}: {
  candidate: Candidate;
  workspace: Workspace | null;
  remindersOn: boolean;
  onOpen: () => void;
  active: boolean;
}) {
  const task = openTask(c);
  const lastSent = lastSentAt(c);
  const stale = workspace ? isReviewStale(c, workspace) : false;
  const reminder = remindersOn && contactReminders(c).length > 0;

  return (
    <button
      className={`w-full text-left px-4 py-3 hover:bg-muted/60 transition ${active ? "bg-muted/40" : ""}`}
      onClick={onOpen}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium flex items-center gap-2">
            {displayName(c)}
            {c.do_not_contact && <Badge variant="destructive">停止联系</Badge>}
            {reminder && (
              <Badge
                variant="outline"
                className="border-amber-500 text-amber-600"
              >
                ⏰ 提醒
              </Badge>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            {c.channel_id ?? "频道未知"}
            {" · "}
            {dataStatus(c)}
          </div>
        </div>
        <div className="text-sm text-right">
          <Badge
            variant={
              c.screening_decision === "priority_contact"
                ? "default"
                : c.screening_decision === "paused"
                  ? "outline"
                  : "secondary"
            }
          >
            {DECISION_LABELS[c.screening_decision]}
          </Badge>
          {stale && <Badge className="ml-1">待复核</Badge>}
          <div className="text-muted-foreground mt-1">
            {task
              ? `下一步：${TASK_TYPE_LABELS[task.type as TaskType] ?? task.type} · ${dateInTz(task.due_date)}`
              : "未设置下一步"}
            {lastSent && ` · 最近发信 ${lastSent.slice(0, 10)}`}
          </div>
        </div>
      </div>
    </button>
  );
}

function TaskBackgroundPanel({
  workspace,
  onSaved,
  onCancel,
}: {
  workspace: Workspace;
  onSaved: (ws: Workspace) => void;
  onCancel: () => void;
}) {
  const notify = useNotify();
  const [product, setProduct] = useState(
    workspace.product ?? "激光水平仪/测距仪",
  );
  const [scene, setScene] = useState(workspace.scene ?? "DIY、装修、测量");
  const [market, setMarket] = useState(workspace.market ?? "美国/加拿大");

  const save = async () => {
    try {
      const ws = await updateTaskBackground(workspace.id, {
        product,
        scene,
        market,
      });
      notify("任务背景已更新（旧判断将提示复核）", { type: "success" });
      onSaved(ws);
    } catch (e: any) {
      notify(e.message ?? "保存失败", { type: "error" });
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <p className="font-semibold">
        任务背景（修改会递增版本，旧判断进入待复核）
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="text-sm space-y-1">
          <span>产品</span>
          <Input value={product} onChange={(e) => setProduct(e.target.value)} />
        </label>
        <label className="text-sm space-y-1">
          <span>使用场景</span>
          <Input value={scene} onChange={(e) => setScene(e.target.value)} />
        </label>
        <label className="text-sm space-y-1">
          <span>目标市场</span>
          <Input value={market} onChange={(e) => setMarket(e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <Button onClick={save}>保存任务背景</Button>
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}
