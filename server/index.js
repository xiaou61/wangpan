const crypto = require("crypto");
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const { readDb, updateDb } = require("./db");

const app = express();
const publicDir = path.join(__dirname, "..", "public");
const PORT = Number(process.env.PORT || 3000);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "yuanfang";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "lizifan0";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const LOGIN_LOCK_MS = 24 * 60 * 60 * 1000;
const LOGIN_MAX_FAILURES = 3;
const MAX_VISITS = 5000;
const MAX_OPENS = 10000;
const MAX_REQUESTS = 3000;
const REQUEST_WINDOW_MS = 10 * 60 * 1000;
const REQUEST_MAX_PER_WINDOW = 5;

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("base64url");
const isProduction = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'"
  );
  next();
});

app.use("/assets", express.static(path.join(publicDir, "assets"), { maxAge: "7d" }));
app.use(express.static(publicDir, { index: false, extensions: ["html"] }));

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}

function limitText(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim().slice(0, 80);
  }
  return String(req.socket.remoteAddress || "unknown").slice(0, 80);
}

function parseUserAgent(raw) {
  const ua = String(raw || "").slice(0, 260);
  const lower = ua.toLowerCase();
  const device = /mobile|android|iphone|ipad|phone/.test(lower) ? "Mobile" : "Desktop";
  let browser = "Unknown";
  if (lower.includes("edg/")) browser = "Edge";
  else if (lower.includes("chrome/")) browser = "Chrome";
  else if (lower.includes("safari/")) browser = "Safari";
  else if (lower.includes("firefox/")) browser = "Firefox";
  return { userAgent: ua, device, browser };
}

function publicResource(resource, categories, opens) {
  const category = categories.find((item) => item.id === resource.categoryId) || null;
  const resourceOpens = opens.filter((item) => item.resourceId === resource.id);
  return {
    id: resource.id,
    title: resource.title,
    description: resource.description,
    categoryId: resource.categoryId,
    categoryName: category ? category.name : "未分类",
    categoryColor: category ? category.color : "#53645f",
    tags: Array.isArray(resource.tags) ? resource.tags : [],
    pinned: Boolean(resource.pinned),
    createdAt: resource.createdAt,
    openCount: resourceOpens.length,
    links: (Array.isArray(resource.links) ? resource.links : []).map((link) => ({
      id: link.id,
      provider: link.provider,
      label: providerLabel(link.provider, link.label),
      code: link.code || "",
      openUrl: `/go/${resource.id}/${link.id}`,
      openCount: resourceOpens.filter((item) => item.linkId === link.id).length
    }))
  };
}

function providerLabel(provider, fallback) {
  if (fallback) return fallback;
  if (provider === "quark") return "夸克网盘";
  if (provider === "baidu") return "百度网盘";
  return "网盘链接";
}

function providerClass(provider) {
  if (provider === "quark") return "quark";
  if (provider === "baidu") return "baidu";
  return "other";
}

