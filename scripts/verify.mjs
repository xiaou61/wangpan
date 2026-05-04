import { chromium } from "playwright";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3003";
const adminUsername = process.env.ADMIN_USERNAME || "yuanfang";
const adminPassword = process.env.ADMIN_PASSWORD || "lizifan0";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
const page = await context.newPage();

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error" && !msg.text().includes("401")) errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(err.message));

async function removeVerificationResources(page) {
  await page.evaluate(async () => {
    const me = await fetch("/api/admin/me").then((res) => res.json());
    const data = await fetch("/api/admin/resources").then((res) => res.json());
    const targets = (data.resources || []).filter((item) => item.title === "Playwright 验证资料");
    await Promise.all(
      targets.map((item) =>
        fetch(`/api/admin/resources/${item.id}`, {
          method: "DELETE",
          headers: { "X-CSRF-Token": me.csrfToken }
        })
      )
    );
  });
}

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.screenshot({ path: "output/playwright/public-desktop.png", fullPage: true });
await page.fill("#keywordInput", "办公");
await page.waitForTimeout(350);
const visibleCards = await page.locator(".resource-card").count();
if (visibleCards < 1) throw new Error("Public search returned no resource cards");

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.screenshot({ path: "output/playwright/public-mobile.png", fullPage: true });
const mobileCards = await page.locator(".resource-card").count();
if (mobileCards < 1) throw new Error("Mobile public page has no resource cards");

await page.setViewportSize({ width: 1440, height: 980 });
await page.goto(`${baseUrl}/yuanfang`, { waitUntil: "networkidle" });
await page.fill('input[name="username"]', adminUsername);
await page.fill('input[name="password"]', adminPassword);
await page.click('button[type="submit"]');
await page.waitForSelector(".admin-app:not([hidden])", { timeout: 5000 });
await removeVerificationResources(page);
await page.waitForTimeout(700);
await page.screenshot({ path: "output/playwright/admin-dashboard.png", fullPage: true });
if ((await page.locator(".dashboard-screen").count()) < 1) throw new Error("Dashboard screen is missing");
if ((await page.locator(".trend-bar").count()) !== 24) throw new Error("Hourly trend should render 24 bars");

await page.click('[data-view="resources"]');
await page.click("#newResourceButtonInline");
await page.waitForSelector("#resourceDialog[open]");
await page.fill('input[name="title"]', "Playwright 验证资料");
await page.fill('textarea[name="description"]', "自动化验证创建的临时资料。");
await page.fill('input[name="tags"]', "测试, 自动化");
await page.fill('input[name="quarkUrl"]', "https://pan.quark.cn/");
await page.click("#resourceForm .primary-button");
await page.waitForFunction(() => !document.querySelector("#resourceDialog")?.hasAttribute("open"));
await page.waitForTimeout(300);
const created = await page.locator("tbody#resourceRows", { hasText: "Playwright 验证资料" }).count();
if (created < 1) throw new Error("Admin create resource did not appear in table");

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.fill("#keywordInput", "Playwright");
await page.waitForTimeout(350);
const publicCreated = await page.locator(".resource-card", { hasText: "Playwright 验证资料" }).count();
if (publicCreated < 1) throw new Error("Created resource did not appear on public page");
await page.goto(`${baseUrl}/yuanfang`, { waitUntil: "networkidle" });
await removeVerificationResources(page);

const lockIp = `203.0.113.${Math.floor(Math.random() * 80) + 10}`;
for (let i = 0; i < 3; i += 1) {
  await page.request.post(`${baseUrl}/api/admin/login`, {
    headers: { "x-forwarded-for": lockIp },
    data: { username: adminUsername, password: `wrong-${i}` }
  });
}
const locked = await page.request.post(`${baseUrl}/api/admin/login`, {
  headers: { "x-forwarded-for": lockIp },
  data: { username: adminUsername, password: adminPassword }
});
if (locked.status() !== 429) throw new Error("Login lockout did not block the IP after 3 failures");

if (errors.length) {
  throw new Error(`Browser console errors: ${errors.join(" | ")}`);
}

await browser.close();
console.log("Playwright verification passed");
