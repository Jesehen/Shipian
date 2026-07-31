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
  storageDot: $("#storageDot"),
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
  today: ["æ‹¾ç‰‡", "è½»é‡ Â· ç§å¯† Â· å¯é "],
  library: ["å…¨éƒ¨ç‰‡æ®µ", "è‡ªåŠ¨æ•´ç†ï¼Œæ— éœ€å½’æ¡£"],
  reminders: ["æé†’", "å†…å®¹ä¸æ—¶é—´åœ¨ä¸€èµ·"],
  search: ["æœç´¢", "æ‰¾å›ç”Ÿæ´»ä¸­çš„æ¯ä¸€ç‰‡"],
  settings: ["è®¾ç½®", "æ•°æ®ç”±ä½ æŒæ§"]
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
  if (isSameDay(date, today)) return options.dateOnly ? "ä»Šå¤©" : `ä»Šå¤© ${time}`;
  if (isSameDay(date, tomorrow)) return options.dateOnly ? "æ˜å¤©" : `æ˜å¤© ${time}`;
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
  if (delta < minute) return "åˆšåˆš";
  if (delta < hour) return `${Math.floor(delta / minute)} åˆ†é’Ÿå‰`;
  if (delta < day) return `${Math.floor(delta / hour)} å°æ—¶å‰`;
  if (delta < 7 * day) return `${Math.floor(delta / day)} å¤©å‰`;
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

