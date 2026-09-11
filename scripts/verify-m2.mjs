/* eslint-disable no-console */
/**
 * M2 最小接入端到端验证：导入（解析/排重/预检）→ 资料获取（TESTKEY 受控模式）→ CSV 导出
 * 前置：supabase start + npm run dev + `supabase functions serve --env-file supabase/functions/.env`
 * 产出：evidence/M2/*.png + evidence/M2/export-sample.csv
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = "http://localhost:5173";
const OUT = "evidence/M2";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`,
  );
};

// 生成不重复的合法 UC ID（UC + 22 位 [\w-]）
const ts = Date.now().toString();
const UC1 = "UC" + (ts + "a").padEnd(22, "7").slice(0, 22);
const UC2 = "UC" + (ts + "b").padEnd(22, "7").slice(0, 22);
const HD1 = `@p${ts}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);

try {
  // ---------- 登录 + 真实空间 ----------
  await page.goto(BASE);
  await page.fill('input[type="email"]', "m0test@example.com");
  await page.fill('input[type="password"]', "test123456");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/");
  await page.goto(`${BASE}/#/candidates`);
  await page.getByRole("button", { name: "真实空间", exact: true }).click();
  await page.waitForTimeout(800);

  // ---------- S12 导入：预检计数 + 确认 ----------
  await page.getByRole("button", { name: "导入候选" }).click();
  await page.locator("textarea").fill(
    [
      UC1,
      HD1,
      UC1, // 本批重复
      HD1, // 与已存在重复（第二次运行时）——首次运行为新增
      "https://youtu.be/badxyz", // 无效
      "https://www.youtube.com/watch?v=abc", // 无效（视频链）
    ].join("\n"),
  );
  await page.getByText(/共 6 行/).waitFor();
  await page.screenshot({ path: `${OUT}/m2-01-import-preview.png` });
  await page.getByRole("button", { name: "确认导入" }).click();
  await page.getByText(/已导入：新增/).waitFor();
  const resultText = await page.getByText(/已导入：新增/).textContent();
  check(
    "S12 导入计数互斥（新增2/无效2/本批重复2）",
    resultText.includes("新增 2") &&
      resultText.includes("无效 2") &&
      resultText.includes("重复 2"),
    resultText,
  );
  await page.screenshot({ path: `${OUT}/m2-02-imported.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // ---------- S12b 再次导入同一批：全部已存在/重复，不重复建档 ----------
  await page.getByRole("button", { name: "导入候选" }).click();
  await page.locator("textarea").fill(`${UC1}\n${UC2}\n${UC1}`);
  await page.getByRole("button", { name: "确认导入" }).click();
  await page.getByText(/已导入：新增/).waitFor();
  const reText = await page.getByText(/已导入：新增/).textContent();
  check(
    "S12b 重复导入不覆盖不重复建档",
    reText.includes("新增 1") && reText.includes("已存在 1"),
    reText,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // ---------- S13 TESTKEY 受控获取 ----------
  await page.getByText(UC1).first().click();
  await page.waitForTimeout(600);
  const sidebar = page.locator("div.fixed.inset-y-0.right-0");
  await sidebar.getByRole("button", { name: "更新资料" }).click();
  await page.getByText(/资料已更新：3 条近期视频/).waitFor();
  check("S13 TESTKEY 获取成功（频道+3 视频）", true);
  await page.waitForTimeout(800);
  const testTitle = await page
    .getByText(/【测试】频道/)
    .first()
    .isVisible();
  const zeroShown = await page
    .getByText(/观看 0/)
    .first()
    .isVisible();
  const unknownShown = await page
    .getByText(/观看 未知/)
    .first()
    .isVisible();
  check(
    "S13 缓存渲染：0 值与缺失分开显示",
    testTitle && zeroShown && unknownShown,
  );
  await page.screenshot({ path: `${OUT}/m2-03-fetch-test.png` });
  await sidebar.getByRole("button", { name: "关闭" }).click();

  // ---------- S13b demo 空间拒绝真实接口 ----------
  await page.getByRole("button", { name: "体验示例", exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByText("【演示】山林工坊 DIY").click();
  await page.waitForTimeout(500);
  await sidebar.getByRole("button", { name: "更新资料" }).click();
  await page.getByText(/演示数据不请求真实接口/).waitFor();
  check("S13b demo 空间拒绝真实请求", true);
  await page.screenshot({ path: `${OUT}/m2-04-demo-rejected.png` });
  await sidebar.getByRole("button", { name: "关闭" }).click();

  // ---------- S14 导出 CSV ----------
  await page.getByRole("button", { name: "真实空间", exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByText("导出工作名单").waitFor();
  await page.screenshot({ path: `${OUT}/m2-05-export-dialog.png` });
  // 可行动名单（默认）——当前真实空间可能 0 条，先切「当前筛选结果」保证有内容
  await page.getByText("当前筛选结果").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /下载 CSV/ }).click(),
  ]);
  const path = `${OUT}/export-sample.csv`;
  await download.saveAs(path);
  const content = readFileSync(path, "utf8");
  const header =
    "channel_input,channel_id,channel_url,channel_name,source_note,decision,reason,evidence_refs,open_questions,next_action,next_action_date,last_contact_at,contact_count,do_not_contact,reviewed_at,review_stale,data_mode";
  check(
    "S14 CSV：BOM + 17 列表头 + 无 DEMO 标记（真实空间）",
    content.charCodeAt(0) === 0xfeff &&
      content.includes(header) &&
      !download.suggestedFilename().includes("DEMO"),
  );
  check(
    "S14 CSV：含导入候选且 data_mode=real",
    content.includes(UC1) && content.includes(",real"),
  );
  console.log(`  导出文件: ${path} (${content.length} bytes)`);
  await page.keyboard.press("Escape"); // 关闭导出对话框
  await page.waitForTimeout(400);

  // ---------- S14b demo 空间导出带 DEMO 标记 + synthetic 行 ----------
  await page.getByRole("button", { name: "体验示例", exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByText("导出工作名单").waitFor();
  await page.getByText("当前筛选结果").click();
  const [dl2] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /下载 CSV/ }).click(),
  ]);
  const p2 = `${OUT}/export-demo.csv`;
  await dl2.saveAs(p2);
  const c2 = readFileSync(p2, "utf8");
  check(
    "S14b demo 导出：文件名 DEMO 标记 + data_mode=synthetic",
    dl2.suggestedFilename().includes("DEMO") && c2.includes("synthetic"),
    dl2.suggestedFilename(),
  );
  await page.keyboard.press("Escape");
} catch (e) {
  check("脚本执行异常", false, String(e));
  await page.screenshot({ path: `${OUT}/m2-error.png` }).catch(() => {});
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
