/* eslint-disable no-console */
/**
 * 方案A（Nox CSV 桥）+ A05（来源追加需确认）端到端验证
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

const BASE = "http://localhost:5173";
const OUT = "evidence/acceptance";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`,
  );
};
const psql = (sql) =>
  execSync(
    `docker exec supabase_db_atomic-crm-demo psql -U postgres -d postgres -tAc "${sql}"`,
  )
    .toString()
    .trim();

// 合法 24 位 UC ID（测试后清理）
const UC_T = "UCXuqSBlHAE6Xw-yeJA0Tunw";
const UC_N = "UCbmnox000000000000000aa";
// Nox 风格导出：中英混合列名 + 未识别列
const makeNoxCsv = () =>
  [
    "频道链接,频道名称,Subscribers,Audience Countries,Engagement Rate,Extra Metric",
    `https://www.youtube.com/channel/${UC_T},桥接已存在频道,90000,CA,2.1%,456`,
    `${UC_N},桥接测试频道,85000,US,3.8%,123`,
  ].join("\n");
const NOX_CSV = makeNoxCsv();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
page.on("response", async (res) => {
  if (
    res.url().includes("/rest/v1/contacts") &&
    res.request().method() === "POST"
  ) {
    console.log("[NET] contacts POST →", res.status());
    if (res.status() >= 400)
      console.log("[NET] body:", await res.text().catch(() => "?"));
  }
  if (res.url().includes("/rest/v1/workspace") && res.status() >= 400) {
    console.log(
      "[NET] workspace GET →",
      res.status(),
      await res.text().catch(() => "?"),
    );
  }
});
page.on("pageerror", (err) =>
  console.log("[PAGEERROR]", String(err).slice(0, 200)),
);
page.on("console", (msg) => {
  if (msg.type() === "error")
    console.log("[CONSOLE]", msg.text().slice(0, 200));
});

try {
  // 清理历史运行残留
  execSync(
    `docker exec supabase_db_atomic-crm-demo psql -U postgres -d postgres -c "delete from contacts where channel_id in ('${UC_T}','${UC_N}')"`,
  );
  await page.goto(BASE);
  await page.fill('input[type="email"]', "m0test@example.com");
  await page.fill('input[type="password"]', "test123456");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/");
  await page.goto(`${BASE}/#/candidates`);
  await page.getByRole("button", { name: "真实空间", exact: true }).click();
  await page.waitForTimeout(1000);

  // ---------- S0 纯行导入先建一个候选（后续作为「已存在」） ----------
  await page.getByRole("button", { name: "导入候选" }).click();
  await page.locator("textarea").fill(UC_T);
  await page.getByRole("button", { name: "确认导入" }).click();
  await page
    .getByText(/已导入：新增 1/)
    .first()
    .waitFor();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // ---------- S1 上传 Nox CSV → 工具导出模式预检 ----------
  await page.getByRole("button", { name: "导入候选" }).click();
  await page.setInputFiles('input[type="file"]', {
    name: "nox-export.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(NOX_CSV, "utf8"),
  });
  await page.getByText("工具导出模式").waitFor();
  const previewText = await page.getByText(/共 \d+ 行/).textContent();
  check(
    "S1 识别为工具导出模式（共 2 行）",
    previewText?.includes("共 2 行"),
    previewText?.trim(),
  );
  const unknownHint = await page
    .getByText(/未识别列（本版不导入）/)
    .textContent();
  check(
    "S1b 未识别列提示（本版不导入）",
    unknownHint?.includes("Extra Metric"),
    unknownHint?.trim(),
  );
  const appendVisible = await page
    .getByText(/为已存在候选追加来源备注/)
    .isVisible();
  check("S1c 已存在行出现追加确认勾选（A05）", appendVisible);
  await page.screenshot({ path: `${OUT}/a05-01-nox-preview.png` });

  // ---------- S2 不勾选追加 → 已存在行只新增/存在计数，M0-Alpha 备注不变 ----------
  await page.getByRole("button", { name: "确认导入" }).click();
  await page
    .getByText(/已导入：新增 1/)
    .first()
    .waitFor();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  const noteUC_T = psql(
    `select coalesce(source_note,'null') from contacts where channel_id='${UC_T}'`,
  );
  check(
    "S2 未勾选时已存在候选备注不被触碰",
    noteUC_T === "null",
    `source_note=${noteUC_T}`,
  );
  const decisionUC_T = psql(
    `select screening_decision from contacts where channel_id='${UC_T}'`,
  );
  check(
    "S2b 已存在候选判断未被覆盖",
    decisionUC_T === "unassessed",
    decisionUC_T,
  );

  // ---------- S3 新候选带来源备注，侧栏展示 ----------
  await page.getByText(UC_N).first().click();
  await page.waitForTimeout(600);
  const noteShown = await page
    .getByText(/来源备注：/)
    .first()
    .isVisible();
  const audienceShown = await page
    .getByText(/受众国家:US/)
    .first()
    .isVisible();
  check(
    "S3 新候选侧栏显示来源备注（含受众国家:US）",
    noteShown && audienceShown,
  );
  await page.screenshot({ path: `${OUT}/a05-02-source-note-sidebar.png` });
  const sidebar = page.locator("div.fixed.inset-y-0.right-0");
  await sidebar.getByRole("button", { name: "关闭" }).click();

  // ---------- S4 再次导入同一 CSV + 勾选追加 → M0-Alpha 备注追加 ----------
  await page.getByRole("button", { name: "导入候选" }).click();
  await page.setInputFiles('input[type="file"]', {
    name: "nox-export2.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(NOX_CSV, "utf8"),
  });
  await page.getByText("工具导出模式").waitFor();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认导入" }).click();
  await page
    .getByText(/已导入：新增 0/)
    .first()
    .waitFor();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const appended = psql(
    `select source_note from contacts where channel_id='${UC_T}'`,
  );
  check(
    "S4 确认后来源备注追加成功",
    appended.includes("受众国家:CA"),
    appended.slice(0, 70),
  );
  await page.screenshot({ path: `${OUT}/a05-03-appended.png` });

  // ---------- S5 导出包含 source_note ----------
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByText("导出工作名单").waitFor();
  await page.getByText("当前筛选结果").click();
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /下载 CSV/ }).click(),
  ]);
  const p = `${OUT}/a05-export-with-source-note.csv`;
  await dl.saveAs(p);
  const content = (await import("node:fs")).readFileSync(p, "utf8");
  check(
    "S5 导出 CSV 的 source_note 列已填充",
    content.includes("受众国家:US") && content.includes("受众国家:CA"),
    "",
  );
  await page.keyboard.press("Escape");
  // ---------- 清理测试候选 ----------
  execSync(
    `docker exec supabase_db_atomic-crm-demo psql -U postgres -d postgres -c "delete from contacts where channel_id in ('${UC_T}','${UC_N}')"`,
  );
  console.log("测试候选已清理");
} catch (e) {
  check("脚本执行异常", false, String(e));
  await page.screenshot({ path: `${OUT}/a05-error.png` }).catch(() => {});
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n===== ${results.length - failed.length}/${results.length} 通过 =====`,
  );
  if (failed.length) {
    failed.forEach((f) => console.log(`  - ${f.name} ${f.detail}`));
    process.exit(1);
  }
}
