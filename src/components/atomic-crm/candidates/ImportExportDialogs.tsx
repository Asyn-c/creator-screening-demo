import { useMemo, useRef, useState } from "react";
import { useNotify } from "ra-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  buildCandidatesCsv,
  downloadCsv,
  exportScopeCandidates,
  importCandidates,
  parseImportText,
  type Candidate,
  type ExportScope,
  type ImportCounts,
  type Workspace,
} from "./workbenchApi";

const IMPORT_TEMPLATE = `channel_input,source_note,note
UCXuqSBlHAE6Xw-yeJA0Tunw,搜索找到,优先核实
@somehandle,朋友推荐,`;

// ============ 导入对话框 ============

export function ImportDialog({
  workspace,
  candidates,
  open,
  onOpenChange,
  onImported,
}: {
  workspace: Workspace;
  candidates: Candidate[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImported: () => void;
}) {
  const notify = useNotify();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportCounts | null>(null);

  const existing = useMemo(
    () =>
      candidates.map((c) => c.channel_id).filter((v): v is string => v != null),
    [candidates],
  );
  const rows = useMemo(
    () => (text.trim() ? parseImportText(text, existing) : []),
    [text, existing],
  );
  const bytes = new Blob([text]).size;
  const overRows = rows.length > IMPORT_MAX_ROWS;
  const overBytes = bytes > IMPORT_MAX_BYTES;
  const canImport =
    rows.length > 0 && !overRows && !overBytes && importing === false;

  const counts = {
    total: rows.length,
    created: rows.filter((r) => r.status === "new").length,
    existed: rows.filter((r) => r.status === "exists").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
    duplicate: rows.filter((r) => r.status === "duplicate").length,
  };

  const doImport = async () => {
    setImporting(true);
    try {
      const c = await importCandidates(workspace.id, rows);
      setResult(c);
      notify(
        `导入完成：新增 ${c.created}，已存在 ${c.existed}，无效 ${c.invalid}，重复 ${c.duplicate}`,
        { type: "success" },
      );
      onImported();
      setText("");
    } catch (e: any) {
      notify(e.message ?? "导入失败", { type: "error" });
    } finally {
      setImporting(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > IMPORT_MAX_BYTES) {
      notify("文件超过 1MB 上限", { type: "warning" });
      return;
    }
    setText(await f.text());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>导入候选</DialogTitle>
          <DialogDescription>
            每行一个频道 ID（UC…）、@handle 或频道链接；最多 {IMPORT_MAX_ROWS}{" "}
            行、1MB。支持 CSV 的 channel_input 列。无效行不影响其他行。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 text-sm">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const blob = new Blob([IMPORT_TEMPLATE], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "import-template.csv";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            下载模板
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
          >
            上传 CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          {overRows && (
            <Badge variant="destructive">
              超过 {IMPORT_MAX_ROWS} 行，请分批
            </Badge>
          )}
          {overBytes && <Badge variant="destructive">超过 1MB</Badge>}
        </div>

        <Textarea
          rows={7}
          placeholder={
            "UCXuqSBlHAE6Xw-yeJA0Tunw\n@somehandle\nhttps://www.youtube.com/@somehandle"
          }
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
        />

        {rows.length > 0 && (
          <div className="text-sm space-y-2">
            <div className="flex flex-wrap gap-2">
              <Badge>共 {counts.total} 行</Badge>
              <Badge className="bg-green-600">新增 {counts.created}</Badge>
              <Badge variant="secondary">已存在 {counts.existed}</Badge>
              <Badge variant="outline">重复 {counts.duplicate}</Badge>
              {counts.invalid > 0 && (
                <Badge variant="destructive">无效 {counts.invalid}</Badge>
              )}
            </div>
            <div className="border rounded max-h-40 overflow-y-auto divide-y text-xs">
              {rows.map((r) => (
                <div
                  key={r.line}
                  className="px-2 py-1 flex justify-between gap-2"
                >
                  <span className="truncate">
                    {r.line}. {r.input}
                  </span>
                  <span
                    className={
                      r.status === "invalid"
                        ? "text-destructive shrink-0"
                        : "text-muted-foreground shrink-0"
                    }
                  >
                    {r.status === "new" && `新增 → ${r.channel_id}`}
                    {r.status === "exists" && "已存在，不覆盖"}
                    {r.status === "duplicate" && "本批重复"}
                    {r.status === "invalid" && r.error}
                  </span>
                </div>
              ))}
            </div>
            {workspace.mode === "real" && (
              <p className="text-muted-foreground text-xs">
                未配置 API Key
                时身份未经官方接口核实（列表显示「未核实」），配置后可用「更新资料」完成核实与资料整理。
              </p>
            )}
          </div>
        )}

        {result && (
          <p className="text-sm text-green-700">
            已导入：新增 {result.created}、已存在 {result.existed}、无效{" "}
            {result.invalid}、重复 {result.duplicate}（计数互斥，总和{" "}
            {result.total}）。
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button onClick={doImport} disabled={!canImport}>
            {importing ? "导入中…" : "确认导入"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ 导出面板 ============

export function ExportDialog({
  workspace,
  candidates,
  filtered,
  open,
  onOpenChange,
}: {
  workspace: Workspace;
  /** 全量（当前空间）候选，用于可行动名单计算 */
  candidates: Candidate[];
  /** 当前筛选结果 */
  filtered: Candidate[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [scope, setScope] = useState<ExportScope>("actionable");
  const actionable = useMemo(
    () => exportScopeCandidates(candidates, workspace, "actionable"),
    [candidates, workspace],
  );
  const rows = scope === "actionable" ? actionable : filtered;

  const doExport = () => {
    const csv = buildCandidatesCsv(candidates, workspace, scope);
    const date = new Date().toISOString().slice(0, 10);
    const demoMark = workspace.mode === "demo" ? "DEMO-" : "";
    downloadCsv(`candidates-${demoMark}${date}.csv`, csv);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导出工作名单</DialogTitle>
          <DialogDescription>
            导出不改变任务或联系状态；中文、逗号、引号、换行已转义，以
            =、+、-、@ 开头的文本按表格安全文本处理（防公式执行）。
            {workspace.mode === "demo" &&
              " 示例空间导出文件名含 DEMO 标记，每行 data_mode=synthetic。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2 border rounded p-3 cursor-pointer">
            <input
              type="radio"
              name="export-scope"
              className="mt-0.5"
              checked={scope === "actionable"}
              onChange={() => setScope("actionable")}
            />
            <span>
              <span className="font-medium">可行动名单（默认）</span>
              <span className="text-muted-foreground">
                － 结论为优先联系/待补资料、有未完成任务、未停止联系、非待复核
              </span>
              <div className="mt-1">
                <Badge>{actionable.length} 位候选</Badge>
              </div>
            </span>
          </label>
          <label className="flex items-start gap-2 border rounded p-3 cursor-pointer">
            <input
              type="radio"
              name="export-scope"
              className="mt-0.5"
              checked={scope === "filtered"}
              onChange={() => setScope("filtered")}
            />
            <span>
              <span className="font-medium">当前筛选结果</span>
              <span className="text-muted-foreground">
                － 用于完整核对，包括暂缓和未评估项
              </span>
              <div className="mt-1">
                <Badge variant="secondary">{filtered.length} 位候选</Badge>
              </div>
            </span>
          </label>
          {rows.length === 0 && (
            <p className="text-destructive text-xs">
              没有符合条件的候选，请调整筛选或选择另一范围。
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={doExport} disabled={rows.length === 0}>
            下载 CSV（{rows.length} 行）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
