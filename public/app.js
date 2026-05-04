const state = {
  categories: [],
  stats: {},
  category: "",
  provider: "",
  q: ""
};

const els = {
  categoryList: document.querySelector("#categoryList"),
  categoryCount: document.querySelector("#categoryCount"),
  resourceGrid: document.querySelector("#resourceGrid"),
  emptyState: document.querySelector("#emptyState"),
  stageTitle: document.querySelector("#stageTitle"),
  miniStats: document.querySelector("#miniStats"),
  keywordInput: document.querySelector("#keywordInput"),
  searchForm: document.querySelector("#searchForm"),
  resourceRequestForm: document.querySelector("#resourceRequestForm"),
  requestCategory: document.querySelector("#requestCategory"),
  requestMessage: document.querySelector("#requestMessage"),
  providerButtons: document.querySelectorAll("[data-provider]")
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("加载失败");
  return res.json();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "提交失败，请稍后再试");
  return data;
}

async function loadSummary() {
  const data = await getJson("/api/public/summary");
  state.categories = data.categories || [];
  state.stats = data.stats || {};
  renderCategories();
  renderStats();
  renderRequestCategories();
}

async function loadResources() {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.category) params.set("category", state.category);
  if (state.provider) params.set("provider", state.provider);
  const data = await getJson(`/api/public/resources?${params.toString()}`);
  renderResources(data.resources || []);
}

function renderStats() {
  const items = [
    ["资料", state.stats.resources || 0],
    ["链接", state.stats.links || 0],
    ["分类", state.stats.categories || 0],
    ["打开", state.stats.opens || 0]
  ];
  els.miniStats.replaceChildren(
    ...items.map(([label, value]) => {
      const box = el("div", "mini-stat");
      box.append(el("span", "", label), el("strong", "", value));
      return box;
    })
  );
}

function renderCategories() {
  const all = { id: "", name: "全部资料", count: state.stats.resources || 0, color: "#14211e" };
  const categories = [all, ...state.categories];
  els.categoryCount.textContent = state.categories.length;
  els.categoryList.replaceChildren(
    ...categories.map((category) => {
      const button = el("button", `category-chip${category.id === state.category ? " is-active" : ""}`);
      button.type = "button";
      button.dataset.category = category.id;
      const dot = el("span", "category-dot");
      dot.style.background = category.color;
      const copy = el("span");
      copy.append(el("strong", "", category.name), el("small", "", category.description || "所有可见资源"));
      button.append(dot, copy, el("small", "", category.count || 0));
      return button;
    })
  );
}

function renderRequestCategories() {
  if (!els.requestCategory) return;
  const options = [
    { id: "", name: "不确定 / 其他" },
    ...state.categories
  ];
  els.requestCategory.replaceChildren(
    ...options.map((category) => {
      const option = el("option", "", category.name);
      option.value = category.id;
      return option;
    })
  );
}

function providerName(provider) {
  if (provider === "quark") return "夸克";
  if (provider === "baidu") return "百度";
  return "网盘";
}

function renderResources(resources) {
  const selected = state.categories.find((item) => item.id === state.category);
  els.stageTitle.textContent = selected ? selected.name : "全部资料";
  els.emptyState.hidden = resources.length > 0;
  els.resourceGrid.replaceChildren(...resources.map(renderCard));
}

function renderCard(resource) {
  const card = el("article", "resource-card");
  const top = el("div", "card-top");
  const titleWrap = el("div");
  titleWrap.append(el("h3", "", resource.title));
  const badge = el("span", "category-badge", resource.categoryName);
  badge.style.background = resource.categoryColor;
  top.append(titleWrap, badge);

  const desc = el("p", "", resource.description || "暂无简介");
  const tags = el("div", "tag-row");
  (resource.tags || []).forEach((tag) => tags.append(el("span", "tag", tag)));

  const links = el("div", "link-row");
  (resource.links || []).forEach((link) => {
    const a = el("a", `open-link ${link.provider}`, `${providerName(link.provider)}打开`);
    a.href = link.openUrl;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.title = link.code ? `提取码：${link.code}` : link.label;
    links.append(a);
  });

  const foot = el("div", "card-foot");
  const date = formatDate(resource.createdAt);
  foot.append(
    el("span", "", resource.pinned ? "置顶资料" : `更新 ${date}`),
    el("span", "", `${resource.openCount || 0} 次打开`)
  );

  card.append(top, desc, tags, links, foot);
  return card;
}

function bindEvents() {
  els.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.q = els.keywordInput.value.trim();
    loadResources();
  });

  els.keywordInput.addEventListener("input", () => {
    window.clearTimeout(els.keywordInput.timer);
    els.keywordInput.timer = window.setTimeout(() => {
      state.q = els.keywordInput.value.trim();
      loadResources();
    }, 240);
  });

  els.providerButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.provider = button.dataset.provider;
      els.providerButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      loadResources();
    });
  });

  els.categoryList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    renderCategories();
    loadResources();
  });

  els.resourceRequestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.requestMessage.textContent = "";
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await postJson("/api/public/requests", {
        title: form.elements.title.value,
        categoryId: form.elements.categoryId.value,
        description: form.elements.description.value,
        contact: form.elements.contact.value,
        urgency: form.elements.urgency.value
      });
      form.reset();
      renderRequestCategories();
      els.requestMessage.textContent = "已提交，我会在后台看到这条需求。";
      els.requestMessage.classList.add("is-success");
    } catch (error) {
      els.requestMessage.textContent = error.message;
      els.requestMessage.classList.remove("is-success");
    } finally {
      submit.disabled = false;
    }
  });
}

async function init() {
  bindEvents();
  try {
    await loadSummary();
    await loadResources();
  } catch (error) {
    els.resourceGrid.replaceChildren();
    els.emptyState.hidden = false;
    els.emptyState.querySelector("strong").textContent = "加载失败";
  }
}

init();
