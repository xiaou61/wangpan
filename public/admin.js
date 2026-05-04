const state = {
  csrfToken: "",
  categories: [],
  resources: [],
  stats: null,
  currentView: "dashboard"
};

const q = (selector, root = document) => root.querySelector(selector);
const qa = (selector, root = document) => [...root.querySelectorAll(selector)];

const els = {
  loginScreen: q("#loginScreen"),
  loginForm: q("#loginForm"),
  loginMessage: q("#loginMessage"),
  adminApp: q("#adminApp"),
  adminName: q("#adminName"),
  viewTitle: q("#viewTitle"),
  logoutButton: q("#logoutButton"),
  newResourceButton: q("#newResourceButton"),
  newResourceButtonInline: q("#newResourceButtonInline"),
  statGrid: q("#statGrid"),
  topLinks: q("#topLinks"),
  recentOpens: q("#recentOpens"),
  resourceRows: q("#resourceRows"),
  categoryForm: q("#categoryForm"),
  categoryAdminList: q("#categoryAdminList"),
  visitRows: q("#visitRows"),
  openRows: q("#openRows"),
  resourceDialog: q("#resourceDialog"),
  closeResourceDialog: q("#closeResourceDialog"),
  resourceForm: q("#resourceForm"),
  resourceFormTitle: q("#resourceFormTitle"),
  resourceMessage: q("#resourceMessage"),
  deleteResourceButton: q("#deleteResourceButton")
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (state.csrfToken && ["POST", "PUT", "DELETE"].includes(options.method)) {
    headers["X-CSRF-Token"] = state.csrfToken;
  }
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

function showApp(user) {
  els.loginScreen.hidden = true;
  els.adminApp.hidden = false;
  els.adminName.textContent = user.username || "yuanfang";
}

function showLogin() {
  els.loginScreen.hidden = false;
  els.adminApp.hidden = true;
}

async function checkSession() {
  try {
    const user = await api("/api/admin/me");
    state.csrfToken = user.csrfToken;
    showApp(user);
    await refreshAll();
  } catch {
    showLogin();
  }
}

async function refreshAll() {
  await Promise.all([loadStats(), loadResources(), loadVisits(), loadOpens()]);
}

async function loadStats() {
  const data = await api("/api/admin/stats");
  state.stats = data;
  renderStats();
}

async function loadResources() {
  const data = await api("/api/admin/resources");
  state.resources = data.resources || [];
  state.categories = data.categories || [];
  renderResources();
  renderCategories();
  fillCategorySelect();
}

async function loadVisits() {
  const data = await api("/api/admin/visits?limit=160");
  renderVisits(data.visits || []);
}

async function loadOpens() {
  const data = await api("/api/admin/opens?limit=220");
  renderOpens(data.opens || []);
}

function renderStats() {
  const totals = state.stats.totals || {};
  const cards = [
    ["资料总数", totals.resources || 0],
    ["前台展示", totals.activeResources || 0],
    ["今日访客", totals.todayVisits || 0],
    ["今日打开", totals.todayOpens || 0],
    ["累计访客", totals.visits || 0],
    ["累计打开", totals.opens || 0],
    ["分类", totals.categories || 0],
    ["热门地址", (state.stats.topLinks || []).filter((item) => item.count > 0).length]
  ];
  els.statGrid.replaceChildren(
    ...cards.map(([label, value]) => {
      const card = el("article", "stat-card");
      card.append(el("span", "", label), el("strong", "", value));
      return card;
    })
  );

  els.topLinks.replaceChildren(...listOrEmpty(state.stats.topLinks || [], renderTopLink, "暂无打开数据"));
  els.recentOpens.replaceChildren(...listOrEmpty(state.stats.recentOpens || [], renderRecentOpen, "暂无打开记录"));
}

function listOrEmpty(items, renderer, emptyText) {
  if (!items.length) return [el("div", "list-item muted-text", emptyText)];
  return items.map(renderer);
}

function renderTopLink(item) {
  const node = el("div", "list-item");
  node.append(
    el("strong", "", item.resourceTitle),
    el("small", "", `${providerName(item.provider)} · ${item.count} 次打开`)
  );
  return node;
}

function renderRecentOpen(item) {
  const node = el("div", "list-item");
  node.append(
    el("strong", "", item.resourceTitle || "未知资料"),
    el("small", "", `${providerName(item.provider)} · ${formatTime(item.createdAt)} · ${item.ip || ""}`)
  );
  return node;
}

function providerName(provider) {
  if (provider === "quark") return "夸克网盘";
  if (provider === "baidu") return "百度网盘";
  return "网盘";
}

function categoryName(id) {
  const category = state.categories.find((item) => item.id === id);
  return category ? category.name : "未分类";
}

function renderResources() {
  els.resourceRows.replaceChildren(
    ...state.resources.map((resource) => {
      const tr = el("tr");
      const title = el("td", "resource-title-cell");
      title.append(
        el("strong", "", resource.title),
        el("small", "", (resource.tags || []).join(" / ") || "无标签")
      );

      const category = el("td", "", categoryName(resource.categoryId));
      const links = el("td");
      (resource.links || []).forEach((link) => {
        links.append(el("span", `provider-badge ${link.provider}`, providerName(link.provider)));
        links.append(document.createTextNode(" "));
      });

      const status = el("td");
      status.append(el("span", `status-pill ${resource.active === false ? "inactive" : "active"}`, resource.active === false ? "隐藏" : "展示"));

      const actions = el("td");
      const wrap = el("div", "table-actions");
      const edit = el("button", "tiny-button", "编辑");
      edit.type = "button";
      edit.addEventListener("click", () => openResourceDialog(resource));
      wrap.append(edit);
      actions.append(wrap);

      tr.append(title, category, links, status, actions);
      return tr;
    })
  );
}

function renderCategories() {
  els.categoryAdminList.replaceChildren(
    ...state.categories.map((category) => {
      const item = el("div", "category-admin-item");
      const dot = el("span", "category-dot");
      dot.style.background = category.color;
      const copy = el("div");
      copy.append(el("strong", "", category.name), el("small", "", `${category.description || "无说明"} · ${category.count || 0} 个资料`));
      const actions = el("div", "table-actions");
      const edit = el("button", "tiny-button", "编辑");
      const del = el("button", "tiny-button", "删除");
      edit.type = "button";
      del.type = "button";
      edit.addEventListener("click", () => fillCategoryForm(category));
      del.addEventListener("click", () => deleteCategory(category));
      actions.append(edit, del);
      item.append(dot, copy, actions);
      return item;
    })
  );
}

function renderVisits(visits) {
  els.visitRows.replaceChildren(
    ...visits.map((visit) => {
      const tr = el("tr");
      tr.append(
        el("td", "", formatTime(visit.createdAt)),
        el("td", "", visit.ip || ""),
        el("td", "", visit.device || ""),
        el("td", "", visit.browser || ""),
        el("td", "", visit.path || "")
      );
      return tr;
    })
  );
}

function renderOpens(opens) {
  els.openRows.replaceChildren(
    ...opens.map((open) => {
      const tr = el("tr");
      tr.append(
        el("td", "", formatTime(open.createdAt)),
        el("td", "", open.resourceTitle || ""),
        el("td", "", providerName(open.provider)),
        el("td", "", open.ip || ""),
        el("td", "muted-text", open.url || "")
      );
      return tr;
    })
  );
}

function fillCategorySelect() {
  const select = els.resourceForm.elements.categoryId;
  select.replaceChildren(
    ...state.categories.map((category) => {
      const option = el("option", "", category.name);
      option.value = category.id;
      return option;
    })
  );
}

function fillCategoryForm(category) {
  const form = els.categoryForm;
  form.elements.id.value = category.id;
  form.elements.name.value = category.name;
  form.elements.description.value = category.description || "";
  form.elements.color.value = category.color || "#1677ff";
}

function resetCategoryForm() {
  els.categoryForm.reset();
  els.categoryForm.elements.id.value = "";
  els.categoryForm.elements.color.value = "#1677ff";
}

async function saveCategory(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.id.value;
  const body = {
    name: form.elements.name.value,
    description: form.elements.description.value,
    color: form.elements.color.value
  };
  const method = id ? "PUT" : "POST";
  const url = id ? `/api/admin/categories/${id}` : "/api/admin/categories";
  await api(url, { method, body: JSON.stringify(body) });
  resetCategoryForm();
  await loadResources();
  await loadStats();
}

async function deleteCategory(category) {
  if (!confirm(`删除分类「${category.name}」？`)) return;
  await api(`/api/admin/categories/${category.id}`, { method: "DELETE" });
  await loadResources();
  await loadStats();
}

function openResourceDialog(resource) {
  els.resourceMessage.textContent = "";
  els.resourceForm.reset();
  fillCategorySelect();
  els.deleteResourceButton.hidden = !resource;
  els.resourceFormTitle.textContent = resource ? "编辑资料" : "新增资料";

  if (resource) {
    const form = els.resourceForm;
    form.elements.id.value = resource.id;
    form.elements.title.value = resource.title || "";
    form.elements.description.value = resource.description || "";
    form.elements.categoryId.value = resource.categoryId || "";
    form.elements.tags.value = (resource.tags || []).join(", ");
    form.elements.active.checked = resource.active !== false;
    form.elements.pinned.checked = Boolean(resource.pinned);
    const quark = (resource.links || []).find((link) => link.provider === "quark");
    const baidu = (resource.links || []).find((link) => link.provider === "baidu");
    form.elements.quarkUrl.value = quark ? quark.url : "";
    form.elements.quarkCode.value = quark ? quark.code || "" : "";
    form.elements.baiduUrl.value = baidu ? baidu.url : "";
    form.elements.baiduCode.value = baidu ? baidu.code || "" : "";
  } else if (state.categories[0]) {
    els.resourceForm.elements.categoryId.value = state.categories[0].id;
    els.resourceForm.elements.active.checked = true;
  }

  els.resourceDialog.showModal();
}

function collectResourceForm() {
  const form = els.resourceForm;
  const links = [];
  if (form.elements.quarkUrl.value.trim()) {
    links.push({
      provider: "quark",
      label: "夸克网盘",
      url: form.elements.quarkUrl.value.trim(),
      code: form.elements.quarkCode.value.trim()
    });
  }
  if (form.elements.baiduUrl.value.trim()) {
    links.push({
      provider: "baidu",
      label: "百度网盘",
      url: form.elements.baiduUrl.value.trim(),
      code: form.elements.baiduCode.value.trim()
    });
  }
  return {
    title: form.elements.title.value,
    description: form.elements.description.value,
    categoryId: form.elements.categoryId.value,
    tags: form.elements.tags.value,
    active: form.elements.active.checked,
    pinned: form.elements.pinned.checked,
    links
  };
}

async function saveResource(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.id.value;
  const body = collectResourceForm();
  const method = id ? "PUT" : "POST";
  const url = id ? `/api/admin/resources/${id}` : "/api/admin/resources";
  try {
    await api(url, { method, body: JSON.stringify(body) });
    els.resourceDialog.close();
    await Promise.all([loadResources(), loadStats(), loadOpens()]);
  } catch (error) {
    els.resourceMessage.textContent = error.message;
  }
}

async function deleteCurrentResource() {
  const id = els.resourceForm.elements.id.value;
  if (!id) return;
  const resource = state.resources.find((item) => item.id === id);
  if (!confirm(`删除资料「${resource ? resource.title : id}」？`)) return;
  await api(`/api/admin/resources/${id}`, { method: "DELETE" });
  els.resourceDialog.close();
  await Promise.all([loadResources(), loadStats(), loadOpens()]);
}

function switchView(view) {
  state.currentView = view;
  const titles = {
    dashboard: "总览",
    resources: "资料",
    categories: "分类",
    visits: "访客",
    opens: "打开数据"
  };
  els.viewTitle.textContent = titles[view] || "后台";
  qa(".admin-tabs button").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  qa(".admin-view").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === view));
  els.newResourceButton.hidden = view !== "resources" && view !== "dashboard";
}

function bindEvents() {
  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.loginMessage.textContent = "";
    const body = {
      username: els.loginForm.elements.username.value,
      password: els.loginForm.elements.password.value
    };
    try {
      const user = await api("/api/admin/login", { method: "POST", body: JSON.stringify(body) });
      state.csrfToken = user.csrfToken;
      showApp(user);
      await refreshAll();
    } catch (error) {
      els.loginMessage.textContent = error.message;
    }
  });

  els.logoutButton.addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST" });
    state.csrfToken = "";
    showLogin();
  });

  qa(".admin-tabs button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  els.newResourceButton.addEventListener("click", () => openResourceDialog());
  els.newResourceButtonInline.addEventListener("click", () => openResourceDialog());
  els.closeResourceDialog.addEventListener("click", () => els.resourceDialog.close());
  els.resourceForm.addEventListener("submit", saveResource);
  els.deleteResourceButton.addEventListener("click", deleteCurrentResource);
  els.categoryForm.addEventListener("submit", saveCategory);
}

bindEvents();
checkSession();
