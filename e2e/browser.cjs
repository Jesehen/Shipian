const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const artifacts = path.join(root, "test-artifacts");
fs.mkdirSync(artifacts, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(edgePath) ? edgePath : undefined
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai"
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle" });
  assert((await page.locator("body").innerText()).includes("今天想留下什么"), "首页没有正确渲染");
  assert((await page.locator("[data-view='today']").isVisible()), "今天页面不可见");

  await page.getByRole("button", { name: "添加片段" }).click();
  await page.locator("#captureContent").fill("明天下午3点记得取消视频会员");
  assert((await page.locator("#detectedCategory").innerText()) === "待办", "没有自动识别为待办");
  await page.locator("#detectedReminderButton").click();
  assert(await page.locator("#captureReminder").inputValue(), "没有填入识别到的提醒时间");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "提醒", exact: true }).click();
  assert(
    (await page.locator("[data-view='reminders']").innerText()).includes("取消视频会员"),
    "提醒页没有显示刚保存的内容"
  );

  await page.getByRole("button", { name: "添加片段" }).click();
  await page.locator("#captureContent").fill("今天在路上看到很好看的晚霞");
  assert((await page.locator("#detectedCategory").innerText()) === "笔记", "普通内容被错误分类");
  await page.getByRole("button", { name: "保存", exact: true }).click();

  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.locator("#searchInput").fill("晚霞");
  assert(
    (await page.locator("#searchResults").innerText()).includes("晚霞"),
    "搜索没有找到刚保存的笔记"
  );

  await page.screenshot({
    path: path.join(artifacts, "iphone-home-flow.png"),
    fullPage: true
  });

  const hasServiceWorker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
  assert(hasServiceWorker, "Service Worker 没有激活");

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  assert((await page.locator("body").innerText()).includes("搜索"), "离线重载失败");
  await context.setOffline(false);

  assert(consoleErrors.length === 0, `浏览器控制台错误：${consoleErrors.join(" | ")}`);
  console.log(
    JSON.stringify(
      {
        status: "passed",
        checks: [
          "首页渲染",
          "自动分类为待办",
          "日期识别并附加提醒",
          "普通内容归入笔记",
          "提醒汇总",
          "关键词搜索",
          "Service Worker",
          "离线重载",
          "无控制台错误"
        ],
        screenshot: path.join(artifacts, "iphone-home-flow.png")
      },
      null,
      2
    )
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
