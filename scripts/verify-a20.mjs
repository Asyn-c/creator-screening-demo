/* eslint-disable no-console */
/**
 * A20 端到端验证：工作台单条删除候选（确认清单 + 勾选确认 + 级联清理 + 隔离不受影响）
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);

try {
  // ---------- S1 打开 demo:08（有 6 条联系事件），弹出删除对话框 ----------
  await page.goto(BASE);
  await page.fill('input[type="email"]', "m0test@example.com");
  await page.fill('input[type="password"]', "test123456");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/");
  await page.goto(`${BASE}/#/candidates`);
  await page.getByRole("button", { name: "体验示例", exact: true }).click();
  await page.waitForTimeout(1000);
  const before = await page.getByText("【演示】").count();
  await page.getByText("【演示】创客工坊 Max").click();
  await page.waitForTimeout(500);
  const sidebar = page.locator("div.fixed.inset-y-0.right-0");
  await sidebar.getByRole("button", { name: "删除候选" }).click();
  await page.getByText("删除候选").first().waitFor();
  const listText = await page
    .locator("dialog, [role='dialog']")
    .first()
    .textContent();
  check(
    "S1 对话框明确列出删除范围",
    listText.includes("联系事件 6 条") && listText.includes("不可恢复"),
    listText?.slice(0, 80),
  );
  // 未勾选确认前按钮禁用
  const disabled = await page
    .getByRole("button", { name: "确认删除" })
    .isDisabled();
  check("S1b 未勾选确认前删除按钮禁用", disabled);
  await page.screenshot({ path: `${OUT}/a20-01-confirm-dialog.png` });

  // ---------- S2 勾选确认 → 执行删除 ----------
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await page
    .getByText(/已删除候选及关联记录/)
    .first()
    .waitFor();
  await page.waitForTimeout(900);
  const after = await page.getByText("【演示】").count();
  const gone = (await page.getByText("【演示】创客工坊 Max").count()) === 0;
  const othersKept =
    (await page.getByText("【演示】周末修理工").count()) === 1 &&
    (await page.getByText("【演示】海外工具哥").count()) === 1;
  check(
    "S2 删除执行：候选消失、其他候选不受影响",
    gone && othersKept,
    `行数 ${before}→${after}`,
  );
  await page.screenshot({ path: `${OUT}/a20-02-deleted.png` });

  // ---------- S3 DB 级联验证 ----------
  const evts = psql(
    "select count(*) from contact_events ce join contacts c on c.id=ce.candidate_id where c.channel_id='demo:08'",
  );
  check("S3 关联联系事件级联清除", evts === "0", `残留=${evts}`);
  // 空间隔离：真实空间 M0 记录完好
  const m0 = psql("select count(*) from contacts where first_name like 'M0%'");
  check("S3b 真实空间不受影响", m0 === "3", `M0=${m0}`);
} catch (e) {
  check("脚本执行异常", false, String(e));
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
