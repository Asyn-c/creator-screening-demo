/* eslint-disable no-console */
/**
 * 提效模拟·工具路径实测：10 位基准候选 → 自动获取资料 → 逐位人工判断 → 导出可行动名单
 * 计时口径（PRD §8）：
 *   - setup: 导入+批量获取（首次配置性质）
 *   - active: 操作者动作（打开/点选/填写/保存）——脚本模拟，动作数客观、时间为机器实测
 *   - wait: 机器等待（资料获取往返）
 * 产出：evidence/benchmark/*.png + 控制台指标 JSON（写入 docs/benchmark.csv 由人工整理）
 * 附带：A11 资料刷新→待复核 闭环验证（bm01 保存判断→再获取→待复核徽章）
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:5173";
const OUT = "evidence/benchmark";
mkdirSync(OUT, { recursive: true });

// 基准批次：10 位合成候选（TESTKEY 夹具资料），决策分布 4优先/3待补/3暂缓
const ts = Date.now().toString().slice(-8);
const cid = (n) => "UC" + (ts + n).padEnd(22, "7").slice(0, 22);
const BATCH = [
  {
    id: cid("01"),
    name: "bm01-DIY木工工坊",
    decision: "priority_contact",
    scene: "yes",
    reason: "近期视频为木工与装修实测，产品可自然植入",
    evidence: "视频1 展示挂墙找平场景",
    task: "first_contact",
    due: 2,
  },
  {
    id: cid("02"),
    name: "bm02-工具测评站",
    decision: "priority_contact",
    scene: "yes",
    reason: "持续做工具横评，受众与品类高度相关",
    evidence: "视频1 激光水平仪横评内容",
    task: "first_contact",
    due: 2,
  },
  {
    id: cid("03"),
    name: "bm03-ProTools品牌号",
    decision: "paused",
    scene: "no",
    reason: "品牌自营频道，不适合以创作者身份合作",
    task: null,
    due: 0,
  },
  {
    id: cid("04"),
    name: "bm04-生活杂记",
    decision: "needs_info",
    scene: "unknown",
    reason: "内容较杂，偶有装修内容，主体与受众待确认",
    task: "collect_info",
    due: 3,
  },
  {
    id: cid("05"),
    name: "bm05-烘焙日记",
    decision: "paused",
    scene: "no",
    reason: "美食烘焙场景与测量工具不适配",
    task: null,
    due: 0,
  },
  {
    id: cid("06"),
    name: "bm06-新手上路",
    decision: "needs_info",
    scene: "unknown",
    reason: "频道较新，量级与更新频率待核实",
    task: "collect_info",
    due: 5,
  },
  {
    id: cid("07"),
    name: "bm07-老屋改造",
    decision: "priority_contact",
    scene: "yes",
    reason: "装修改造Vlog场景契合，可自然展示测量过程",
    evidence: "视频2 全屋找平改造记录",
    task: "first_contact",
    due: 2,
  },
  {
    id: cid("08"),
    name: "bm08-音乐现场",
    decision: "paused",
    scene: "no",
    reason: "音乐内容与产品场景无关",
    task: null,
    due: 0,
  },
  {
    id: cid("09"),
    name: "bm09-测量课堂",
    decision: "priority_contact",
    scene: "yes",
    reason: "测量仪器教学频道，受众即目标用户",
    evidence: "视频1 激光测距仪教程",
    task: "follow_up",
    due: 1,
  },
  {
    id: cid("10"),
    name: "bm10-空白频道",
    decision: "needs_info",
    scene: "unknown",
    reason: "资料过少，先补齐主体与内容方向",
    task: "collect_info",
    due: 5,
  },
];

const metrics = {
  started_at: new Date().toISOString(),
  actions: 0,
  phases: {},
};
const tick = () => Date.now();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
const act = (n = 1) => {
  metrics.actions += n;
};

try {
  // ---------- 登录（不计入任务时间） ----------
  await page.goto(BASE);
  await page.fill('input[type="email"]', "m0test@example.com");
  await page.fill('input[type="password"]', "test123456");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/");
  await page.goto(`${BASE}/#/candidates`);
  await page.getByRole("button", { name: "真实空间", exact: true }).click();
  await page.waitForTimeout(600);

  // ---------- Phase 1: 导入（setup） ----------
  let t0 = tick();
  await page.getByRole("button", { name: "导入候选" }).click();
  await page.locator("textarea").fill(BATCH.map((b) => b.id).join("\n"));
  act(2); // 粘贴 + 点确认
  await page.getByRole("button", { name: "确认导入" }).click();
  await page.getByText(/已导入：新增 10/).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  metrics.phases.setup_import_s = (tick() - t0) / 1000;

  // ---------- Phase 2: 批量资料获取（setup，含机器等待） ----------
  t0 = tick();
  let waitMs = 0;
  for (const b of BATCH) {
    await page.getByText(b.id).first().click();
    await page.waitForTimeout(300);
    const sidebar = page.locator("div.fixed.inset-y-0.right-0");
    act(1); // 点「更新资料」
    const fw = tick();
    await sidebar.getByRole("button", { name: "更新资料" }).click();
    await page
      .getByText(/资料已更新：3 条近期视频/)
      .first()
      .waitFor();
    waitMs += tick() - fw;
    act(1); // 关闭
    await sidebar.getByRole("button", { name: "关闭" }).click();
    await page.waitForTimeout(200);
  }
  metrics.phases.setup_fetch_s = (tick() - t0) / 1000;
  metrics.phases.setup_fetch_wait_s = waitMs / 1000;
  await page.screenshot({ path: `${OUT}/bm-01-after-fetch.png` });

  // ---------- Phase 3: 逐位判断（active） ----------
  t0 = tick();
  for (const b of BATCH) {
    await page.getByText(b.id).first().click();
    await page.waitForTimeout(300);
    const sidebar = page.locator("div.fixed.inset-y-0.right-0");
    act(1); // 打开候选
    if (b.scene !== "unknown") {
      await sidebar
        .getByRole("button", { name: b.scene === "yes" ? "符合" : "不符合" })
        .first()
        .click();
      act(1);
    }
    await sidebar.getByRole("combobox").first().click();
    await page
      .getByRole("option", {
        name:
          b.decision === "priority_contact"
            ? "优先联系"
            : b.decision === "needs_info"
              ? "待补资料"
              : "暂缓",
      })
      .click();
    act(2); // 结论选择
    await sidebar.locator("textarea").nth(0).fill(b.reason);
    act(1);
    if (b.evidence) {
      await sidebar.locator("textarea").nth(1).fill(b.evidence);
      act(1);
    }
    if (b.decision === "needs_info") {
      await sidebar.locator("textarea").nth(2).fill("受众地区是否以美国为主？");
      act(1);
    }
    if (b.task) {
      await sidebar.getByRole("combobox").nth(1).click();
      await page
        .getByRole("option", {
          name:
            b.task === "first_contact"
              ? "首次联系"
              : b.task === "collect_info"
                ? "补资料"
                : "跟进",
        })
        .click();
      act(2);
      const d = new Date(Date.now() + b.due * 86400000)
        .toISOString()
        .slice(0, 10);
      await sidebar.locator('input[type="date"]').fill(d);
      act(1);
    }
    await sidebar.getByRole("button", { name: "保存初筛结论" }).click();
    act(1);
    await page.getByText("初筛结论已保存").first().waitFor();
    await sidebar.getByRole("button", { name: "关闭" }).click();
    act(1);
    await page.waitForTimeout(200);
  }
  metrics.phases.active_assess_s = (tick() - t0) / 1000;

  // ---------- A11 验证：bm01 再获取 → 待复核 ----------
  await page.getByText(BATCH[0].id).first().click();
  await page.waitForTimeout(300);
  const sb = page.locator("div.fixed.inset-y-0.right-0");
  await sb.getByRole("button", { name: "更新资料" }).click();
  await page
    .getByText(/资料已更新：3 条近期视频/)
    .first()
    .waitFor();
  await page.waitForTimeout(500);
  const staleVisible = await sb.getByText("待复核").first().isVisible();
  console.log(
    staleVisible
      ? "PASS  A11 资料刷新后旧判断进入待复核"
      : "FAIL  A11 待复核未出现",
  );
  await sb.getByRole("button", { name: "关闭" }).click();
  await page.screenshot({ path: `${OUT}/bm-02-a11-stale.png` });

  // ---------- Phase 4: 导出可行动名单 ----------
  t0 = tick();
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByText("导出工作名单").waitFor();
  const countText = await page
    .getByText(/位候选/)
    .first()
    .textContent();
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /下载 CSV/ }).click(),
  ]);
  act(2); // 打开导出 + 下载
  await dl.saveAs(`${OUT}/bm-export-actionable.csv`);
  metrics.phases.active_export_s = (tick() - t0) / 1000;
  console.log(`可行动名单预览计数: ${countText?.trim()}`);

  metrics.finished_at = new Date().toISOString();
  metrics.total_machine_s =
    metrics.phases.setup_import_s +
    metrics.phases.setup_fetch_s +
    metrics.phases.active_assess_s +
    metrics.phases.active_export_s;
  console.log("\n===== 工具路径实测指标 =====");
  console.log(JSON.stringify(metrics, null, 2));
  writeFileSync(`${OUT}/tool-metrics.json`, JSON.stringify(metrics, null, 2));
} catch (e) {
  console.error("脚本异常:", String(e));
  await page.screenshot({ path: `${OUT}/bm-error.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
