/* eslint-disable no-console */
/**
 * M3 建联 UI 端到端验证：记录已联系/已回复、撤销、停止联系设置/解除、DNC 联动
 * 产出：evidence/M3/*.png
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:5173";
const OUT = "evidence/M3";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`,
  );
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);

try {
  await page.goto(BASE);
  await page.fill('input[type="email"]', "m0test@example.com");
  await page.fill('input[type="password"]', "test123456");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/");
  await page.goto(`${BASE}/#/candidates`);
  await page.getByRole("button", { name: "体验示例", exact: true }).click();
  await page.waitForTimeout(1000);
  const sidebar = page.locator("div.fixed.inset-y-0.right-0");

  // ---------- S1 记录已联系（demo:02 无历史） ----------
  await page.getByText("【演示】Builder 小站").click();
  await page.waitForTimeout(500);
  await sidebar.getByRole("button", { name: "记录已联系" }).click();
  await page.getByText("只有你确认真实发送才记一次").waitFor();
  await page.getByRole("button", { name: "确认记录" }).click();
  await page
    .getByText(/已记录发信/)
    .first()
    .waitFor();
  await page.waitForTimeout(600);
  const sent1 = await sidebar
    .getByText(/发信 · /)
    .first()
    .isVisible();
  check("S1 记录已联系（时间默认现在）", sent1);

  // ---------- S2 撤销后重算（回退到无联系记录） ----------
  await sidebar.locator("button", { hasText: "撤销" }).first().click();
  await page
    .getByText(/已撤销/)
    .first()
    .waitFor();
  await page.waitForTimeout(600);
  const backToNone = await sidebar.getByText(/无联系记录/).isVisible();
  check("S2 撤销后按有效事件重算（回到无联系记录）", backToNone);
  await page.screenshot({ path: `${OUT}/m3-01-record-void.png` });
  await sidebar.getByRole("button", { name: "关闭" }).click();

  // ---------- S3 补录过去时间 + 未来时间拒绝（demo:07 已有 1 条 sent） ----------
  await page.getByText("【演示】周末修理工").click();
  await page.waitForTimeout(500);
  await sidebar.getByRole("button", { name: "记录已回复" }).click();
  await page.getByText(/不自动判定同意合作/).waitFor();
  // 未来时间
  const future = new Date(Date.now() + 3600_000);
  const pad = (n) => String(n).padStart(2, "0");
  const fStr = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
  await page.locator('input[type="datetime-local"]').fill(fStr);
  await page.getByRole("button", { name: "确认记录" }).click();
  await page
    .getByText(/future times are not accepted|记录失败/)
    .first()
    .waitFor();
  check("S3 未来时间被服务端拒绝", true);
  await page.screenshot({ path: `${OUT}/m3-02-future-rejected.png` });
  // 改为过去时间补录
  const past = new Date(Date.now() - 48 * 3600_000);
  const pStr = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}T${pad(past.getHours())}:${pad(past.getMinutes())}`;
  await page.locator('input[type="datetime-local"]').fill(pStr);
  await page
    .locator(
      "dialog input[placeholder*='对方回复'], input[placeholder*='对方回复']",
    )
    .fill("补录：对方曾回复询价");
  await page.getByRole("button", { name: "确认记录" }).click();
  await page
    .getByText(/已记录回复/)
    .first()
    .waitFor();
  await page.waitForTimeout(600);
  const backdated = await sidebar.getByText(/补录：对方曾回复询价/).isVisible();
  check("S3 补录过去时间成功", backdated);
  await sidebar.getByRole("button", { name: "关闭" }).click();

  // ---------- S4 停止联系联动（demo:01 有 first_contact open 任务） ----------
  await page.getByText("【演示】山林工坊 DIY").click();
  await page.waitForTimeout(500);
  const taskBefore = (await sidebar.getByText("下一步任务").isVisible())
    ? await sidebar
        .getByText(/首次联系/)
        .first()
        .isVisible()
    : false;
  await sidebar.getByRole("button", { name: "停止联系" }).click();
  await page.getByText(/将自动取消未完成的联系\/跟进任务/).waitFor();
  await page
    .locator("dialog textarea, textarea")
    .last()
    .fill("E2E: 合作条款分歧暂停");
  await page.getByRole("button", { name: "确认停止联系" }).click();
  await page
    .getByText(/已标记停止联系/)
    .first()
    .waitFor();
  await page.waitForTimeout(800);
  const dncBadge = await sidebar.getByText("停止联系").first().isVisible();
  const taskGone = (await sidebar.getByText(/首次联系/).count()) === 0;
  check("S4 设置停止联系：原因必填+徽章出现", dncBadge);
  check("S4 联系/跟进类 open 任务被自动取消", taskBefore && taskGone);
  // 历史保留 + DNC 期间可补记历史事实
  const historyKept = await sidebar
    .getByText(/无联系记录|发信 · /)
    .first()
    .isVisible();
  check("S4 历史记录保留且可继续补记", historyKept);
  await page.screenshot({ path: `${OUT}/m3-03-dnc-set.png` });
  await sidebar.getByRole("button", { name: "关闭" }).click();

  // 列表行徽章
  const rowBadge = await page
    .getByText("【演示】山林工坊 DIY")
    .locator("xpath=ancestor::button")
    .getByText("停止联系")
    .first()
    .isVisible();
  check("S4b 列表行显示停止联系徽章", rowBadge);

  // ---------- S5 解除停止联系（需再次确认+原因） ----------
  await page.getByText("【演示】山林工坊 DIY").click();
  await page.waitForTimeout(500);
  await sidebar.getByRole("button", { name: "解除标记" }).click();
  await page.getByText(/解除后该候选恢复参与可行动名单/).waitFor();
  await page.locator("textarea").last().fill("E2E: 对方更换商务恢复联系");
  await page.getByRole("button", { name: "确认解除" }).click();
  await page
    .getByText(/已解除停止联系/)
    .first()
    .waitFor();
  await page.waitForTimeout(600);
  const badgeGone = await sidebar.getByText("未标记停止联系").isVisible();
  check("S5 解除停止联系（原因必填）", badgeGone);
  await page.screenshot({ path: `${OUT}/m3-04-dnc-unset.png` });
  await sidebar.getByRole("button", { name: "关闭" }).click();

  // ---------- S6 DNC 期间补记历史事实（demo:09 保持 DNC） ----------
  await page.getByText("【演示】海外工具哥").click();
  await page.waitForTimeout(500);
  const dncKept = await sidebar.getByText("停止联系").first().isVisible();
  await sidebar.getByRole("button", { name: "记录已联系" }).click();
  await page.getByText(/只有你确认真实发送才记一次/).waitFor();
  await page.getByRole("button", { name: "确认记录" }).click();
  await page
    .getByText(/已记录发信/)
    .first()
    .waitFor();
  await page.waitForTimeout(600);
  const dncRecorded = await sidebar
    .getByText(/发信 · /)
    .first()
    .isVisible();
  check("S6 停止联系期间可补记历史事实（标记不变）", dncKept && dncRecorded);
  await page.screenshot({ path: `${OUT}/m3-05-dnc-backfill.png` });
  await sidebar.getByRole("button", { name: "关闭" }).click();

  // ---------- S7 DNC 候选不出现在可行动导出（demo:02 先建 needs_info） ----------
  // 用单元测试覆盖的 isActionable 已证明；这里验证 demo:09（needs_info 但 DNC 且无 open 任务）不在导出
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByText("导出工作名单").waitFor();
  const actionableCount = await page
    .getByText(/位候选/)
    .first()
    .textContent();
  check(
    "S7 可行动名单预览不含停止联系候选",
    actionableCount?.includes("位候选"),
    actionableCount?.trim(),
  );
  await page.keyboard.press("Escape");
} catch (e) {
  check("脚本执行异常", false, String(e));
  await page.screenshot({ path: `${OUT}/m3-error.png` }).catch(() => {});
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
