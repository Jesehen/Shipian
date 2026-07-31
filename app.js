import {
  clearSyncedAttachmentCache,
  deleteAttachment,
  deleteEntry,
  estimateLocalUsage,
  exportDatabase,
  getAllEntries,
  getAttachment,
  getEntry,
  getMeta,
  importDatabase,
  saveAttachment,
  saveEntry,
  setMeta
} from "./db.js";
import {
  CATEGORIES,
  classifyContent,
  deriveTitle,
  detectDate,
  extractUrl,
  formatCategory
} from "./classifier.js";
import { GitHubSync } from "./github-sync.js";

const MAX_CACHE_BYTES = 50 * 1024 * 1024;
const PAGE_SIZE = 30;
const state = {
  entries: [],
  view: "today",
  category: "all",
  sort: "newest",
  visibleCount: PAGE_SIZE,
  selectedEntryId: null,
  selectedCategory: "note",
  manualCategory: false,
  suggestedReminder: null,
  pendingAttachment: null,
  pendingAttachmentUrl: null,
  objectUrls: [],
  rediscoverOffset: 0,
  github: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const elements = {
  pageTitle: $("#pageTitle"),
  pageEyebrow: $("#pageEyebrow"),
  storageButton: $("#storageButton"),
  heroCaptureButton: $("#heroCaptureButton"),
  navAddButton: $("#navAddButton"),
  captureDialog: $("#captureDialog"),
  captureForm: $("#captureForm"),
  captureTitle: $("#captureTitle"),
  editingEntryId: $("#editingEntryId"),
  captureContent: $("#captureContent"),
  captureCustomTitle: $("#captureCustomTitle"),
  captureTags: $("#captureTags"),
  captureReminder: $("#captureReminder"),
  captureRecurrence: $("#captureRecurrence"),
  captureImage: $("#captureImage"),
  attachmentPreview: $("#attachmentPreview"),
  removeAttachmentButton: $("#removeAttachmentButton"),
  detectedCategory: $("#detectedCategory"),
  detectedReminderButton: $("#detectedReminderButton"),
  categoryPicker: $("#categoryPicker"),
  recentEntries: $("#recentEntries"),
  todayReminders: $("#todayReminders"),
  rediscoverEntry: $("#rediscoverEntry"),
  shuffleButton: $("#shuffleButton"),
  categoryFilters: $("#categoryFilters"),
  libraryEntries: $("#libraryEntries"),
  libraryCount: $("#libraryCount"),
  sortSelect: $("#sortSelect"),
  loadMoreButton: $("#loadMoreButton"),
  remindersToday: $("#remindersToday"),
  remindersUpcoming: $("#remindersUpcoming"),
  remindersDone: $("#remindersDone"),
  reminderTodayCount: $("#reminderTodayCount"),
  reminderUpcomingCount: $("#reminderUpcomingCount"),
  reminderDoneCount: $("#reminderDoneCount"),
  clearCompletedButton: $("#clearCompletedButton"),
  searchInput: $("#searchInput"),
  searchTips: $("#searchTips"),
  searchResults: $("#searchResults"),
  detailDialog: $("#detailDialog"),
  detailContent: $("#detailContent"),
  editEntryButton: $("#editEntryButton"),
  infoDialog: $("#infoDialog"),
  infoIcon: $("#infoIcon"),
  infoTitle: $("#infoTitle"),
  infoBody: $("#infoBody"),
  infoConfirmButton: $("#infoConfirmButton"),
  toast: $("#toast"),
  githubForm: $("#githubForm"),
  githubOwner: $("#githubOwner"),
  githubRepo: $("#githubRepo"),
  githubBranch: $("#githubBranch"),
  githubToken: $("#githubToken"),
  githubPassphrase: $("#githubPassphrase"),
  testGithubButton: $("#testGithubButton"),
  syncGithubButton: $("#syncGithubButton"),
  restoreGithubButton: $("#restoreGithubButton"),
  syncStatus: $("#syncStatus"),
  storageUsageLabel: $("#storageUsageLabel"),
  storageMeterFill: $("#storageMeterFill"),
  clearSyncedImagesButton: $("#clearSyncedImagesButton"),
  exportButton: $("#exportButton"),
  importInput: $("#importInput"),
  installGuideButton: $("#installGuideButton"),
  shortcutGuideButton: $("#shortcutGuideButton")
};

const VIEW_COPY = {
  today: ["拾片", "轻量 · 私密 · 可靠"],
  library: ["全部片段", "自动整理，无需归档"],
  reminders: ["提醒", "内容与时间在一起"],
  search: ["搜索", "找回生活中的每一片"],
  settings: ["设置", "数据由你掌控"]
};

function escapeHtml(value = "") {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function randomId() {
  return crypto.randomUUID?.() ?? `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDateTime(value, options = {}) {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (isSameDay(date, today)) return options.dateOnly ? "今天" : `今天 ${time}`;
  if (isSameDay(date, tomorrow)) return options.dateOnly ? "明天" : `明天 ${time}`;
  return date.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: options.dateOnly ? undefined : "2-digit",
    minute: options.dateOnly ? undefined : "2-digit"
  });
}

function relativeTime(value) {
  const delta = Date.now() - new Date(value).getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return "刚刚";
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`;
  return new Date(value).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function toDatetimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function revokeObjectUrls() {
  state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.objectUrls = [];
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function showInfo(title, html, icon = "✓") {
  elements.infoTitle.textContent = title;
  elements.infoBody.innerHTML = html;
  elements.infoIcon.textContent = icon;
  elements.infoDialog.showModal();
}

function emptyState(title, copy) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(copy)}</div>`;
}

function setView(view) {
  state.view = view;
  $$(".view").forEach((section) => section.classList.toggle("active", section.dataset.view === view));
  $$(".nav-item").forEach((button) =>
    button.classList.toggle("active", button.dataset.target === view)
  );
  const [title, eyebrow] = VIEW_COPY[view];
  elements.pageTitle.textContent = title;
  elements.pageEyebrow.textContent = eyebrow;
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (view === "search") setTimeout(() => elements.searchInput.focus(), 100);
  if (view === "settings") refreshStorageUsage();
  history.replaceState(null, "", `?view=${view}`);
}

function categoryBadge(entry) {
  const category = formatCategory(entry.category);
  return `<span class="category-badge ${entry.category}">${category.label}</span>`;
}

async function hydrateThumbnails(root) {
  const targets = $$("[data-thumb-id]", root);
  await Promise.all(
    targets.map(async (target) => {
      const attachment = await getAttachment(target.dataset.thumbId);
      if (!attachment?.blob) return;
      const url = URL.createObjectURL(attachment.blob);
      state.objectUrls.push(url);
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      target.replaceChildren(img);
    })
  );
}

function entryCard(entry) {
  const category = formatCategory(entry.category);
  const hasLocalImage = entry.hasAttachment;
  return `
    <button class="entry-card" data-entry-id="${entry.id}">
      <span class="entry-thumb" ${hasLocalImage ? `data-thumb-id="${entry.id}"` : ""}>${category.glyph}</span>
      <span class="entry-main">
        <strong>${escapeHtml(entry.title)}</strong>
        <p>${escapeHtml(entry.content)}</p>
        <span class="entry-meta">
          ${categoryBadge(entry)}
          <span>${relativeTime(entry.createdAt)}</span>
          ${entry.reminderAt ? `<span>⏰ ${formatDateTime(entry.reminderAt)}</span>` : ""}
          ${entry.syncStatus === "synced" ? "<span>已同步</span>" : ""}
        </span>
      </span>
      <span class="entry-arrow">›</span>
    </button>
  `;
}

function reminderRow(entry) {
  const done = Boolean(entry.completedAt);
  const recurrence = {
    daily: "每天",
    weekly: "每周",
    monthly: "每月"
  }[entry.recurrence];
  return `
    <div class="reminder-row">
      <button class="reminder-check ${done ? "done" : ""}" data-complete-id="${entry.id}" aria-label="${done ? "恢复提醒" : "完成提醒"}"></button>
      <button class="reminder-copy text-button" data-entry-id="${entry.id}">
        <strong>${escapeHtml(entry.title)}</strong>
        <small>${categoryBadge(entry)} ${recurrence ? `· ${recurrence}` : ""}</small>
      </button>
      <span class="reminder-time">${formatDateTime(entry.reminderAt)}</span>
    </div>
  `;
}

function getSortedEntries(entries = state.entries) {
  const copy = [...entries];
  if (state.sort === "oldest") return copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (state.sort === "reminder") {
    return copy.sort((a, b) => {
      if (!a.reminderAt) return 1;
      if (!b.reminderAt) return -1;
      return a.reminderAt.localeCompare(b.reminderAt);
    });
  }
  return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function renderToday() {
  const now = new Date();
  const todayReminders = state.entries
    .filter(
      (entry) =>
        entry.reminderAt && !entry.completedAt && isSameDay(new Date(entry.reminderAt), now)
    )
    .sort((a, b) => a.reminderAt.localeCompare(b.reminderAt));
  elements.todayReminders.innerHTML = todayReminders.length
    ? todayReminders.slice(0, 4).map(reminderRow).join("")
    : emptyState("今天很轻松", "日常内容设置提醒后，会自动出现在这里。");

  const recent = getSortedEntries().slice(0, 5);
  elements.recentEntries.innerHTML = recent.length
    ? recent.map(entryCard).join("")
    : emptyState("还没有片段", "点击下方的加号，留下第一条生活碎片。");

  const rediscoverable = state.entries
    .filter((entry) => Date.now() - new Date(entry.createdAt).getTime() > 3 * 86400000)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  if (!rediscoverable.length) {
    elements.rediscoverEntry.innerHTML = emptyState(
      "过几天再回来看看",
      "拾片会在合适的时候，让旧收藏重新出现。"
    );
  } else {
    const entry = rediscoverable[state.rediscoverOffset % rediscoverable.length];
    elements.rediscoverEntry.innerHTML = `
      <button class="rediscover-card" data-entry-id="${entry.id}">
        <span class="quote-mark">“</span>
        <h3>${escapeHtml(entry.title)}</h3>
        <p>${escapeHtml(entry.content)}</p>
      </button>
    `;
  }
  await hydrateThumbnails(elements.recentEntries);
}

async function renderLibrary() {
  revokeObjectUrls();
  const filtered =
    state.category === "all"
      ? state.entries
      : state.entries.filter((entry) => entry.category === state.category);
  const sorted = getSortedEntries(filtered);
  const visible = sorted.slice(0, state.visibleCount);
  elements.libraryCount.textContent = `${sorted.length} 个片段`;
  elements.libraryEntries.innerHTML = visible.length
    ? visible.map(entryCard).join("")
    : emptyState("这里还没有内容", "保存内容后，拾片会自动放入合适的分类。");
  elements.loadMoreButton.classList.toggle("hidden", visible.length >= sorted.length);
  await hydrateThumbnails(elements.libraryEntries);
}

function renderReminders() {
  const nowStart = startOfToday();
  const todayEnd = endOfToday();
  const active = state.entries.filter((entry) => entry.reminderAt && !entry.completedAt);
  const today = active
    .filter((entry) => {
      const date = new Date(entry.reminderAt);
      return date >= nowStart && date <= todayEnd;
    })
    .sort((a, b) => a.reminderAt.localeCompare(b.reminderAt));
  const upcoming = active
    .filter((entry) => new Date(entry.reminderAt) > todayEnd)
    .sort((a, b) => a.reminderAt.localeCompare(b.reminderAt));
  const overdue = active
    .filter((entry) => new Date(entry.reminderAt) < nowStart)
    .sort((a, b) => a.reminderAt.localeCompare(b.reminderAt));
  const done = state.entries
    .filter((entry) => entry.reminderAt && entry.completedAt)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const todayCombined = [...overdue, ...today];

  elements.remindersToday.innerHTML = todayCombined.length
    ? todayCombined.map(reminderRow).join("")
    : emptyState("今天没有提醒", "给任意片段添加时间，它就会出现在这里。");
  elements.remindersUpcoming.innerHTML = upcoming.length
    ? upcoming.map(reminderRow).join("")
    : emptyState("暂时没有安排", "未来的提醒会按时间排列。");
  elements.remindersDone.innerHTML = done.length
    ? done.slice(0, 20).map(reminderRow).join("")
    : emptyState("还没有完成记录", "完成的提醒会暂时保留在这里。");

  elements.reminderTodayCount.textContent = todayCombined.length;
  elements.reminderUpcomingCount.textContent = upcoming.length;
  elements.reminderDoneCount.textContent = done.length;
}

async function renderSearch() {
  revokeObjectUrls();
  const query = elements.searchInput.value.trim().toLowerCase();
  if (!query) {
    elements.searchResults.innerHTML = "";
    elements.searchTips.classList.remove("hidden");
    return;
  }
  elements.searchTips.classList.add("hidden");
  let results;
  if (query === "本周提醒") {
    const week = new Date();
    week.setDate(week.getDate() + 7);
    results = state.entries.filter(
      (entry) =>
        entry.reminderAt &&
        !entry.completedAt &&
        new Date(entry.reminderAt) >= new Date() &&
        new Date(entry.reminderAt) <= week
    );
  } else {
    results = state.entries.filter((entry) => {
      const haystack = [
        entry.title,
        entry.content,
        ...(entry.tags || []),
        formatCategory(entry.category).label
      ]
        .join(" ")
        .toLowerCase();
      return query
        .split(/\s+/)
        .filter(Boolean)
        .every((word) => haystack.includes(word));
    });
  }
  elements.searchResults.innerHTML = results.length
    ? getSortedEntries(results).map(entryCard).join("")
    : emptyState("没有找到", "换一个关键词，或减少搜索条件试试。");
  await hydrateThumbnails(elements.searchResults);
}

async function renderAll() {
  await renderToday();
  await renderLibrary();
  renderReminders();
  if (elements.searchInput.value) await renderSearch();
  await refreshStorageUsage();
}

function chooseCategory(category, manual = true) {
  state.selectedCategory = category;
  state.manualCategory = manual;
  const meta = formatCategory(category);
  elements.detectedCategory.textContent = meta.label;
  elements.detectedCategory.className = `category-badge ${category}`;
  $$("[data-category]", elements.categoryPicker).forEach((button) =>
    button.classList.toggle("active", button.dataset.category === category)
  );
}

function showAutoCategory() {
  state.selectedCategory = "note";
  elements.detectedCategory.textContent = "自动判断";
  elements.detectedCategory.className = "category-badge auto";
  elements.categoryPicker.querySelectorAll("[data-category]").forEach((button) =>
    button.classList.remove("active")
  );
}

function analyzeCaptureText() {
  const text = elements.captureContent.value;
  if (!text.trim() && !state.manualCategory) {
    showAutoCategory();
  } else if (!state.manualCategory) {
    chooseCategory(classifyContent(text).category, false);
  }
  const detected = detectDate(text);
  state.suggestedReminder = detected;
  if (detected && !elements.captureReminder.value) {
    elements.detectedReminderButton.textContent = `⏰ 设为 ${formatDateTime(detected.date)}`;
    elements.detectedReminderButton.classList.remove("hidden");
  } else {
    elements.detectedReminderButton.classList.add("hidden");
  }
}

function clearPendingAttachment() {
  if (state.pendingAttachmentUrl) URL.revokeObjectURL(state.pendingAttachmentUrl);
  state.pendingAttachment = null;
  state.pendingAttachmentUrl = null;
  elements.captureImage.value = "";
  elements.attachmentPreview.classList.add("hidden");
  $("img", elements.attachmentPreview).removeAttribute("src");
}

async function openCapture(entry = null) {
  elements.captureForm.reset();
  clearPendingAttachment();
  state.manualCategory = false;
  state.suggestedReminder = null;
  elements.editingEntryId.value = entry?.id || "";
  elements.captureTitle.textContent = entry ? "编辑片段" : "保存片段";
  elements.captureContent.value = entry?.content || "";
  elements.captureCustomTitle.value = entry?.customTitle || "";
  elements.captureTags.value = (entry?.tags || []).join(" ");
  elements.captureReminder.value = toDatetimeLocal(entry?.reminderAt);
  elements.captureRecurrence.value = entry?.recurrence || "none";
  chooseCategory(entry?.category || "note", Boolean(entry));

  if (entry?.hasAttachment) {
    const attachment = await getAttachment(entry.id);
    if (attachment?.blob) {
      state.pendingAttachment = attachment.blob;
      state.pendingAttachmentUrl = URL.createObjectURL(attachment.blob);
      $("img", elements.attachmentPreview).src = state.pendingAttachmentUrl;
      elements.attachmentPreview.classList.remove("hidden");
    }
  }
  analyzeCaptureText();
  if (elements.detailDialog.open) elements.detailDialog.close();
  elements.captureDialog.showModal();
  setTimeout(() => elements.captureContent.focus(), 120);
}

async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("图片压缩失败"))),
        "image/webp",
        0.78
      );
    });
  } finally {
    bitmap.close();
  }
}

async function handleImageSelection() {
  const file = elements.captureImage.files?.[0];
  if (!file) return;
  try {
    showToast("正在轻量压缩图片…");
    const blob = await compressImage(file);
    const usage = await estimateLocalUsage();
    const replacingSize = state.pendingAttachment?.size || 0;
    if (usage.totalBytes - replacingSize + blob.size > MAX_CACHE_BYTES) {
      throw new Error("加入图片后会超过 50MB，请先同步并清理已同步图片");
    }
    clearPendingAttachment();
    state.pendingAttachment = blob;
    state.pendingAttachmentUrl = URL.createObjectURL(blob);
    $("img", elements.attachmentPreview).src = state.pendingAttachmentUrl;
    elements.attachmentPreview.classList.remove("hidden");
    showToast(`图片已压缩至 ${formatBytes(blob.size)}`);
  } catch (error) {
    elements.captureImage.value = "";
    showInfo("无法添加图片", `<p>${escapeHtml(error.message)}</p>`, "!");
  }
}

async function handleCaptureSubmit(event) {
  event.preventDefault();
  const content = elements.captureContent.value.trim();
  if (!content) return;
  const id = elements.editingEntryId.value || randomId();
  const existing = elements.editingEntryId.value ? await getEntry(id) : null;
  const now = new Date().toISOString();
  const customTitle = elements.captureCustomTitle.value.trim();
  const reminderAt = elements.captureReminder.value
    ? new Date(elements.captureReminder.value).toISOString()
    : null;
  const entry = {
    ...(existing || {}),
    id,
    title: deriveTitle(content, customTitle),
    customTitle,
    content,
    url: extractUrl(content),
    category: state.selectedCategory,
    tags: elements.captureTags.value.split(/\s+/).filter(Boolean).slice(0, 12),
    reminderAt,
    recurrence: reminderAt ? elements.captureRecurrence.value : "none",
    completedAt: reminderAt === existing?.reminderAt ? existing?.completedAt || null : null,
    hasAttachment: Boolean(state.pendingAttachment),
    attachmentType: state.pendingAttachment?.type || existing?.attachmentType || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    syncStatus: "pending"
  };
  await saveEntry(entry);
  if (state.pendingAttachment) await saveAttachment(id, state.pendingAttachment);
  else if (existing?.hasAttachment) await deleteAttachment(id);
  elements.captureDialog.close();
  clearPendingAttachment();
  await reloadEntries();
  showToast(existing ? "已更新" : "已经收好并自动归类");
}

function nextRecurringDate(value, recurrence) {
  const date = new Date(value);
  if (recurrence === "daily") date.setDate(date.getDate() + 1);
  if (recurrence === "weekly") date.setDate(date.getDate() + 7);
  if (recurrence === "monthly") date.setMonth(date.getMonth() + 1);
  return date.toISOString();
}

async function toggleReminderComplete(id) {
  const entry = await getEntry(id);
  if (!entry) return;
  if (!entry.completedAt && entry.recurrence && entry.recurrence !== "none") {
    entry.reminderAt = nextRecurringDate(entry.reminderAt, entry.recurrence);
    entry.completedAt = null;
    showToast(`已完成，下次提醒：${formatDateTime(entry.reminderAt)}`);
  } else {
    entry.completedAt = entry.completedAt ? null : new Date().toISOString();
  }
  entry.updatedAt = new Date().toISOString();
  entry.syncStatus = "pending";
  await saveEntry(entry);
  await reloadEntries();
}

async function openEntryDetail(id) {
  const entry = await getEntry(id);
  if (!entry) return;
  state.selectedEntryId = id;
  const category = formatCategory(entry.category);
  elements.detailContent.innerHTML = `
    <div class="detail-body">
      <div class="detail-category-line">
        ${categoryBadge(entry)}
        <span class="entry-meta">${relativeTime(entry.createdAt)} ${entry.syncStatus === "synced" ? "· 已加密同步" : "· 待同步"}</span>
      </div>
      <h2>${escapeHtml(entry.title)}</h2>
      <p class="content-text">${escapeHtml(entry.content)}</p>
      <div id="detailImageSlot"></div>
      ${
        entry.tags?.length
          ? `<div class="detail-tags">${entry.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>`
          : ""
      }
      ${
        entry.reminderAt
          ? `<div class="detail-reminder">⏰ ${formatDateTime(entry.reminderAt)} ${
              entry.recurrence !== "none"
                ? `· ${{ daily: "每天", weekly: "每周", monthly: "每月" }[entry.recurrence]}`
                : ""
            }</div>`
          : ""
      }
      <div class="detail-actions">
        ${
          entry.reminderAt
            ? '<button class="secondary-button" id="systemReminderButton">加入系统提醒</button>'
            : '<button class="secondary-button" id="addReminderFromDetail">添加提醒</button>'
        }
        ${
          entry.reminderAt
            ? '<button class="secondary-button" id="calendarButton">导出日历提醒</button>'
            : '<button class="secondary-button" id="copyEntryButton">复制内容</button>'
        }
        <button class="danger-button" id="deleteEntryButton">删除片段</button>
      </div>
    </div>
  `;

  const attachment = await getAttachment(id);
  const slot = $("#detailImageSlot");
  if (attachment?.blob) {
    const url = URL.createObjectURL(attachment.blob);
    state.objectUrls.push(url);
    const img = document.createElement("img");
    img.className = "detail-image";
    img.src = url;
    img.alt = entry.title;
    slot.append(img);
  } else if (entry.remoteAttachmentPath) {
    slot.innerHTML =
      '<button class="secondary-button full load-more" id="restoreImageButton">从 GitHub 恢复图片</button>';
    $("#restoreImageButton").addEventListener("click", () => restoreRemoteImage(entry));
  }

  $("#deleteEntryButton").addEventListener("click", () => removeEntry(entry));
  $("#systemReminderButton")?.addEventListener("click", () => runSystemReminder(entry));
  $("#calendarButton")?.addEventListener("click", () => downloadCalendar(entry));
  $("#addReminderFromDetail")?.addEventListener("click", () => openCapture(entry));
  $("#copyEntryButton")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(entry.content);
    showToast("内容已复制");
  });
  elements.detailDialog.showModal();
}

async function removeEntry(entry) {
  if (!confirm(`确定删除“${entry.title}”吗？GitHub 历史中的旧版本不会自动清除。`)) return;
  await deleteEntry(entry.id);
  elements.detailDialog.close();
  await reloadEntries();
  showToast("已从本机删除");
}

function runSystemReminder(entry) {
  if (!entry.reminderAt) return;
  const payload = JSON.stringify({
    id: entry.id,
    title: entry.title,
    date: entry.reminderAt,
    url: `${location.origin}${location.pathname}?entry=${entry.id}`
  });
  location.href = `shortcuts://run-shortcut?name=${encodeURIComponent("拾片提醒")}&input=text&text=${encodeURIComponent(payload)}`;
}

function icsDate(value) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function icsEscape(value) {
  return value.replaceAll("\\", "\\\\").replaceAll(",", "\\,").replaceAll(";", "\\;").replaceAll("\n", "\\n");
}

function downloadCalendar(entry) {
  const start = new Date(entry.reminderAt);
  const end = new Date(start.getTime() + 30 * 60_000);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//拾片//Reminder//ZH",
    "BEGIN:VEVENT",
    `UID:${entry.id}@shipian`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(entry.title)}`,
    `DESCRIPTION:${icsEscape(entry.content)}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
  downloadBlob(new Blob([ics], { type: "text/calendar;charset=utf-8" }), `${entry.title}.ics`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function reloadEntries() {
  state.entries = await getAllEntries();
  await renderAll();
}

async function refreshStorageUsage() {
  const usage = await estimateLocalUsage();
  const percent = Math.min(100, (usage.totalBytes / MAX_CACHE_BYTES) * 100);
  elements.storageUsageLabel.textContent = `${formatBytes(usage.totalBytes)} · ${usage.entryCount} 条内容`;
  elements.storageMeterFill.style.width = `${percent}%`;
}

function githubClientFromForm() {
  const config = {
    owner: elements.githubOwner.value,
    repo: elements.githubRepo.value,
    branch: elements.githubBranch.value,
    token: elements.githubToken.value || sessionStorage.getItem("shipian-github-token") || "",
    passphrase:
      elements.githubPassphrase.value || sessionStorage.getItem("shipian-github-passphrase") || ""
  };
  state.github = new GitHubSync(config);
  return state.github;
}

async function saveGithubPreferences() {
  const safe = {
    owner: elements.githubOwner.value.trim(),
    repo: elements.githubRepo.value.trim(),
    branch: elements.githubBranch.value.trim() || "main"
  };
  await setMeta("github-config", safe);
  if (elements.githubToken.value) sessionStorage.setItem("shipian-github-token", elements.githubToken.value);
  if (elements.githubPassphrase.value) {
    sessionStorage.setItem("shipian-github-passphrase", elements.githubPassphrase.value);
  }
}

async function testGithubConnection() {
  try {
    elements.syncStatus.textContent = "正在连接…";
    await saveGithubPreferences();
    const result = await githubClientFromForm().testConnection();
    if (!result.private) {
      showInfo("仓库不是私人的", "<p>为了保护生活数据，请先把数据仓库设置为 Private，再进行同步。</p>", "!");
    }
    elements.syncStatus.textContent = `已连接 ${result.repository} · ${result.branch}`;
    showToast("GitHub 连接成功");
  } catch (error) {
    elements.syncStatus.textContent = error.message;
    showInfo("连接失败", `<p>${escapeHtml(error.message)}</p>`, "!");
  }
}

async function syncToGithub() {
  try {
    await saveGithubPreferences();
    const client = githubClientFromForm();
    const test = await client.testConnection();
    if (!test.private && !confirm("这个仓库不是 Private。确定仍要上传吗？")) return;
    const pending = getSortedEntries(
      state.entries.filter((entry) => entry.syncStatus !== "synced")
    ).reverse();
    if (!pending.length) {
      elements.syncStatus.textContent = "所有内容均已同步";
      showToast("已经是最新状态");
      return;
    }
    elements.syncGithubButton.disabled = true;
    for (let index = 0; index < pending.length; index += 1) {
      const entry = pending[index];
      elements.syncStatus.textContent = `正在加密同步 ${index + 1}/${pending.length}：${entry.title}`;
      const attachment = await getAttachment(entry.id);
      const synced = await client.uploadEntry(entry, attachment);
      await saveEntry(synced);
    }
    elements.syncStatus.textContent = `同步完成 · ${new Date().toLocaleTimeString("zh-CN")}`;
    await reloadEntries();
    showToast("已加密同步到 GitHub");
  } catch (error) {
    elements.syncStatus.textContent = error.message;
    showInfo("同步失败", `<p>${escapeHtml(error.message)}</p>`, "!");
  } finally {
    elements.syncGithubButton.disabled = false;
  }
}

async function restoreFromGithub() {
  try {
    await saveGithubPreferences();
    const client = githubClientFromForm();
    await client.testConnection();
    elements.restoreGithubButton.disabled = true;
    const remoteEntries = await client.downloadAllEntries((current, total) => {
      elements.syncStatus.textContent = `正在解密恢复 ${current}/${total}`;
    });
    const localById = new Map(state.entries.map((entry) => [entry.id, entry]));
    let restored = 0;
    for (const remote of remoteEntries) {
      const local = localById.get(remote.id);
      if (!local || new Date(remote.updatedAt) > new Date(local.updatedAt)) {
        await saveEntry(remote);
        restored += 1;
      }
    }
    elements.syncStatus.textContent = `恢复完成 · 找到 ${remoteEntries.length} 条，更新 ${restored} 条`;
    await reloadEntries();
    showToast(`已恢复 ${restored} 条较新内容`);
  } catch (error) {
    elements.syncStatus.textContent = error.message;
    showInfo("恢复失败", `<p>${escapeHtml(error.message)}</p>`, "!");
  } finally {
    elements.restoreGithubButton.disabled = false;
  }
}

async function restoreRemoteImage(entry) {
  try {
    const client = githubClientFromForm();
    showToast("正在从 GitHub 解密图片…");
    const bytes = await client.downloadAttachment(entry.remoteAttachmentPath);
    const blob = new Blob([bytes], { type: entry.attachmentType || "image/webp" });
    const usage = await estimateLocalUsage();
    if (usage.totalBytes + blob.size > MAX_CACHE_BYTES) {
      throw new Error("恢复图片后会超过 50MB，请先清理其他已同步图片");
    }
    await saveAttachment(entry.id, blob);
    elements.detailDialog.close();
    await openEntryDetail(entry.id);
    await refreshStorageUsage();
  } catch (error) {
    showInfo("恢复失败", `<p>${escapeHtml(error.message)}</p>`, "!");
  }
}

async function exportBackup() {
  try {
    showToast("正在生成备份…");
    const payload = await exportDatabase();
    downloadBlob(
      new Blob([JSON.stringify(payload)], { type: "application/json" }),
      `拾片备份-${new Date().toISOString().slice(0, 10)}.json`
    );
  } catch (error) {
    showInfo("导出失败", `<p>${escapeHtml(error.message)}</p>`, "!");
  }
}

async function handleImport() {
  const file = elements.importInput.files?.[0];
  if (!file) return;
  try {
    const imported = await importDatabase(JSON.parse(await file.text()));
    await reloadEntries();
    showToast(`已导入 ${imported} 条较新的内容`);
  } catch (error) {
    showInfo("导入失败", `<p>${escapeHtml(error.message)}</p>`, "!");
  } finally {
    elements.importInput.value = "";
  }
}

async function clearCompletedReminders() {
  const done = state.entries.filter((entry) => entry.completedAt);
  if (!done.length) return;
  if (!confirm(`清除 ${done.length} 条已完成提醒的“提醒时间”？内容本身会保留。`)) return;
  for (const entry of done) {
    await saveEntry({
      ...entry,
      reminderAt: null,
      recurrence: "none",
      completedAt: null,
      updatedAt: new Date().toISOString(),
      syncStatus: "pending"
    });
  }
  await reloadEntries();
}

function bindEvents() {
  elements.heroCaptureButton.addEventListener("click", () => openCapture());
  elements.navAddButton.addEventListener("click", () => openCapture());
  elements.storageButton.addEventListener("click", () => setView("settings"));
  $$(".nav-item").forEach((button) =>
    button.addEventListener("click", () => setView(button.dataset.target))
  );
  $$("[data-go]").forEach((button) =>
    button.addEventListener("click", () => setView(button.dataset.go))
  );
  $$("[data-close-dialog]").forEach((button) =>
    button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close())
  );
  elements.infoConfirmButton.addEventListener("click", () => elements.infoDialog.close());
  elements.captureContent.addEventListener("input", analyzeCaptureText);
  elements.captureForm.addEventListener("submit", handleCaptureSubmit);
  elements.captureImage.addEventListener("change", handleImageSelection);
  elements.removeAttachmentButton.addEventListener("click", clearPendingAttachment);
  elements.detectedReminderButton.addEventListener("click", () => {
    if (!state.suggestedReminder) return;
    elements.captureReminder.value = toDatetimeLocal(state.suggestedReminder.date);
    elements.detectedReminderButton.classList.add("hidden");
  });
  $$("[data-category]", elements.categoryPicker).forEach((button) =>
    button.addEventListener("click", () => chooseCategory(button.dataset.category))
  );
  elements.categoryFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    state.visibleCount = PAGE_SIZE;
    $$("[data-category]", elements.categoryFilters).forEach((chip) =>
      chip.classList.toggle("active", chip === button)
    );
    renderLibrary();
  });
  elements.sortSelect.addEventListener("change", () => {
    state.sort = elements.sortSelect.value;
    renderLibrary();
  });
  elements.loadMoreButton.addEventListener("click", () => {
    state.visibleCount += PAGE_SIZE;
    renderLibrary();
  });
  elements.shuffleButton.addEventListener("click", () => {
    state.rediscoverOffset += 1;
    renderToday();
  });
  elements.searchInput.addEventListener("input", renderSearch);
  elements.searchTips.addEventListener("click", (event) => {
    const button = event.target.closest("[data-search]");
    if (!button) return;
    elements.searchInput.value = button.dataset.search;
    renderSearch();
  });
  $("#mainContent").addEventListener("click", (event) => {
    const entryTarget = event.target.closest("[data-entry-id]");
    if (entryTarget) openEntryDetail(entryTarget.dataset.entryId);
    const completeTarget = event.target.closest("[data-complete-id]");
    if (completeTarget) {
      event.preventDefault();
      event.stopPropagation();
      toggleReminderComplete(completeTarget.dataset.completeId);
    }
  });
  elements.editEntryButton.addEventListener("click", async () => {
    const entry = await getEntry(state.selectedEntryId);
    if (entry) openCapture(entry);
  });
  elements.detailDialog.addEventListener("close", revokeObjectUrls);
  elements.captureDialog.addEventListener("close", () => {
    if (!elements.editingEntryId.value) clearPendingAttachment();
  });
  elements.clearCompletedButton.addEventListener("click", clearCompletedReminders);
  elements.testGithubButton.addEventListener("click", testGithubConnection);
  elements.syncGithubButton.addEventListener("click", syncToGithub);
  elements.restoreGithubButton.addEventListener("click", restoreFromGithub);
  elements.exportButton.addEventListener("click", exportBackup);
  elements.importInput.addEventListener("change", handleImport);
  elements.clearSyncedImagesButton.addEventListener("click", async () => {
    const count = await clearSyncedAttachmentCache();
    await refreshStorageUsage();
    showToast(count ? `已清理 ${count} 张本地缓存` : "没有可清理的已同步图片");
  });
  elements.installGuideButton.addEventListener("click", () =>
    showInfo(
      "添加到 iPhone 主屏幕",
      "<ol><li>使用 Safari 打开拾片。</li><li>点击底部“分享”按钮。</li><li>选择“添加到主屏幕”。</li><li>保持“作为网页 App 打开”并确认。</li></ol>",
      "⌂"
    )
  );
  elements.shortcutGuideButton.addEventListener("click", () =>
    showInfo(
      "配置“拾片提醒”快捷指令",
      "<ol><li>在“快捷指令”中新建并命名为“拾片提醒”。</li><li>添加“从输入中获取字典”。</li><li>读取字典中的 <code>title</code> 与 <code>date</code>。</li><li>添加“新建提醒事项”，标题和日期使用上一步字段。</li></ol><p>完成后，在任意带时间的片段中点击“加入系统提醒”即可。无需苹果开发者账号。</p>",
      "⏰"
    )
  );
}