function showInfo(title, html, icon = "âœ“") {
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
          ${entry.reminderAt ? `<span>â° ${formatDateTime(entry.reminderAt)}</span>` : ""}
          ${entry.syncStatus === "synced" ? "<span>å·²åŒæ­¥</span>" : ""}
        </span>
      </span>
      <span class="entry-arrow">â€º</span>
    </button>
  `;
}

function reminderRow(entry) {
  const done = Boolean(entry.completedAt);
  const recurrence = {
    daily: "æ¯å¤©",
    weekly: "æ¯å‘¨",
    monthly: "æ¯æœˆ"
  }[entry.recurrence];
  return `
    <div class="reminder-row">
      <button class="reminder-check ${done ? "done" : ""}" data-complete-id="${entry.id}" aria-label="${done ? "æ¢å¤æé†’" : "å®Œæˆæé†’"}"></button>
      <button class="reminder-copy text-button" data-entry-id="${entry.id}">
        <strong>${escapeHtml(entry.title)}</strong>
        <small>${categoryBadge(entry)} ${recurrence ? `Â· ${recurrence}` : ""}</small>
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
    : emptyState("ä»Šå¤©å¾ˆè½»æ¾", "æ—¥å¸¸å†…å®¹è®¾ç½®æé†’åï¼Œä¼šè‡ªåŠ¨å‡ºç°åœ¨è¿™é‡Œã€‚");

  const recent = getSortedEntries().slice(0, 5);
  elements.recentEntries.innerHTML = recent.length
    ? recent.map(entryCard).join("")
    : emptyState("è¿˜æ²¡æœ‰ç‰‡æ®µ", "ç‚¹å‡»ä¸‹æ–¹çš„åŠ å·ï¼Œç•™ä¸‹ç¬¬ä¸€æ¡ç”Ÿæ´»ç¢ç‰‡ã€‚");

  const rediscoverable = state.entries
    .filter((entry) => Date.now() - new Date(entry.createdAt).getTime() > 3 * 86400000)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  if (!rediscoverable.length) {
    elements.rediscoverEntry.innerHTML = emptyState(
      "è¿‡å‡ å¤©å†å›æ¥çœ‹çœ‹",
      "æ‹¾ç‰‡ä¼šåœ¨åˆé€‚çš„æ—¶å€™ï¼Œè®©æ—§æ”¶è—é‡æ–°å‡ºç°ã€‚"
    );
  } else {
    const entry = rediscoverable[state.rediscoverOffset % rediscoverable.length];
    elements.rediscoverEntry.innerHTML = `
      <button class="rediscover-card" data-entry-id="${entry.id}">
        <span class="quote-mark">â€œ</span>
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
  elements.libraryCount.textContent = `${sorted.length} ä¸ªç‰‡æ®µ`;
  elements.libraryEntries.innerHTML = visible.length
    ? visible.map(entryCard).join("")
    : emptyState("è¿™é‡Œè¿˜æ²¡æœ‰å†…å®¹", "ä¿å­˜å†…å®¹åï¼Œæ‹¾ç‰‡ä¼šè‡ªåŠ¨æ”¾å…¥åˆé€‚çš„åˆ†ç±»ã€‚");
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
    : emptyState("ä»Šå¤©æ²¡æœ‰æé†’", "ç»™ä»»æ„ç‰‡æ®µæ·»åŠ æ—¶é—´ï¼Œå®ƒå°±ä¼šå‡ºç°åœ¨è¿™é‡Œã€‚");
  elements.remindersUpcoming.innerHTML = upcoming.length
    ? upcoming.map(reminderRow).join("")
    : emptyState("æš‚æ—¶æ²¡æœ‰å®‰æ’", "æœªæ¥çš„æé†’ä¼šæŒ‰æ—¶é—´æ’åˆ—ã€‚");
  elements.remindersDone.innerHTML = done.length
    ? done.slice(0, 20).map(reminderRow).join("")
    : emptyState("è¿˜æ²¡æœ‰å®Œæˆè®°å½•", "å®Œæˆçš„æé†’ä¼šæš‚æ—¶ä¿ç•™åœ¨è¿™é‡Œã€‚");

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
  if (query === "æœ¬å‘¨æé†’") {
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
        .eveß¹¶‰ËkºwµçQ¥…±½œ¹±½Í” ¤ì(€…İ…¥ĞÉ•±½…‘¹ÑÉ¥•Ì ¤ì(€Í¡½İQ½…ÍĞ ‹–ŞË’î;šr³šrë–"ƒ¦fˆ¤ì)ô()™Õ¹Ñ¥½¸ÉÕ¹MåÍÑ•µI•µ¥¹‘•È¡•¹ÑÉä¤ì(€¥˜€ …•¹ÑÉä¹É•µ¥¹‘•ÉĞ¤É•ÑÕÉ¸ì(€½¹ÍĞÁ…å±½…€ô)M=8¹ÍÑÉ¥¹¥™ä¡ì(€€€¥è•¹ÑÉä¹¥°(€€€Ñ¥Ñ±”è•¹ÑÉä¹Ñ¥Ñ±”°(€€€‘…Ñ”è•¹ÑÉä¹É•µ¥¹‘•ÉĞ°(€€€ÕÉ°è€‘í±½…Ñ¥½¸¹½É¥¥¹ô‘í±½…Ñ¥½¸¹Á…Ñ¡¹…µ•ôı•¹ÑÉäô‘í•¹ÑÉä¹¥‘õ€(€ô¤ì(€±½…Ñ¥½¸¹¡É•˜€ôÍ¡½ÉÑÕÑÌè¼½ÉÕ¸µÍ¡½ÉÑÕĞı¹…µ”ô‘í•¹½‘•UI%½µÁ½¹•¹Ğ ‹š.û&š>C¦Hˆ¥ô™¥¹ÁÕĞõÑ•áĞ™Ñ•áĞô‘í•¹½‘•UI%½µÁ½¹•¹Ğ¡Á…å±½…¥õ€ì)ô()™Õ¹Ñ¥½¸¥Í…Ñ”¡Ù…±Õ”¤ì(€É•ÑÕÉ¸¹•Ü…Ñ”¡Ù…±Õ”¤(€€€€¹Ñ½%M=MÑÉ¥¹œ ¤(€€€€¹É•Á±…” ½l´ét½œ°€ˆˆ¤(€€€€¹É•Á±…” ½p¹q‘ìÍô¼°€ˆˆ¤ì)ô()™Õ¹Ñ¥½¸¥ÍÍ…Á”¡Ù…±Õ”¤ì(€É•ÑÕÉ¸Ù…±Õ”¹É•Á±…•±° ‰qpˆ°€‰qqqpˆ¤¹É•Á±…•±° ˆ°ˆ°€‰qp°ˆ¤¹É•Á±…•±° ˆìˆ°€‰qpìˆ¤¹É•Á±…•±° ‰q¸ˆ°€‰qq¸ˆ¤ì)ô()™Õ¹Ñ¥½¸‘½İ¹±½…‘…±•¹‘…È¡•¹ÑÉä¤ì(€½¹ÍĞÍÑ…ÉĞ€ô¹•Ü…Ñ”¡•¹ÑÉä¹É•µ¥¹‘•ÉĞ¤ì(€½¹ÍĞ•¹€ô¹•Ü…Ñ”¡ÍÑ…ÉĞ¹•ÑQ¥µ” ¤€¬€ÌÀ€¨€ØÁ|ÀÀÀ¤ì(€½¹ÍĞ¥Ì€ôl(€€€€‰	%8éY19Hˆ°(€€€€‰YIM%=8èÈ¸Àˆ°(€€€€‰AI=%è´¼¿š.û&¼½I•µ¥¹‘•È¼½i ˆ°(€€€€‰	%8éYY9Pˆ°(€€€U%è‘í•¹ÑÉä¹¥‘õÍ¡¥Á¥…¹€°(€€€QMQ5@è‘í¥Í…Ñ”¡¹•Ü…Ñ” ¤¥õ€°(€€€QMQIPè‘í¥Í…Ñ”¡ÍÑ…ÉĞ¥õ€°(€€€Q9è‘í¥Í…Ñ”¡•¹¥õ€°(€€€MU55Idè‘í¥ÍÍ…Á”¡•¹ÑÉä¹Ñ¥Ñ±”¥õ€°(€€€MI%AQ%=8è‘í¥ÍÍ…Á”¡•¹ÑÉä¹½¹Ñ•¹Ğ¥õ€°(€€€€‰9éYY9Pˆ°(€€€€‰9éY19Hˆ(€t¹©½¥¸ ‰qÉq¸ˆ¤ì(€‘½İ¹±½…‘	±½ˆ¡¹•Ü	±½ˆ¡m¥Ít°ìÑåÁ”è€‰Ñ•áĞ½…±•¹‘…Èí¡…ÉÍ•ĞõÕÑ˜´àˆô¤°€‘í•¹ÑÉä¹Ñ¥Ñ±•ô¹¥Í€¤ì)ô()™Õ¹Ñ¥½¸‘½İ¹±½…‘	±½ˆ¡‰±½ˆ°™¥±•¹…µ”¤ì(€½¹ÍĞÕÉ°€ôUI0¹É•…Ñ•=‰©•ÑUI0¡‰±½ˆ¤ì(€½¹ÍĞ…¹¡½È€ô‘½Õµ•¹Ğ¹É•…Ñ•±•µ•¹Ğ ‰„ˆ¤ì(€…¹¡½È¹¡É•˜€ôÕÉ°ì(€…¹¡½È¹‘½İ¹±½…€ô™¥±•¹…µ”ì(€…¹¡½È¹±¥¬ ¤ì(€Í•ÑQ¥µ•½ÕĞ  ¤€ôøUI0¹É•Ù½­•=‰©•ÑUI0¡ÕÉ°¤°€ÄÀÀÀ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸É•±½…‘¹ÑÉ¥•Ì ¤ì(€ÍÑ…Ñ”¹•¹ÑÉ¥•Ì€ô…İ…¥Ğ•Ñ±±¹ÑÉ¥•Ì ¤ì(€…İ…¥ĞÉ•¹‘•É±° ¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸É•™É•Í¡MÑ½É…•UÍ…” ¤ì(€½¹ÍĞÕÍ…”€ô…İ…¥Ğ•ÍÑ¥µ…Ñ•1½…±UÍ…” ¤ì(€½¹ÍĞÁ•É•¹Ğ€ô5…Ñ ¹µ¥¸ ÄÀÀ°€¡ÕÍ…”¹Ñ½Ñ…±	åÑ•Ì€¼5a}!}	eQL¤€¨€ÄÀÀ¤ì(€•±•µ•¹ÑÌ¹ÍÑ½É…•UÍ…•1…‰•°¹Ñ•áÑ½¹Ñ•¹Ğ€ô€‘í™½Éµ…Ñ	åÑ•Ì¡ÕÍ…”¹Ñ½Ñ…±	åÑ•Ì¥ôƒ
Ü€‘íÕÍ…”¹•¹ÑÉå½Õ¹Ñôƒšv‡––ºå€ì(€•±•µ•¹ÑÌ¹ÍÑ½É…•5•Ñ•É¥±°¹ÍÑå±”¹İ¥‘Ñ €ô€‘íÁ•É•¹Ñô•€ì(€•±•µ•¹ÑÌ¹ÍÑ½É…•½Ğ¹ÍÑå±”¹‰…­É½Õ¹€ô(€€€Á•É•¹Ğ€ø€äÀ€ü€‰Ù…È ´µ‘…¹•È¤ˆ€èÁ•É•¹Ğ€ø€ÜÀ€ü€‰Ù…È ´µ…µ‰•È¤ˆ€è€‰Ù…È ´µÍ…”¤ˆì)ô()™Õ¹Ñ¥½¸¥Ñ¡Õ‰±¥•¹ÑÉ½µ½É´ ¤ì(€½¹ÍĞ½¹™¥œ€ôì(€€€½İ¹•Èè•±•µ•¹ÑÌ¹¥Ñ¡Õ‰=İ¹•È¹Ù…±Õ”°(€€€É•Á¼è•±•µ•¹ÑÌ¹¥Ñ¡Õ‰I•Á¼¹Ù…±Õ”°(€€€‰É…¹ è•±•µ•¹ÑÌ¹¥Ñ¡Õ‰	É…¹ ¹Ù…±Õ”°(€€€Ñ½­•¸è•±•µ•¹ÑÌ¹¥Ñ¡Õ‰Q½­•¸¹Ù…±Õ”ñğÍ•ÍÍ¥½¹MÑ½É…”¹•Ñ%Ñ•´ ‰Í¡¥Á¥…¸µ¥Ñ¡ÕˆµÑ½­•¸ˆ¤ñğ€ˆˆ°(€€€Á…ÍÍÁ¡É…Í”è(€€€€€•±•µ•¹ÑÌ¹¥Ñ¡Õ‰A…ÍÍÁ¡É…Í”¹Ù…±Õ”ñğÍ•ÍÍ¥½¹MÑ½É…”¹•Ñ%Ñ•´ ‰Í¡¥Á¥…¸µ¥Ñ¡ÕˆµÁ…ÍÍÁ¡É…Í”ˆ¤ñğ€ˆˆ(€ôì(€ÍÑ…Ñ”¹¥Ñ¡Õˆ€ô¹•Ü¥Ñ!Õ‰Må¹Œ¡½¹™¥œ¤ì(€É•ÑÕÉ¸ÍÑ…Ñ”¹¥Ñ¡Õˆì)ô()…Íå¹Œ™Õ¹Ñ¥½¸Í…Ù•¥Ñ¡Õ‰AÉ•™•É•¹•Ì ¤ì(€½¹ÍĞÍ…™”€ôì(€€€½İ¹•Èè•±•µ•¹ÑÌ¹¥Ñ¡Õ‰=İ¹•È¹Ù…±Õ”¹ÑÉ¥´ ¤°(€€€É•Á¼è•±•µ•¹ÑÌ¹¥Ñ¡Õ‰I•Á¼¹Ù…±Õ”¹ÑÉ¥´ ¤°(€€€‰É…¹ è•±•µ•¹ÑÌ¹¥Ñ¡Õ‰	É…¹ ¹Ù…±Õ”¹ÑÉ¥´ ¤ñğ€‰µ…¥¸ˆ(€ôì(€…İ…¥ĞÍ•Ñ5•Ñ„ ‰¥Ñ¡Õˆµ½¹™¥œˆ°Í…™”¤ì(€¥˜€¡•±•µ•¹ÑÌ¹¥Ñ¡Õ‰Q½­•¸¹Ù…±Õ”¤Í•ÍÍ¥½¹MÑ½É…”¹Í•Ñ%Ñ•´ ‰Í¡¥Á¥…¸µ¥Ñ¡ÕˆµÑ½­•¸ˆ°•±•µ•¹ÑÌ¹¥Ñ¡Õ‰Q½­•¸¹Ù…±Õ”¤ì(€¥˜€¡•±•µ•¹ÑÌ¹¥Ñ¡Õ‰A…ÍÍÁ¡É…Í”¹Ù…±Õ”¤ì(€€€Í•ÍÍ¥½¹MÑ½É…”¹Í•Ñ%Ñ•´ ‰Í¡¥Á¥…¸µ¥Ñ¡ÕˆµÁ…ÍÍÁ¡É…Í”ˆ°•±•µ•¹ÑÌ¹¥Ñ¡Õ‰A…ÍÍÁ¡É…Í”¹Ù…±Õ”¤ì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸Ñ•ÍÑ¥Ñ¡Õ‰½¹¹•Ñ¥½¸ ¤ì(€ÑÉäì(€€€•±•µ•¹ÑÌ¹Íå¹MÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ğ€ô€‹š¶–r£¢ş{š:—Š˜ˆì(€€€…İ…¥ĞÍ…Ù•¥Ñ¡Õ‰AÉ•™•É•¹•Ì ¤ì(€€€½¹ÍĞÉ•ÍÕ±Ğ€ô…İ…¥Ğ¥Ñ¡Õ‰±¥•¹ÑÉ½µ½É´ ¤¹Ñ•ÍÑ½¹¹•Ñ¥½¸ ¤ì(€€€¥˜€ …É•ÍÕ±Ğ¹ÁÉ¥Ù…Ñ”¤ì(€€€€€Í¡½İ%¹™¼ ‹’îO–êO’â7šb¿’êëjˆ°€ˆñÀû’âë’ê’şwš*“RšÒïšVÃš6»¾ò3¢¾ß–#š*+šVÃš6»’îO–êO¢ºûö»’âèAÉ¥Ù…Ñ—¾ò3–7¢şo¢†3–B3š¶—ğ½Àøˆ°€ˆ„ˆ¤ì(€€€ô(€€€•±•µ•¹ÑÌ¹Íå¹MÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ğ€ôƒ–ŞË¢ş{š:”€‘íÉ•ÍÕ±Ğ¹É•Á½Í¥Ñ½Éåôƒ
Ü€‘íÉ•ÍÕ±Ğ¹‰É…¹¡õ€ì(€€€Í¡½İQ½…ÍĞ ‰¥Ñ!Õˆƒ¢ş{š:—š"C–*|ˆ¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€•±•µ•¹ÑÌ¹Íå¹MÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ğ€ô•ÉÉ½È¹µ•ÍÍ…”ì(€€€Í¡½İ%¹™¼ ‹¢ş{š:—–’Ç¢Ò”ˆ°€ñÀø‘í•Í…Á•!Ñµ°¡•ÉÉ½È¹µ•ÍÍ…”¥ôğ½Àù€°€ˆ„ˆ¤ì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸Íå¹Q½¥Ñ¡Õˆ ¤ì(€ÑÉäì(€€€…İ…¥ĞÍ…Ù•¥Ñ¡Õ‰AÉ•™•É•¹•Ì ¤ì(€€€½¹ÍĞ±¥•¹Ğ€ô¥Ñ¡Õ‰±¥•¹ÑÉ½µ½É´ ¤ì(€€€½¹ÍĞÑ•ÍĞ€ô…İ…¥Ğ±¥•¹Ğ¹Ñ•ÍÑ½¹¹•Ñ¥½¸ ¤ì(€€€¥˜€ …Ñ•ÍĞ¹ÁÉ¥Ù…Ñ”€˜˜€…½¹™¥É´ ‹¢şg’â«’îO–êO’â7šb¼AÉ¥Ù…Ñ—†»–ºk’î7¢š’â+’òƒ–B_¾ò|ˆ¤¤É•ÑÕÉ¸ì(€€€½¹ÍĞÁ•¹‘¥¹œ€ô•ÑM½ÉÑ•‘¹ÑÉ¥•Ì (€€€€€ÍÑ…Ñ”¹•¹ÑÉ¥•Ì¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø•¹ÑÉä¹Íå¹MÑ…ÑÕÌ€„ôô€‰Íå¹•ˆ¤(€€€€¤¹É•Ù•ÉÍ” ¤ì(€€€¥˜€ …Á•¹‘¥¹œ¹±•¹Ñ ¤ì(€€€€€•±•µ•¹ÑÌ¹Íå¹MÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ğ€ô€‹š&šr'––ºç–v–ŞË–B3š¶”ˆì(€€€€€Í¡½İQ½…ÍĞ ‹–ŞËî?šb¿šršZÃ*Ûšˆ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€•±•µ•¹ÑÌ¹Íå¹¥Ñ¡Õ‰	ÕÑÑ½¸¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€™½È€¡±•Ğ¥¹‘•à€ô€Àì¥¹‘•à€ğÁ•¹‘¥¹œ¹±•¹Ñ ì¥¹‘•à€¬ô€Ä¤ì(€€€€€½¹ÍĞ•¹ÑÉä€ôÁ•¹‘¥¹m¥¹‘•átì(€€€€€•±•µ•¹ÑÌ¹Íå¹MÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ğ€ôƒš¶–r£–*ƒ–¾–B3š¶”€‘í¥¹‘•à€¬€Åô¼‘íÁ•¹‘¥¹œ¹±•¹Ñ¡÷¾òh‘í•¹ÑÉä¹Ñ¥Ñ±•õ€ì(€€€€€½¹ÍĞ…ÑÑ…¡µ•¹Ğ€ô…İ…¥Ğ•ÑÑÑ…¡µ•¹Ğ¡•¹ÑÉä¹¥¤ì(€€€€€½¹ÍĞÍå¹•€ô…İ…¥Ğ±¥•¹Ğ¹ÕÁ±½…‘¹ÑÉä¡•¹ÑÉä°…ÑÑ…¡µ•¹Ğ¤ì(€€€€€…İ…¥ĞÍ…Ù•¹ÑÉä¡Íå¹•¤ì(€€€ô(€€€•±•µ•¹ÑÌ¹Íå¹MÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ğ€ôƒ–B3š¶—–º3š"@ƒ
Ü€‘í¹•Ü…Ñ” ¤¹Ñ½1½…±•Q¥µ•MÑÉ¥¹œ ‰é µ8ˆ¥õ€ì(€€€…İ…¥ĞÉ•±½…‘¹ÑÉ¥•Ì ¤ì(€€€Í¡½İQ½…ÍĞ ‹–ŞË–*ƒ–¾–B3š¶—–"À¥Ñ!Õˆˆ¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€•±•µ•¹ÑÌ¹Íå¹MÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ğ€ô•ÉÉ½È¹µ•ÍÍ…”ì(€€€Í¡½İ%¹™¼ ‹–B3š¶—–’Ç¢Ò”ˆ°€ñÀø‘í•Í…Á•!Ñµ°¡•ÉÉ½È¹µ•ÍÍ…”¥ôğ½Àù€°€ˆ„ˆ¤ì(€ô™¥¹…±±äì(€€€•±•µ•¹ÑÌ¹Íå¹¥Ñ¡Õ‰	ÕÑÑ½¸¹‘¥Í…‰±•€ô™…±Í”ì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸É•ÍÑ½É•É½µ¥Ñ¡Õˆ ¤ì(€ÑÉäì(€€€…İ…¥ĞÍ…Ù•¥Ñ¡Õ‰AÉ•™•É•¹•Ì ¤ì(€€€½¹ÍĞ±¥•¹Ğ€ô¥Ñ¡Õ‰±¥•¹ÑÉ½µ½É´ ¤ì(€€€…İ…¥Ğ±¥•¹Ğ¹Ñ•ÍÑ½¹¹•Ñ¥½¸ ¤ì(€€€•±•µ•¹ÑÌ¹É•ÍÑ½É•¥Ñ¡Õ‰	ÕÑÑ½¸¹‘¥Í…‰±•€ôÑÉÕ”ì(€€€½¹ÍĞÉ•µ½Ñ•¹ÑÉ¥•Ì€ô…İ…¥Ğ±¥•¹Ğ¹‘½İ¹±½…‘±±¹ÑÉ¥•Ì ¡ÕÉÉ•¹Ğ°Ñ½Ñ…°¤€ôøì(€€€€€•±•µ•¹ÑÌ¹Íå¹MÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ğ€ôƒš¶–r£¢–¾š‹–’4€‘íÕÉÉ•¹Ñô¼‘íÑ½Ñ…±õ€ì(€€€ô¤ì(€€€½¹ÍĞ±½…±	å%€ô¹•Ü5…À¡ÍÑ…Ñ”¹•¹ÑÉ¥•Ì¹µ…À ¡•¹ÑÉä¤€ôøm•¹ÑÉä¹¥°•¹ÑÉåt¤¤ì(€€€±•ĞÉ•ÍÑ½É•€ô€Àì(€€€™½È€¡½¹ÍĞÉ•µ½Ñ”½˜É•µ½Ñ•¹ÑÉ¥•Ì¤ì(€€€€€½¹ÍĞ±½…°€ô±½…±	å%¹•Ğ¡É•µ½Ñ”¹¥¤ì(€€€€€¥˜€ …±½…°ñğ¹•Ü…Ñ”¡É•µ½Ñ”¹ÕÁ‘…Ñ•‘Ğ¤€ø¹•Ü…Ñ”¡±½…°¹ÕÁ‘…Ñ•‘Ğ¤¤ì(€€€€€€€…İ…¥ĞÍ…Ù•¹ÑÉä¡É•µ½Ñ”¤ì(€€€€€€€É•ÍÑ½É•€¬ô€Äì(€€€€€ô(€€€ô(€€€•±•µ•¹ÑÌ¹Íå¹MÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ğ€ôƒš‹–’7–º3š"@ƒ
Üƒš&û–"À€‘íÉ•µ½Ñ•¹ÑÉ¥•Ì¹±•¹Ñ¡ôƒšv‡¾ò3šnÓšZÀ€‘íÉ•ÍÑ½É•‘ôƒšv…€ì(€€€…İ…¥ĞÉ•±½…‘¹ÑÉ¥•Ì ¤ì(€€€Í¡½İQ½…ÍĞ¡ƒ–ŞËš‹–’4€‘íÉ•ÍÑ½É•‘ôƒšv‡¢úšZÃ––ºå€¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€•±•µ•¹ÑÌ¹Íå¹MÑ…ÑÕÌ¹Ñ•áÑ½¹Ñ•¹Ğ€ô•ÉÉ½È¹µ•ÍÍ…”ì(€€€Í¡½İ%¹™¼ ‹š‹–’7–’Ç¢Ò”ˆ°€ñÀø‘í•Í…Á•!Ñµ°¡•ÉÉ½È¹µ•ÍÍ…”¥ôğ½Àù€°€ˆ„ˆ¤ì(€ô™¥¹…±±äì(€€€•±•µ•¹ÑÌ¹É•ÍÑ½É•¥Ñ¡Õ‰	ÕÑÑ½¸¹‘¥Í…‰±•€ô™…±Í”ì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸É•ÍÑ½É•I•µ½Ñ•%µ…”¡•¹ÑÉä¤ì(€ÑÉäì(€€€½¹ÍĞ±¥•¹Ğ€ô¥Ñ¡Õ‰±¥•¹ÑÉ½µ½É´ ¤ì(€€€Í¡½İQ½…ÍĞ ‹š¶–r£’î8¥Ñ!Õˆƒ¢–¾–nû&Š˜ˆ¤ì(€€€½¹ÍĞ‰åÑ•Ì€ô…İ…¥Ğ±¥•¹Ğ¹‘½İ¹±½…‘ÑÑ…¡µ•¹Ğ¡•¹ÑÉä¹É•µ½Ñ•ÑÑ…¡µ•¹ÑA…Ñ ¤ì(€€€½¹ÍĞ‰±½ˆ€ô¹•Ü	±½ˆ¡m‰åÑ•Ít°ìÑåÁ”è•¹ÑÉä¹…ÑÑ…¡µ•¹ÑQåÁ”ñğ€‰¥µ…”½İ•‰Àˆô¤ì(€€€½¹ÍĞÕÍ…”€ô…İ…¥Ğ•ÍÑ¥µ…Ñ•1½…±UÍ…” ¤ì(€€€¥˜€¡ÕÍ…”¹Ñ½Ñ…±	åÑ•Ì€¬‰±½ˆ¹Í¥é”€ø5a}!}	eQL¤ì(€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‹š‹–’7–nû&–B;’òk¢Ú¢ş€ÔÁ5¾ò3¢¾ß–#šâB–Û’î[–ŞË–B3š¶—–nû&ˆ¤ì(€€€ô(€€€…İ…¥ĞÍ…Ù•ÑÑ…¡µ•¹Ğ¡•¹ÑÉä¹¥°‰±½ˆ¤ì(€€€•±•µ•¹ÑÌ¹‘•Ñ…¥±¥…±½œ¹±½Í” ¤ì(€€€…İ…¥Ğ½Á•¹¹ÑÉå•Ñ…¥°¡•¹ÑÉä¹¥¤ì(€€€…İ…¥ĞÉ•™É•Í¡MÑ½É…•UÍ…” ¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€Í¡½İ%¹™¼ ‹š‹–’7–’Ç¢Ò”ˆ°€ñÀø‘í•Í…Á•!Ñµ°¡•ÉÉ½È¹µ•ÍÍ…”¥ôğ½Àù€°€ˆ„ˆ¤ì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸•áÁ½ÉÑ	…­ÕÀ ¤ì(€ÑÉäì(€€€Í¡½İQ½…ÍĞ ‹š¶–r£Rš"C–’’î÷Š˜ˆ¤ì(€€€½¹ÍĞÁ…å±½…€ô…İ…¥Ğ•áÁ½ÉÑ…Ñ…‰…Í” ¤ì(€€€‘½İ¹±½…‘	±½ˆ (€€€€€¹•Ü	±½ˆ¡m)M=8¹ÍÑÉ¥¹¥™ä¡Á…å±½…¥t°ìÑåÁ”è€‰…ÁÁ±¥…Ñ¥½¸½©Í½¸ˆô¤°(€€€€€ƒš.û&–’’îô´‘í¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹Í±¥” À°€ÄÀ¥ô¹©Í½¹€(€€€€¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€Í¡½İ%¹™¼ ‹–¾ó–ë–’Ç¢Ò”ˆ°€ñÀø‘í•Í…Á•!Ñµ°¡•ÉÉ½È¹µ•ÍÍ…”¥ôğ½Àù€°€ˆ„ˆ¤ì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸¡…¹‘±•%µÁ½ÉĞ ¤ì(€½¹ÍĞ™¥±”€ô•±•µ•¹ÑÌ¹¥µÁ½ÉÑ%¹ÁÕĞ¹™¥±•Ìü¹lÁtì(€¥˜€ …™¥±”¤É•ÑÕÉ¸ì(€ÑÉäì(€€€½¹ÍĞ¥µÁ½ÉÑ•€ô…İ…¥Ğ¥µÁ½ÉÑ…Ñ…‰…Í”¡)M=8¹Á…ÉÍ”¡…İ…¥Ğ™¥±”¹Ñ•áĞ ¤¤¤ì(€€€…İ…¥ĞÉ•±½…‘¹ÑÉ¥•Ì ¤ì(€€€Í¡½İQ½…ÍĞ¡ƒ–ŞË–¾ó–”€‘í¥µÁ½ÉÑ•‘ôƒšv‡¢úšZÃj––ºå€¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€Í¡½İ%¹™¼ ‹–¾ó–—–’Ç¢Ò”ˆ°€ñÀø‘í•Í…Á•!Ñµ°¡•ÉÉ½È¹µ•ÍÍ…”¥ôğ½Àù€°€ˆ„ˆ¤ì(€ô™¥¹…±±äì(€€€•±•µ•¹ÑÌ¹¥µÁ½ÉÑ%¹ÁÕĞ¹Ù…±Õ”€ô€ˆˆì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸±•…É½µÁ±•Ñ•‘I•µ¥¹‘•ÉÌ ¤ì(€½¹ÍĞ‘½¹”€ôÍÑ…Ñ”¹•¹ÑÉ¥•Ì¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø•¹ÑÉä¹½µÁ±•Ñ•‘Ğ¤ì(€¥˜€ …‘½¹”¹±•¹Ñ ¤É•ÑÕÉ¸ì(€¥˜€ …½¹™¥É´¡ƒšâ¦f€‘í‘½¹”¹±•¹Ñ¡ôƒšv‡–ŞË–º3š"Cš>C¦KjŠsš>C¦Kš^Û¦^ÓŠw¾ò––ºçšr³¢ê¯’òk’şwVg	€¤¤É•ÑÕÉ¸ì(€™½È€¡½¹ÍĞ•¹ÑÉä½˜‘½¹”¤ì(€€€…İ…¥ĞÍ…Ù•¹ÑÉä¡ì(€€€€€€¸¸¹•¹ÑÉä°(€€€€€É•µ¥¹‘•ÉĞè¹Õ±°°(€€€€€É•ÕÉÉ•¹”è€‰¹½¹”ˆ°(€€€€€½µÁ±•Ñ•‘Ğè¹Õ±°°(€€€€€ÕÁ‘…Ñ•‘Ğè¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤°(€€€€€Íå¹MÑ…ÑÕÌè€‰Á•¹‘¥¹œˆ(€€€ô¤ì(€ô(€…İ…¥ĞÉ•±½…‘¹ÑÉ¥•Ì ¤ì)ô()™Õ¹Ñ¥½¸‰¥¹‘Ù•¹ÑÌ ¤ì(€•±•µ•¹ÑÌ¹¡•É½…ÁÑÕÉ•	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôø½Á•¹…ÁÑÕÉ” ¤¤ì(€•±•µ•¹ÑÌ¹¹…Ù‘‘	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôø½Á•¹…ÁÑÕÉ” ¤¤ì(€•±•µ•¹ÑÌ¹ÍÑ½É…•	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôøÍ•ÑY¥•Ü ‰Í•ÑÑ¥¹Ìˆ¤¤ì(€€ ˆ¹¹…Øµ¥Ñ•´ˆ¤¹™½É…  ¡‰ÕÑÑ½¸¤€ôø(€€€‰ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôøÍ•ÑY¥•Ü¡‰ÕÑÑ½¸¹‘…Ñ…Í•Ğ¹Ñ…É•Ğ¤¤(€€¤ì(€€ ‰m‘…Ñ„µ½tˆ¤¹™½É…  ¡‰ÕÑÑ½¸¤€ôø(€€€‰ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôøÍ•ÑY¥•Ü¡‰ÕÑÑ½¸¹‘…Ñ…Í•Ğ¹¼¤¤(€€¤ì(€€ ‰m‘…Ñ„µ±½Í”µ‘¥…±½tˆ¤¹™½É…  ¡‰ÕÑÑ½¸¤€ôø(€€€‰ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôø‘½Õµ•¹Ğ¹•Ñ±•µ•¹Ñ	å%¡‰ÕÑÑ½¸¹‘…Ñ…Í•Ğ¹±½Í•¥…±½œ¤¹±½Í” ¤¤(€€¤ì(€•±•µ•¹ÑÌ¹¥¹™½½¹™¥Éµ	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôø•±•µ•¹ÑÌ¹¥¹™½¥…±½œ¹±½Í” ¤¤ì(€•±•µ•¹ÑÌ¹…ÁÑÕÉ•½¹Ñ•¹Ğ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰¥¹ÁÕĞˆ°…¹…±åé•…ÁÑÕÉ•Q•áĞ¤ì(€•±•µ•¹ÑÌ¹…ÁÑÕÉ•½É´¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰ÍÕ‰µ¥Ğˆ°¡…¹‘±•…ÁÑÕÉ•MÕ‰µ¥Ğ¤ì(€•±•µ•¹ÑÌ¹…ÁÑÕÉ•%µ…”¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰¡…¹”ˆ°¡…¹‘±•%µ…•M•±•Ñ¥½¸¤ì(€•±•µ•¹ÑÌ¹É•µ½Ù•ÑÑ…¡µ•¹Ñ	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°±•…ÉA•¹‘¥¹ÑÑ…¡µ•¹Ğ¤ì(€•±•µ•¹ÑÌ¹‘•Ñ•Ñ•‘I•µ¥¹‘•É	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôøì(€€€¥˜€ …ÍÑ…Ñ”¹ÍÕ•ÍÑ•‘I•µ¥¹‘•È¤É•ÑÕÉ¸ì(€€€•±•µ•¹ÑÌ¹…ÁÑÕÉ•I•µ¥¹‘•È¹Ù…±Õ”€ôÑ½…Ñ•Ñ¥µ•1½…°¡ÍÑ…Ñ”¹ÍÕ•ÍÑ•‘I•µ¥¹‘•È¹‘…Ñ”¤ì(€€€•±•µ•¹ÑÌ¹‘•Ñ•Ñ•‘I•µ¥¹‘•É	ÕÑÑ½¸¹±…ÍÍ1¥ÍĞ¹…‘ ‰¡¥‘‘•¸ˆ¤ì(€ô¤ì(€€ ‰m‘…Ñ„µ…Ñ•½Éåtˆ°•±•µ•¹ÑÌ¹…Ñ•½ÉåA¥­•È¤¹™½É…  ¡‰ÕÑÑ½¸¤€ôø(€€€‰ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôø¡½½Í•…Ñ•½Éä¡‰ÕÑÑ½¸¹‘…Ñ…Í•Ğ¹…Ñ•½Éä¤¤(€€¤ì(€•±•µ•¹ÑÌ¹…Ñ•½Éå¥±Ñ•ÉÌ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€¡•Ù•¹Ğ¤€ôøì(€€€½¹ÍĞ‰ÕÑÑ½¸€ô•Ù•¹Ğ¹Ñ…É•Ğ¹±½Í•ÍĞ ‰m‘…Ñ„µ…Ñ•½Éåtˆ¤ì(€€€¥˜€ …‰ÕÑÑ½¸¤É•ÑÕÉ¸ì(€€€ÍÑ…Ñ”¹…Ñ•½Éä€ô‰ÕÑÑ½¸¹‘…Ñ…Í•Ğ¹…Ñ•½Éäì(€€€ÍÑ…Ñ”¹Ù¥Í¥‰±•½Õ¹Ğ€ôA}M%iì(€€€€ ‰m‘…Ñ„µ…Ñ•½Éåtˆ°•±•µ•¹ÑÌ¹…Ñ•½Éå¥±Ñ•ÉÌ¤¹™½É…  ¡¡¥À¤€ôø(€€€€€¡¥À¹±…ÍÍ1¥ÍĞ¹Ñ½±” ‰…Ñ¥Ù”ˆ°¡¥À€ôôô‰ÕÑÑ½¸¤(€€€€¤ì(€€€É•¹‘•É1¥‰É…Éä ¤ì(€ô¤ì(€•±•µ•¹ÑÌ¹Í½ÉÑM•±•Ğ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰¡…¹”ˆ°€ ¤€ôøì(€€€ÍÑ…Ñ”¹Í½ÉĞ€ô•±•µ•¹ÑÌ¹Í½ÉÑM•±•Ğ¹Ù…±Õ”ì(€€€É•¹‘•É1¥‰É…Éä ¤ì(€ô¤ì(€•±•µ•¹ÑÌ¹±½…‘5½É•	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôøì(€€€ÍÑ…Ñ”¹Ù¥Í¥‰±•½Õ¹Ğ€¬ôA}M%iì(€€€É•¹‘•É1¥‰É…Éä ¤ì(€ô¤ì(€•±•µ•¹ÑÌ¹Í¡Õ™™±•	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôøì(€€€ÍÑ…Ñ”¹É•‘¥Í½Ù•É=™™Í•Ğ€¬ô€Äì(€€€É•¹‘•ÉQ½‘…ä ¤ì(€ô¤ì(€•±•µ•¹ÑÌ¹Í•…É¡%¹ÁÕĞ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰¥¹ÁÕĞˆ°É•¹‘•ÉM•…É ¤ì(€•±•µ•¹ÑÌ¹Í•…É¡Q¥ÁÌ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€¡•Ù•¹Ğ¤€ôøì(€€€½¹ÍĞ‰ÕÑÑ½¸€ô•Ù•¹Ğ¹Ñ…É•Ğ¹±½Í•ÍĞ ‰m‘…Ñ„µÍ•…É¡tˆ¤ì(€€€¥˜€ …‰ÕÑÑ½¸¤É•ÑÕÉ¸ì(€€€•±•µ•¹ÑÌ¹Í•…É¡%¹ÁÕĞ¹Ù…±Õ”€ô‰ÕÑÑ½¸¹‘…Ñ…Í•Ğ¹Í•…É ì(€€€É•¹‘•ÉM•…É  ¤ì(€ô¤ì(€€ ˆµ…¥¹½¹Ñ•¹Ğˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€¡•Ù•¹Ğ¤€ôøì(€€€½¹ÍĞ•¹ÑÉåQ…É•Ğ€ô•Ù•¹Ğ¹Ñ…É•Ğ¹±½Í•ÍĞ ‰m‘…Ñ„µ•¹ÑÉäµ¥‘tˆ¤ì(€€€¥˜€¡•¹ÑÉåQ…É•Ğ¤½Á•¹¹ÑÉå•Ñ…¥°¡•¹ÑÉåQ…É•Ğ¹‘…Ñ…Í•Ğ¹•¹ÑÉå%¤ì(€€€½¹ÍĞ½µÁ±•Ñ•Q…É•Ğ€ô•Ù•¹Ğ¹Ñ…É•Ğ¹±½Í•ÍĞ ‰m‘…Ñ„µ½µÁ±•Ñ”µ¥‘tˆ¤ì(€€€¥˜€¡½µÁ±•Ñ•Q…É•Ğ¤ì(€€€€€•Ù•¹Ğ¹ÁÉ•Ù•¹Ñ•™…Õ±Ğ ¤ì(€€€€€•Ù•¹Ğ¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€€Ñ½±•I•µ¥¹‘•É½µÁ±•Ñ”¡½µÁ±•Ñ•Q…É•Ğ¹‘…Ñ…Í•Ğ¹½µÁ±•Ñ•%¤ì(€€€ô(€ô¤ì(€•±•µ•¹ÑÌ¹•‘¥Ñ¹ÑÉå	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°…Íå¹Œ€ ¤€ôøì(€€€½¹ÍĞ•¹ÑÉä€ô…İ…¥Ğ•Ñ¹ÑÉä¡ÍÑ…Ñ”¹Í•±•Ñ•‘¹ÑÉå%¤ì(€€€¥˜€¡•¹ÑÉä¤½Á•¹…ÁÑÕÉ”¡•¹ÑÉä¤ì(€ô¤ì(€•±•µ•¹ÑÌ¹‘•Ñ…¥±¥…±½œ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±½Í”ˆ°É•Ù½­•=‰©•ÑUÉ±Ì¤ì(€•±•µ•¹ÑÌ¹…ÁÑÕÉ•¥…±½œ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±½Í”ˆ°€ ¤€ôøì(€€€¥˜€ …•±•µ•¹ÑÌ¹•‘¥Ñ¥¹¹ÑÉå%¹Ù…±Õ”¤±•…ÉA•¹‘¥¹ÑÑ…¡µ•¹Ğ ¤ì(€ô¤ì(€•±•µ•¹ÑÌ¹±•…É½µÁ±•Ñ•‘	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°±•…É½µÁ±•Ñ•‘I•µ¥¹‘•ÉÌ¤ì(€•±•µ•¹ÑÌ¹Ñ•ÍÑ¥Ñ¡Õ‰	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°Ñ•ÍÑ¥Ñ¡Õ‰½¹¹•Ñ¥½¸¤ì(€•±•µ•¹ÑÌ¹Íå¹¥Ñ¡Õ‰	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°Íå¹Q½¥Ñ¡Õˆ¤ì(€•±•µ•¹ÑÌ¹É•ÍÑ½É•¥Ñ¡Õ‰	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°É•ÍÑ½É•É½µ¥Ñ¡Õˆ¤ì(€•±•µ•¹ÑÌ¹•áÁ½ÉÑ	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°•áÁ½ÉÑ	…­ÕÀ¤ì(€•±•µ•¹ÑÌ¹¥µÁ½ÉÑ%¹ÁÕĞ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰¡…¹”ˆ°¡…¹‘±•%µÁ½ÉĞ¤ì(€•±•µ•¹ÑÌ¹±•…ÉMå¹•‘%µ…•Í	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°…Íå¹Œ€ ¤€ôøì(€€€½¹ÍĞ½Õ¹Ğ€ô…İ…¥Ğ±•…ÉMå¹•‘ÑÑ…¡µ•¹Ñ…¡” ¤ì(€€€…İ…¥ĞÉ•™É•Í¡MÑ½É…•UÍ…” ¤ì(€€€Í¡½İQ½…ÍĞ¡½Õ¹Ğ€üƒ–ŞËšâB€‘í½Õ¹Ñôƒ–òƒšr³–rÃòO–¶a€€è€‹šÊ‡šr'–>¿šâBj–ŞË–B3š¶—–nû&ˆ¤ì(€ô¤ì(€•±•µ•¹ÑÌ¹¥¹ÍÑ…±±Õ¥‘•	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôø(€€€Í¡½İ%¹™¼ (€€€€€€‹šŞï–*ƒ–"À¥A¡½¹”ƒ’âï–Æ?–æTˆ°(€€€€€€ˆñ½°øñ±¤û’öÿR M…™…É¤ƒš&O–òš.û&ğ½±¤øñ±¤û
ç–ï–êW¦£Šs–"’ê¯Šwš2'¦J»ğ½±¤øñ±¤û¦'š.§ŠsšŞï–*ƒ–"Ã’âï–Æ?–æWŠwğ½±¤øñ±¤û’şwš2Šs’ös’âëöG¦†ÔÁÀƒš&O–òŠw–æÛ†»¢º“ğ½±¤øğ½½°øˆ°(€€€€€€‹Š2ˆ(€€€€¤(€€¤ì(€•±•µ•¹ÑÌ¹Í¡½ÉÑÕÑÕ¥‘•	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôø(€€€Í¡½İ%¹™¼ (€€€€€€‹¦7ö»Šsš.û&š>C¦KŠw–ş¯š6ßš2’îˆ°(€€€€€€ˆñ½°øñ±¤û–r£Šs–ş¯š6ßš2’î“Šw’â·šZÃ–îë–æÛ–F÷–B7’âëŠsš.û&š>C¦KŠwğ½±¤øñ±¤ûšŞï–*ƒŠs’î;¢úO–—’â·¢:ß–>[–¶_–ãŠwğ½±¤øñ±¤û¢¾ï–>[–¶_–ã’â·j€ñ½‘”ùÑ¥Ñ±”ğ½½‘”øƒ’â8€ñ½‘”ù‘…Ñ”ğ½½‘”ûğ½±¤øñ±¤ûšŞï–*ƒŠsšZÃ–îëš>C¦K’ê/¦†çŠw¾ò3š‚¦Šc–J3š^—šr’öÿR£’â+’âš¶—–¶_šº×ğ½±¤øğ½½°øñÀû–º3š"C–B;¾ò3–r£’îïš?–â›š^Û¦^Ój&šº×’â·
ç–ïŠs–*ƒ–—Îïîš>C¦KŠw–6Ï–>¿š^ƒ¦r¢.çšzs–ò–>G¢¢Ò›–>ßğ½Àøˆ°(€€€€€€‹Š>Àˆ(€€€€¤(€€¤ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸±½…‘¥Ñ¡Õ‰AÉ•™•É•¹•Ì ¤ì(€½¹ÍĞ½¹™¥œ€ô€¡…İ…¥Ğ•Ñ5•Ñ„ ‰¥Ñ¡Õˆµ½¹™¥œˆ¤¤ñğíôì(€•±•µ•¹ÑÌ¹¥Ñ¡Õ‰=İ¹•È¹Ù…±Õ”€ô½¹™¥œ¹½İ¹•Èñğ€‰)•Í•¡•¸ˆì(€•±•µ•¹ÑÌ¹¥Ñ¡Õ‰I•Á¼¹Ù…±Õ”€ô½¹™¥œ¹É•Á¼ñğ€‰Í¡¥Á¥…¸µ‘…Ñ„ˆì(€•±•µ•¹ÑÌ¹¥Ñ¡Õ‰	É…¹ ¹Ù…±Õ”€ô½¹™¥œ¹‰É…¹ ñğ€‰µ…¥¸ˆì)ô()™Õ¹Ñ¥½¸Í•ÑÉ••Ñ¥¹œ ¤ì(€½¹ÍĞ¡½ÕÈ€ô¹•Ü…Ñ” ¤¹•Ñ!½ÕÉÌ ¤ì(€½¹ÍĞÉ••Ñ¥¹œ€ô¡½ÕÈ€ğ€ÄÄ€ü€‹š^§’â+––ôˆ€è¡½ÕÈ€ğ€Äà€ü€‹’â/–6#––ôˆ€è€‹šfk’â+––ôˆì(€€ ˆÉ••Ñ¥¹œˆ¤¹Ñ•áÑ½¹Ñ•¹Ğ€ô€‘íÉ••Ñ¥¹÷¾ò3¦bÿ¦Šq€ì)ô()™Õ¹Ñ¥½¸¡…¹‘±•1…Õ¹¡A…É…µÌ ¤ì(€½¹ÍĞÁ…É…µÌ€ô¹•ÜUI1M•…É¡A…É…µÌ¡±½…Ñ¥½¸¹Í•…É ¤ì(€½¹ÍĞÙ¥•Ü€ôÁ…É…µÌ¹•Ğ ‰Ù¥•Üˆ¤ì(€¥˜€¡Y%]}=AemÙ¥•İt¤Í•ÑY¥•Ü¡Ù¥•Ü¤ì(€¥˜€¡Á…É…µÌ¹•Ğ ‰…ÁÑÕÉ”ˆ¤€ôôô€ˆÄˆ¤½Á•¹…ÁÑÕÉ” ¤ì(€½¹ÍĞ•¹ÑÉå%€ôÁ…É…µÌ¹•Ğ ‰•¹ÑÉäˆ¤ì(€¥˜€¡•¹ÑÉå%¤½Á•¹¹ÑÉå•Ñ…¥°¡•¹ÑÉå%¤ì((€¥˜€¡±½…Ñ¥½¸¹¡…Í ¹ÍÑ…ÉÑÍ]¥Ñ  ˆ…ÁÑÕÉ”ôˆ¤¤ì(€€€ÑÉäì(€€€€€½¹ÍĞÑ•áĞ€ô‘•½‘•UI%½µÁ½¹•¹Ğ¡±½…Ñ¥½¸¹¡…Í ¹Í±¥” ˆ…ÁÑÕÉ”ôˆ¹±•¹Ñ ¤¤ì(€€€€€½Á•¹…ÁÑÕÉ” ¤¹Ñ¡•¸  ¤€ôøì(€€€€€€€•±•µ•¹ÑÌ¹…ÁÑÕÉ•½¹Ñ•¹Ğ¹Ù…±Õ”€ôÑ•áĞì(€€€€€€€…¹…±åé•…ÁÑÕÉ•Q•áĞ ¤ì(€€€€€ô¤ì(€€€ô…Ñ ì(€€€€€€¼¼%¹½É”µ…±™½Éµ•Í¡½ÉÑÕĞÁ…å±½…¸(€€€ô(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸É•¥ÍÑ•ÉM•ÉÙ¥•]½É­•È ¤ì(€¥˜€ ‰Í•ÉÙ¥•]½É­•Èˆ¥¸¹…Ù¥…Ñ½È¤ì(€€€ÑÉäì(€€€€€…İ…¥Ğ¹…Ù¥…Ñ½È¹Í•ÉÙ¥•]½É­•È¹É•¥ÍÑ•È ˆ¸½ÍÜ¹©Ìˆ¤ì(€€€ô…Ñ ì(€€€€€€¼¼Q¡”…ÁÀÉ•µ…¥¹ÌÕÍ…‰±”½¹±¥¹”¸(€€€ô(€ô(€¥˜€¡¹…Ù¥…Ñ½È¹ÍÑ½É…”ü¹Á•ÉÍ¥ÍĞ¤ì(€€€ÑÉäì(€€€€€…İ…¥Ğ¹…Ù¥…Ñ½È¹ÍÑ½É…”¹Á•ÉÍ¥ÍĞ ¤ì(€€€ô…Ñ ì(€€€€€€¼¼MÑ½É…”Á•ÉÍ¥ÍÑ•¹”¥Ì‰•ÍĞµ•™™½ÉĞ¸(€€€ô(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸¥¹¥Ğ ¤ì(€Í•ÑÉ••Ñ¥¹œ ¤ì(€‰¥¹‘Ù•¹ÑÌ ¤ì(€…İ…¥Ğ±½…‘¥Ñ¡Õ‰AÉ•™•É•¹•Ì ¤ì(€…İ…¥ĞÉ•±½…‘¹ÑÉ¥•Ì ¤ì(€¡…¹‘±•1…Õ¹¡A…É…µÌ ¤ì(€É•¥ÍÑ•ÉM•ÉÙ¥•]½É­•È ¤ì)ô()¥¹¥Ğ ¤¹…Ñ  ¡•ÉÉ½È¤€ôøì(€½¹Í½±”¹•ÉÉ½È¡•ÉÉ½È¤ì(€Í¡½İ%¹™¼ ‹–B¿–*£–’Ç¢Ò”ˆ°€ñÀø‘í•Í…Á•!Ñµ°¡•ÉÉ½È¹µ•ÍÍ…”¥ôğ½Àù€°€ˆ„ˆ¤ì)ô¤ì(