function validateUrl(value) {
  const text = limitText(value, 700);
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function sendError(res, status, message) {
  res.status(status).json({ error: message });
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function createSession() {
  const payload = {
    sub: ADMIN_USERNAME,
    exp: Date.now() + SESSION_TTL_MS,
    csrf: crypto.randomBytes(18).toString("base64url")
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function verifySession(token) {
  if (!token || !token.includes(".")) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature || !timingSafeEqual(signature, sign(body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    if (payload.sub !== ADMIN_USERNAME) return null;
    return payload;
  } catch {
    return null;
  }
}

function setSessionCookie(res, token) {
  res.cookie("admin_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: isProduction,
    path: "/",
    maxAge: SESSION_TTL_MS
  });
}

function clearSessionCookie(res) {
  res.clearCookie("admin_session", {
    httpOnly: true,
    sameSite: "strict",
    secure: isProduction,
    path: "/"
  });
}

function requireAdmin(req, res, next) {
  const session = verifySession(req.cookies.admin_session);
  if (!session) return sendError(res, 401, "请先登录后台");
  req.admin = session;
  return next();
}

function requireCsrf(req, res, next) {
  const token = req.get("x-csrf-token");
  if (!req.admin || !token || token !== req.admin.csrf) {
    return sendError(res, 403, "请求校验失败，请刷新后台后重试");
  }
  return next();
}

const loginFailures = new Map();
const resourceRequestAttempts = new Map();

function loginBlockStatus(ip) {
  const now = Date.now();
  const record = loginFailures.get(ip);
  if (!record) return null;
  if (record.blockedUntil && record.blockedUntil > now) return record;
  if (record.blockedUntil && record.blockedUntil <= now) {
    loginFailures.delete(ip);
    return null;
  }
  if (now - record.firstFailureAt > LOGIN_LOCK_MS) {
    loginFailures.delete(ip);
    return null;
  }
  return null;
}

function registerLoginFailure(ip) {
  const now = Date.now();
  const record = loginFailures.get(ip);
  const next =
    record && now - record.firstFailureAt <= LOGIN_LOCK_MS
      ? { ...record, count: record.count + 1 }
      : { count: 1, firstFailureAt: now, blockedUntil: 0 };

  if (next.count >= LOGIN_MAX_FAILURES) {
    next.blockedUntil = now + LOGIN_LOCK_MS;
  }

  loginFailures.set(ip, next);
  return next;
}

function clearLoginFailures(ip) {
  loginFailures.delete(ip);
}

function formatRemaining(ms) {
  const hours = Math.max(1, Math.ceil(ms / (60 * 60 * 1000)));
  return `${hours} 小时`;
}

function checkResourceRequestLimit(ip) {
  const now = Date.now();
  const attempts = (resourceRequestAttempts.get(ip) || []).filter((time) => now - time < REQUEST_WINDOW_MS);
  if (attempts.length >= REQUEST_MAX_PER_WINDOW) {
    resourceRequestAttempts.set(ip, attempts);
    return false;
  }
  attempts.push(now);
  resourceRequestAttempts.set(ip, attempts);
  return true;
}

function recordVisit(req) {
  const ua = parseUserAgent(req.headers["user-agent"]);
  const visit = {
    id: makeId("visit"),
    createdAt: nowIso(),
    path: req.path,
    ip: getClientIp(req),
    referrer: limitText(req.get("referer"), 260),
    ...ua
  };
  updateDb((db) => {
    db.visits.unshift(visit);
    db.visits = db.visits.slice(0, MAX_VISITS);
  });
}

function recordOpen(req, resource, link) {
  const ua = parseUserAgent(req.headers["user-agent"]);
  const open = {
    id: makeId("open"),
    createdAt: nowIso(),
    resourceId: resource.id,
    resourceTitle: resource.title,
    linkId: link.id,
    provider: link.provider,
    label: providerLabel(link.provider, link.label),
    url: link.url,
    ip: getClientIp(req),
    referrer: limitText(req.get("referer"), 260),
    ...ua
  };
  updateDb((db) => {
    db.opens.unshift(open);
    db.opens = db.opens.slice(0, MAX_OPENS);
  });
}

function cleanTags(value) {
  if (Array.isArray(value)) {
    return value.map((item) => limitText(item, 24)).filter(Boolean).slice(0, 8);
  }
  return String(value || "")
    .split(",")
    .map((item) => limitText(item, 24))
    .filter(Boolean)
    .slice(0, 8);
}

function cleanLinks(input) {
  const links = Array.isArray(input) ? input : [];
  return links
    .map((link) => {
      const provider = ["quark", "baidu"].includes(link.provider) ? link.provider : "";
      const url = validateUrl(link.url);
      if (!provider || !url) return null;
      return {
        id: link.id && /^[a-zA-Z0-9_-]{4,80}$/.test(link.id) ? link.id : makeId("lnk"),
        provider,
        label: providerLabel(provider, limitText(link.label, 24)),
        url,
        code: limitText(link.code, 50)
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}

function validateCategory(body) {
  const name = limitText(body.name, 30);
  const description = limitText(body.description, 120);
  const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color || "")) ? body.color : "#1677ff";
  if (name.length < 2) return { error: "分类名称至少需要 2 个字" };
  return { value: { name, description, color } };
}

function validateResource(body, db, existingId) {
  const title = limitText(body.title, 80);
  const description = limitText(body.description, 320);
  const categoryId = limitText(body.categoryId, 80);
  const categoryExists = db.categories.some((item) => item.id === categoryId);
  const links = cleanLinks(body.links);

  if (title.length < 2) return { error: "资源标题至少需要 2 个字" };
  if (!categoryExists) return { error: "请选择有效分类" };
  if (!links.length) return { error: "至少需要填写一个有效的夸克或百度网盘链接" };

  if (existingId) {
    const current = db.resources.find((item) => item.id === existingId);
    if (current) {
      const currentLinks = new Map((current.links || []).map((link) => [link.provider, link]));
      links.forEach((link) => {
        const old = currentLinks.get(link.provider);
        if (old && !body.links.find((input) => input.id === link.id)) {
          link.id = old.id;
        }
      });
    }
  }

  return {
    value: {
      title,
      description,
      categoryId,
      tags: cleanTags(body.tags),
      active: body.active !== false,
      pinned: Boolean(body.pinned),
      links
    }
  };
}

function validateResourceRequest(body, db) {
  const title = limitText(body.title, 80);
  const description = limitText(body.description, 500);
  const contact = limitText(body.contact, 120);
  const categoryId = limitText(body.categoryId, 80);
  const name = limitText(body.name, 40);
  const urgency = ["normal", "soon", "urgent"].includes(body.urgency) ? body.urgency : "normal";

  if (title.length < 2) return { error: "请填写想要的资料名称" };
  if (description.length < 4) return { error: "请简单说明你想要什么资料" };
  if (categoryId && !db.categories.some((item) => item.id === categoryId)) {
    return { error: "请选择有效分类" };
  }

  return {
    value: {
      title,
      description,
      contact,
      categoryId,
      name,
      urgency,
      status: "new"
    }
  };
}

function categoryCounts(db) {
  const activeResources = db.resources.filter((item) => item.active !== false);
  return db.categories.map((category) => ({
    ...category,
    count: activeResources.filter((resource) => resource.categoryId === category.id).length
  }));
}

function sameDay(iso, date = new Date()) {
  const value = new Date(iso);
  return (
    value.getFullYear() === date.getFullYear() &&
    value.getMonth() === date.getMonth() &&
    value.getDate() === date.getDate()
  );
}

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function hourKey(date) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(date.getHours())}`;
}

function dayKey(date) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function countBy(items, keyFn) {
  const result = new Map();
  items.forEach((item) => {
    const key = keyFn(item) || "未知";
    result.set(key, (result.get(key) || 0) + 1);
  });
  return result;
}

function lastHours(visits, opens, count = 24) {
  const now = new Date();
  const visitMap = countBy(visits, (item) => hourKey(new Date(item.createdAt)));
  const openMap = countBy(opens, (item) => hourKey(new Date(item.createdAt)));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now);
    date.setMinutes(0, 0, 0);
    date.setHours(date.getHours() - (count - 1 - index));
    const key = hourKey(date);
    return {
      label: `${padNumber(date.getHours())}:00`,
      visits: visitMap.get(key) || 0,
      opens: openMap.get(key) || 0
    };
  });
}

function lastDays(visits, opens, count = 7) {
  const now = new Date();
  const visitMap = countBy(visits, (item) => dayKey(new Date(item.createdAt)));
  const openMap = countBy(opens, (item) => dayKey(new Date(item.createdAt)));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (count - 1 - index));
    const key = dayKey(date);
    return {
      label: `${padNumber(date.getMonth() + 1)}/${padNumber(date.getDate())}`,
      visits: visitMap.get(key) || 0,
      opens: openMap.get(key) || 0
    };
  });
}

app.get("/", (req, res) => {
  recordVisit(req);
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/yuanfang", (req, res) => {
  res.sendFile(path.join(publicDir, "yuanfang.html"));
});

app.get("/api/public/summary", (req, res) => {
  const db = readDb();
  const activeResources = db.resources.filter((item) => item.active !== false);
  const activeLinks = activeResources.reduce((sum, resource) => sum + (resource.links || []).length, 0);
  res.json({
    categories: categoryCounts(db),
    stats: {
      resources: activeResources.length,
      links: activeLinks,
      categories: db.categories.length,
      opens: db.opens.length
    }
  });
});

app.get("/api/public/resources", (req, res) => {
  const db = readDb();
  const q = limitText(req.query.q, 80).toLowerCase();
  const category = limitText(req.query.category, 80);
  const provider = limitText(req.query.provider, 20);

  let resources = db.resources.filter((item) => item.active !== false);
  if (category) resources = resources.filter((item) => item.categoryId === category);
  if (provider) {
    resources = resources.filter((item) => (item.links || []).some((link) => link.provider === provider));
  }
  if (q) {
    resources = resources.filter((item) => {
      const haystack = [item.title, item.description, ...(item.tags || [])].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }

  resources.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });

  res.json({
    resources: resources.map((resource) => publicResource(resource, db.categories, db.opens))
  });
});

app.post("/api/public/requests", (req, res) => {
  const ip = getClientIp(req);
  if (!checkResourceRequestLimit(ip)) {
    return sendError(res, 429, "提交太频繁了，请稍后再试");
  }

  const db = readDb();
  const parsed = validateResourceRequest(req.body || {}, db);
  if (parsed.error) return sendError(res, 400, parsed.error);

  const ua = parseUserAgent(req.headers["user-agent"]);
  const request = {
    id: makeId("need"),
    ...parsed.value,
    ip,
    referrer: limitText(req.get("referer"), 260),
    ...ua,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  updateDb((nextDb) => {
    nextDb.requests.unshift(request);
    nextDb.requests = nextDb.requests.slice(0, MAX_REQUESTS);
  });

  res.status(201).json({
    ok: true,
    request: {
      id: request.id,
      title: request.title,
      status: request.status,
      createdAt: request.createdAt
    }
  });
});

app.get("/go/:resourceId/:linkId", (req, res) => {
  const db = readDb();
  const resource = db.resources.find((item) => item.id === req.params.resourceId && item.active !== false);
  if (!resource) return res.status(404).send("资源不存在或已下架");
  const link = (resource.links || []).find((item) => item.id === req.params.linkId);
  if (!link) return res.status(404).send("链接不存在");
  recordOpen(req, resource, link);
  res.redirect(302, link.url);
});

app.post("/api/admin/login", (req, res) => {
  const ip = getClientIp(req);
  const blocked = loginBlockStatus(ip);
  if (blocked) {
    return sendError(res, 429, `这个 IP 登录错误已达 3 次，请 ${formatRemaining(blocked.blockedUntil - Date.now())} 后再试`);
  }

  const username = limitText(req.body.username, 80);
  const password = String(req.body.password || "");
  if (username !== ADMIN_USERNAME || !timingSafeEqual(password, ADMIN_PASSWORD)) {
    const failed = registerLoginFailure(ip);
    if (failed.blockedUntil) {
      return sendError(res, 429, "账号或密码错误已达 3 次，这个 IP 已锁定 24 小时");
    }
    return sendError(res, 401, `账号或密码不正确，还剩 ${LOGIN_MAX_FAILURES - failed.count} 次机会`);
  }

  clearLoginFailures(ip);
  const token = createSession();
  const session = verifySession(token);
  setSessionCookie(res, token);
  res.json({ ok: true, username: ADMIN_USERNAME, csrfToken: session.csrf });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({ username: ADMIN_USERNAME, csrfToken: req.admin.csrf });
});

app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const db = readDb();
  const today = new Date();
  const linkStats = [];
  db.resources.forEach((resource) => {
    (resource.links || []).forEach((link) => {
      const opens = db.opens.filter((item) => item.resourceId === resource.id && item.linkId === link.id);
      linkStats.push({
        resourceId: resource.id,
        resourceTitle: resource.title,
        linkId: link.id,
        provider: link.provider,
        label: providerLabel(link.provider, link.label),
        count: opens.length,
        lastOpenAt: opens[0] ? opens[0].createdAt : ""
      });
    });
  });
  linkStats.sort((a, b) => b.count - a.count);

  const resourceStats = db.resources
    .map((resource) => {
      const opens = db.opens.filter((item) => item.resourceId === resource.id);
      return {
        resourceId: resource.id,
        resourceTitle: resource.title,
        count: opens.length,
        lastOpenAt: opens[0] ? opens[0].createdAt : ""
      };
    })
    .sort((a, b) => b.count - a.count);

  const providerStats = Array.from(countBy(db.opens, (item) => providerLabel(item.provider, item.label))).map(([label, count]) => ({
    label,
    count
  }));
  providerStats.sort((a, b) => b.count - a.count);

  const deviceStats = Array.from(countBy(db.visits, (item) => item.device)).map(([label, count]) => ({ label, count }));
  deviceStats.sort((a, b) => b.count - a.count);

  const browserStats = Array.from(countBy(db.visits, (item) => item.browser)).map(([label, count]) => ({ label, count }));
  browserStats.sort((a, b) => b.count - a.count);

  const todayVisits = db.visits.filter((item) => sameDay(item.createdAt, today));
  const todayOpens = db.opens.filter((item) => sameDay(item.createdAt, today));
  const todayUniqueIps = new Set(todayVisits.map((item) => item.ip)).size;

  res.json({
    totals: {
      resources: db.resources.length,
      activeResources: db.resources.filter((item) => item.active !== false).length,
      categories: db.categories.length,
      visits: db.visits.length,
      opens: db.opens.length,
      todayVisits: todayVisits.length,
      todayOpens: todayOpens.length,
      todayUniqueIps,
      openRate: todayVisits.length ? Number((todayOpens.length / todayVisits.length).toFixed(2)) : 0,
      requests: db.requests.length,
      newRequests: db.requests.filter((item) => item.status === "new").length
    },
    topLinks: linkStats.slice(0, 10),
    topResources: resourceStats.slice(0, 10),
    providerStats,
    deviceStats,
    browserStats,
    hourlyTrend: lastHours(db.visits, db.opens),
    dailyTrend: lastDays(db.visits, db.opens),
    recentVisits: db.visits.slice(0, 12),
    recentOpens: db.opens.slice(0, 12)
  });
});

app.get("/api/admin/categories", requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ categories: categoryCounts(db) });
});

app.post("/api/admin/categories", requireAdmin, requireCsrf, (req, res) => {
  const db = readDb();
  const parsed = validateCategory(req.body || {});
  if (parsed.error) return sendError(res, 400, parsed.error);

  const category = {
    id: makeId("cat"),
    ...parsed.value,
    createdAt: nowIso()
  };
  updateDb((nextDb) => {
    nextDb.categories.unshift(category);
  });
  res.status(201).json({ category });
});

app.put("/api/admin/categories/:id", requireAdmin, requireCsrf, (req, res) => {
  const parsed = validateCategory(req.body || {});
  if (parsed.error) return sendError(res, 400, parsed.error);

  const category = updateDb((db) => {
    const item = db.categories.find((entry) => entry.id === req.params.id);
    if (!item) return null;
    Object.assign(item, parsed.value);
    return item;
  });

  if (!category) return sendError(res, 404, "分类不存在");
  res.json({ category });
});

app.delete("/api/admin/categories/:id", requireAdmin, requireCsrf, (req, res) => {
  const removed = updateDb((db) => {
    const used = db.resources.some((resource) => resource.categoryId === req.params.id);
    if (used) return "used";
    const before = db.categories.length;
    db.categories = db.categories.filter((category) => category.id !== req.params.id);
    return before !== db.categories.length ? "removed" : "";
  });
  if (removed === "used") return sendError(res, 409, "这个分类下还有资源，先移动或删除资源");
  if (!removed) return sendError(res, 404, "分类不存在");
  res.json({ ok: true });
});

app.get("/api/admin/resources", requireAdmin, (req, res) => {
  const db = readDb();
  res.json({
    resources: db.resources,
    categories: categoryCounts(db)
  });
});

app.post("/api/admin/resources", requireAdmin, requireCsrf, (req, res) => {
  const db = readDb();
  const parsed = validateResource(req.body || {}, db);
  if (parsed.error) return sendError(res, 400, parsed.error);

  const resource = {
    id: makeId("res"),
    ...parsed.value,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  updateDb((nextDb) => {
    nextDb.resources.unshift(resource);
  });
  res.status(201).json({ resource });
});

app.put("/api/admin/resources/:id", requireAdmin, requireCsrf, (req, res) => {
  const currentDb = readDb();
  const parsed = validateResource(req.body || {}, currentDb, req.params.id);
  if (parsed.error) return sendError(res, 400, parsed.error);

  const resource = updateDb((db) => {
    const item = db.resources.find((entry) => entry.id === req.params.id);
    if (!item) return null;
    Object.assign(item, parsed.value, { updatedAt: nowIso() });
    return item;
  });

  if (!resource) return sendError(res, 404, "资源不存在");
  res.json({ resource });
});

app.delete("/api/admin/resources/:id", requireAdmin, requireCsrf, (req, res) => {
  const removed = updateDb((db) => {
    const before = db.resources.length;
    db.resources = db.resources.filter((resource) => resource.id !== req.params.id);
    return before !== db.resources.length;
  });
  if (!removed) return sendError(res, 404, "资源不存在");
  res.json({ ok: true });
});

app.get("/api/admin/visits", requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit || 120), 500);
  const db = readDb();
  res.json({ visits: db.visits.slice(0, limit) });
});

app.get("/api/admin/opens", requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit || 160), 500);
  const resourceId = limitText(req.query.resourceId, 80);
  const db = readDb();
  const opens = resourceId ? db.opens.filter((item) => item.resourceId === resourceId) : db.opens;
  res.json({ opens: opens.slice(0, limit) });
});

app.get("/api/admin/requests", requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit || 200), 500);
  const status = limitText(req.query.status, 20);
  const db = readDb();
  const requests = status ? db.requests.filter((item) => item.status === status) : db.requests;
  res.json({ requests: requests.slice(0, limit), categories: db.categories });
});

app.patch("/api/admin/requests/:id", requireAdmin, requireCsrf, (req, res) => {
  const status = ["new", "processing", "done"].includes(req.body.status) ? req.body.status : "";
  if (!status) return sendError(res, 400, "请选择有效状态");

  const request = updateDb((db) => {
    const item = db.requests.find((entry) => entry.id === req.params.id);
    if (!item) return null;
    item.status = status;
    item.updatedAt = nowIso();
    return item;
  });

  if (!request) return sendError(res, 404, "需求不存在");
  res.json({ request });
});

app.delete("/api/admin/requests/:id", requireAdmin, requireCsrf, (req, res) => {
  const removed = updateDb((db) => {
    const before = db.requests.length;
    db.requests = db.requests.filter((item) => item.id !== req.params.id);
    return before !== db.requests.length;
  });
  if (!removed) return sendError(res, 404, "需求不存在");
  res.json({ ok: true });
});

app.use((req, res) => {
  if (req.path.startsWith("/api/")) return sendError(res, 404, "接口不存在");
  res.status(404).sendFile(path.join(publicDir, "index.html"));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  sendError(res, 500, "服务器暂时开小差了，请稍后再试");
});

app.listen(PORT, () => {
  console.log(`Netdisk resource hub running at http://localhost:${PORT}`);
  console.log(`Admin page: http://localhost:${PORT}/yuanfang`);
});
