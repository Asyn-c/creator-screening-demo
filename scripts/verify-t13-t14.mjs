/* eslint-disable no-console */
/**
 * M1-T13/T14 端到端验证脚本（Playwright 库 API，非 test runner）
 * 前置：supabase start + npm run dev；账号 m0test@example.com / test123456
 * 产出：evidence/M1/t14-*.png 截图 + 控制台逐项 PASS/FAIL
 * 运行：node scripts/verify-t13-t14.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:5173";
const OUT = "evidence/M1";
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
  // ---------- 登录 ----------
  await page.goto(BASE);
  await page.fill('input[type="email"]', "m0test@example.com");
  await page.fill('input[type="password"]', "test123456");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/", { timeout: 20000 });
  check("登录成功", true);

  // ---------- S1 工作台 demo 模式 10 种子 ----------
  await page.goto(`${BASE}/#/candidates`);
  await page.getByRole("button", { name: "体验示例" }).click();
  await page.waitForTimeout(1200);
  const rows = await page.getByText("【演示】").count();
  check("S1 demo 工作台加载种子", rows >= 10, `${rows} 行含【演示】`);
  await page.screenshot({ path: `${OUT}/t14-01-workbench-demo.png` });

  // ---------- S2 待办视图：逾期/今天/之后 分组 ----------
  await page.getByRole("button", { name: "待办", exact: true }).click();
  await page.waitForTimeout(500);
  const overdueVisible = await page
    .getByRole("heading", { name: "逾期" })
    .isVisible();
  const overdueMeta = await page.getByText("1 项 · 日期早于今天").isVisible();
  const demo10Row = await page.getByText("【演示】新晋工具Up主").isVisible();
  // 宿主时区与 Asia/Shanghai 一致：动态取「昨天」的本地日期
  const yd = new Date(Date.now() - 86400000);
  const yesterday = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, "0")}-${String(yd.getDate()).padStart(2, "0")}`;
  const redDate = await page.getByText(yesterday).isVisible();
  const laterVisible = await page
    .getByText("之后", { exact: true })
    .isVisible();
  check(
    "S2 待办分组：demo:10 任务在逾期组（昨天 due，红色日期）",
    overdueVisible && overdueMeta && demo10Row && redDate,
    `heading=${overdueVisible} meta=${overdueMeta} demo10=${demo10Row} redDate=${redDate}`,
  );
  check("S2 待办显示「之后」组（demo:01/demo:02 未来任务）", laterVisible);
  await page.screenshot({ path: `${OUT}/t14-02-todo-groups.png` });

  // ---------- S3 demo:01 保存「优先联系 + 询问条件」 ----------
  await page.getByRole("button", { name: "全部候选", exact: true }).click();
  await page.getByText("【演示】山林工坊 DIY").click();
  await page.waitForTimeout(600);
  // 五项检查：场景适配=符合
  const sidebar = page.locator("div.fixed.inset-y-0.right-0");
  await sidebar.getByRole("button", { name: "符合" }).first().click();
  await sidebar
    .locator("textarea")
    .nth(0)
    .fill("【演示】DIY 木工场景实测，受众与产品高度相关");
  await sidebar
    .locator("textarea")
    .nth(1)
    .fill("https://example.com/video/demo01 · 视频演示了挂墙找平场景");
  // 结论=优先联系（Radix Select: combobox + option）
  await sidebar.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "优先联系" }).click();
  // 下一步动作=首次联系
  await sidebar.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: "首次联系" }).click();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await sidebar.locator('input[type="date"]').fill(tomorrow);
  await sidebar.getByRole("button", { name: "保存初筛结论" }).click();
  await page.getByText("初筛结论已保存").waitFor();
  await page.waitForTimeout(800);
  const badgePC = await page
    .getByText("【演示】山林工坊 DIY")
    .locator("xpath=ancestor::button")
    .getByText("优先联系")
    .first()
    .isVisible();
  check("S3 保存优先联系后列表徽章同步（T12 缺陷①回归）", badgePC);
  await page.screenshot({ path: `${OUT}/t14-03-priority-saved.png` });

  // ---------- S4 未保存切换守卫（A19） ----------
  await sidebar.locator("textarea").nth(0).fill("【演示】修改后的理由——未保存");
  await page.getByText("【演示】Builder 小站").click();
  await page.getByText("有未保存的修改").waitFor();
  check("S4 切换候选弹出未保存守卫", true);
  await page.screenshot({ path: `${OUT}/t14-04-unsaved-guard.png` });
  await page.getByRole("button", { name: "保存草稿并继续" }).click();
  await page.getByText("草稿已保存").waitFor();
  await page.waitForTimeout(600);
  // demo:02 侧栏打开（串数据回归：表单应为 demo:02 的初始态，不残留 demo:01 文本）
  const leaked = await sidebar.locator("textarea").nth(0).inputValue();
  check("S4 切换后侧栏不串数据", leaked === "", `reason="${leaked}"`);

  // ---------- S5 草稿持久化：重开 demo:01 显示草稿横幅 → 刷新仍在 ----------
  await sidebar.getByRole("button", { name: "关闭" }).click();
  await page.waitForTimeout(400);
  await page.getByText("【演示】山林工坊 DIY").click();
  await page.waitForTimeout(600);
  const draftBanner = await page.getByText(/已恢复未提交草稿/).isVisible();
  check("S5 重开候选恢复草稿", draftBanner);
  await page.reload();
  await page.waitForTimeout(1500);
  await page.getByText("【演示】山林工坊 DIY").click();
  await page.waitForTimeout(600);
  const draftAfterReload = await page.getByText(/已恢复未提交草稿/).isVisible();
  check("S5 刷新页面后草稿仍持久化", draftAfterReload);
  await page.screenshot({ path: `${OUT}/t14-05-draft-restored.png` });
  // 放弃草稿，恢复干净状态
  await page.getByRole("button", { name: "放弃草稿" }).click();
  await page.getByText("草稿已放弃").waitFor();
  await page.waitForTimeout(400);

  // ---------- S6 demo:10 确认仍适用（修复后应成功且任务保留） ----------
  await sidebar.getByRole("button", { name: "关闭" }).click();
  await page.getByText("【演示】新晋工具Up主").click();
  await page.waitForTimeout(600);
  const confirmBtn = page.getByRole("button", { name: "确认仍适用" });
  check("S6 demo:10 显示待复核提示", await confirmBtn.isVisible());
  await confirmBtn.click();
  await page.getByText("已确认仍适用").waitFor();
  await page.waitForTimeout(800);
  check("S6 确认仍适用成功（不再报缺任务错误）", true);
  await page.screenshot({ path: `${OUT}/t14-06-confirm-review.png` });

  // ---------- S7 完成任务（demo:10 逾期任务，无下一步） ----------
  await sidebar.getByRole("button", { name: "完成任务" }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "确认完成" }).click();
  await page.getByText("任务已完成，暂无下一步").waitFor();
  await page.waitForTimeout(800);
  await sidebar.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "待办", exact: true }).click();
  await page.waitForTimeout(500);
  const demo10InTodo = await page.getByText("【演示】新晋工具Up主").count();
  check("S7 完成任务后待办不再显示该候选", demo10InTodo === 0);
  await page.screenshot({ path: `${OUT}/t14-07-task-completed-todo.png` });

  // ---------- S8 提醒：demo:07/demo:08 徽章 + 侧栏横幅 + 关闭开关 ----------
  await page.getByRole("button", { name: "全部候选", exact: true }).click();
  await page.waitForTimeout(400);
  const r07 = await page
    .getByText("【演示】周末修理工")
    .locator("xpath=ancestor::button")
    .getByText("⏰ 提醒")
    .isVisible();
  const r08 = await page
    .getByText("【演示】创客工坊 Max")
    .locator("xpath=ancestor::button")
    .getByText("⏰ 提醒")
    .isVisible();
  check("S8 demo:07(间隔)/demo:08(次数) 行内提醒徽章", r07 && r08);
  await page.getByText("【演示】创客工坊 Max").click();
  await page.waitForTimeout(600);
  const banner = await page.getByText(/已累计发信 5 次/).isVisible();
  check("S8 侧栏提醒横幅列出触发规则", banner);
  await page.screenshot({ path: `${OUT}/t14-08-reminder-banner.png` });
  await sidebar.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "任务背景设置" }).click();
  await page.getByLabel(/联系提醒/).click(); // 关闭
  await page.waitForTimeout(400);
  const r07off = await page
    .getByText("【演示】周末修理工")
    .locator("xpath=ancestor::button")
    .getByText("⏰ 提醒")
    .count();
  check("S8 关闭提醒后徽章消失（仅影响展示）", r07off === 0);
  await page.getByLabel(/联系提醒/).click(); // 重新开启
  await page.getByRole("button", { name: "任务背景设置" }).click(); // 收起面板
  await page.screenshot({ path: `${OUT}/t14-09-reminder-off.png` });

  // ---------- S9 服务失败保留输入（A19 后半） ----------
  await page.getByText("【演示】Builder 小站").click();
  await page.waitForTimeout(600);
  await sidebar
    .locator("textarea")
    .nth(0)
    .fill("【演示】服务失败时这段输入必须保留");
  await page.route("**/rpc/save_assessment*", (route) => route.abort());
  await sidebar.getByRole("button", { name: "保存初筛结论" }).click();
  await page.waitForTimeout(1200);
  const kept = await sidebar.locator("textarea").nth(0).inputValue();
  check("S9 保存失败后输入保留", kept.includes("必须保留"), `reason="${kept}"`);
  await page.unroute("**/rpc/save_assessment*");
  await page.screenshot({ path: `${OUT}/t14-10-save-failure-keeps-input.png` });
  // 关闭时触发守卫：选「放弃更改」清理脏状态
  await sidebar.getByRole("button", { name: "关闭" }).click();
  await page.getByText("有未保存的修改").waitFor();
  await page.getByRole("button", { name: "放弃更改" }).click();
  await page.waitForTimeout(500);

  // ---------- S10 模式切换隔离回归 ----------
  await page.getByRole("button", { name: "真实空间", exact: true }).click();
  await page.waitForTimeout(1000);
  const m0 = await page.getByText("M0-Alpha").count();
  const demoLeak = await page.getByText("【演示】").count();
  check(
    "S10 真实空间 M0 记录在且无演示数据串入",
    m0 > 0 && demoLeak === 0,
    `M0行=${m0} 演示行=${demoLeak}`,
  );
  await page.screenshot({ path: `${OUT}/t14-11-real-isolated.png` });

  // ---------- S11 评估版本去重（DB 层） ----------
  await page.getByRole("button", { name: "体验示例", exact: true }).click();
  await page.waitForTimeout(1000);
  const { execSync } = await import("node:child_process");
  const countVersions = () =>
    execSync(
      `docker exec supabase_db_atomic-crm-demo psql -U postgres -d postgres -tAc "select count(*) from assessment a join contacts c on c.id=a.candidate_id where c.channel_id='demo:01'"`,
    )
      .toString()
      .trim();
  const before = countVersions();
  await page.getByText("【演示】山林工坊 DIY").click();
  await page.waitForTimeout(600);
  // 不改任何内容直接保存 → RPC 应去重（提示仍是「已保存」，但版本数不变）
  await sidebar.getByRole("button", { name: "保存初筛结论" }).click();
  await page.getByText("初筛结论已保存").waitFor();
  await page.waitForTimeout(800);
  const after = countVersions();
  check(
    "S11 内容不变重复保存不追加评估版本（服务端去重）",
    before === after && before !== "",
    `版本数 ${before} → ${after}`,
  );
} catch (e) {
  check("脚本执行异常", false, String(e));
  await page.screenshot({ path: `${OUT}/t14-error.png` }).catch(() => {});
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n===== ${results.length - failed.length}/${results.length} 通过 =====`,
  );
  if (failed.length) {
    console.log("失败项:");
    failed.forEach((f) => console.log(`  - ${f.name} ${f.detail}`));
    process.exit(1);
  }
}
