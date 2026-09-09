import { useCallback, useEffect, useMemo, useState } from "react";
import { useNotify } from "ra-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CandidateDetailSidebar } from "./CandidateDetailSidebar";
import {
  DECISION_LABELS,
  TASK_TYPE_LABELS,
  dataStatus,
  displayName,
  fetchCandidates,
  fetchWorkspaces,
  getMode,
  isReviewStale,
  lastSentAt,
  openTask,
  setMode,
  updateTaskBackground,
  type Candidate,
  type Decision,
  type Mode,
  type Workspace,
} from "./workbenchApi";

export const CandidateWorkbench = () => {
  const notify = useNotify();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [mode, setModeState] = useState<Mode>(getMode());
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<"all" | Decision>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
  }, [workspace?.id]);

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
        <Button variant="outline" title="CSV 导入将在 M2 提供" disabled>
          导入候选（M2）
        </Button>
      </div>

      {settingsOpen && workspace && (
        <TaskBackgroundPanel
          workspace={workspace}
          onSaved={(ws) => {
            setWorkspaces((ws0) => ws0.map((w) => (w.id === ws.id ? ws : w)));
            setSettingsOpen(false);
            reload();
          }}
          onCancel={() => setSettingsOpen(false)}
        />
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
            variant={mode === "real" ? "default" : "outline"}
            size="sm"
            onClick={() => switchMode("real")}
          >
            真实空间
          </Button>
          <Button
            variant={mode === "demo" ? "default" : "outline"}
            size="sm"
            onClick={() => switchMode("demo")}
          >
            体验示例
          </Button>
        </div>
      </div>

      {/* 候选列表 */}
      {loading ? (
        <p className="text-muted-foreground">加载中…</p>
      ) : filtered.length === 0 ? (
        <div className="border rounded-lg p-8 text-center space-y-3">
          <p className="text-muted-foreground">
            {mode === "real"
              ? "真实空间暂无候选。可以通过 CSV 导入真实候选，或切到示例空间体验完整流程。"
              : "演示空间为空。点击「重置示例数据」可重新加载 10 位合成候选。"}
          </p>
          {mode === "real" && (
            <Button variant="outline" onClick={() => switchMode("demo")}>
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
              onOpen={() => setSelectedId(c.id)}
              active={selectedId === c.id}
            />
          ))}
        </div>
      )}

      {/* 详情侧栏 */}
      {selected && workspace && (
        <CandidateDetailSidebar
          candidate={selected}
          workspace={workspace}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
};

function CandidateRow({
  candidate: c,
  workspace,
  onOpen,
  active,
}: {
  candidate: Candidate;
  workspace: Workspace;
  onOpen: () => void;
  active: boolean;
}) {
  const task = openTask(c);
  const lastSent = lastSentAt(c);
  const stale = isReviewStale(c, workspace);

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
              ? `下一步：${TASK_TYPE_LABELS[task.type as TaskType] ?? task.type} · ${task.due_date.slice(0, 10)}`
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
    <div className="border rounded-lg p-4 mb-4 space-y-3">
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