async function loadGithubPreferences() {
  const config = (await getMeta("github-config")) || {};
  elements.githubOwner.value = config.owner || "Jesehen";
  elements.githubRepo.value = config.repo || "shipian-data";
  elements.githubBranch.value = config.branch || "main";
}

function setGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  $("#greeting").textContent = `${greeting}，阿颜`;
}

function handleLaunchParams() {
  const params = new URLSearchParams(location.search);
  const view = params.get("view");
  if (VIEW_COPY[view]) setView(view);
  if (params.get("capture") === "1") openCapture();
  const entryId = params.get("entry");
  if (entryId) openEntryDetail(entryId);

  if (location.hash.startsWith("#capture=")) {
    try {
      const text = decodeURIComponent(location.hash.slice("#capture=".length));
      openCapture().then(() => {
        elements.captureContent.value = text;
        analyzeCaptureText();
      });
    } catch {
      // Ignore malformed shortcut payload.
    }
  }
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch {
      // The app remains usable online.
    }
  }
  if (navigator.storage?.persist) {
    try {
      await navigator.storage.persist();
    } catch {
      // Storage persistence is best-effort.
    }
  }
}

async function init() {
  setGreeting();
  bindEvents();
  await loadGithubPreferences();
  await reloadEntries();
  handleLaunchParams();
  registerServiceWorker();
}

init().catch((error) => {
  console.error(error);
  showInfo("启动失败", `<p>${escapeHtml(error.message)}</p>`, "!");
});
