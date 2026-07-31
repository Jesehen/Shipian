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
    .filter((entry) => Date.now() - new Date(entry.createdAt).vë8¶‰ËkºwµçB‚‹™š[\‹XÚ\Âˆ›^ˆ]]ÎÂˆZ[‹ZZYÚˆÍÂˆY[™ÎˆÜLÜÂˆ›Ü™\ˆ\ÛÛY˜\ŠK[[™JNÂˆ›Ü™\‹\˜Y]\ÎˆNN\Âˆ˜XÚÙÜ›İ[™ˆ˜\ŠK\İ\™˜XÙJNÂˆÛÛÜˆ˜\ŠK[]]Y
NÂˆ›Û\Ú^™NˆÎ™[NÂŸB‚‹™š[\‹XÚ\˜Xİ]™HÂˆ›Ü™\‹XÛÛÜˆ˜\ŠKZ[šÊNÂˆ˜XÚÙÜ›İ[™ˆ˜\ŠKZ[šÊNÂˆÛÛÜˆÚ]NÂŸB‚‹œİ]Ë[[™HÂˆX\™Ú[ˆœœMÂˆ\Ü^Nˆ›^Âˆ[YÛ‹Z][\ÎˆÙ[\Âˆ\İYKXÛÛ[ˆÜXÙKX™]ÙY[ÂˆÛÛÜˆ˜\ŠK[]]Y
NÂˆ›Û\Ú^™NˆÍœ™[NÂŸB‚‹œİ]Ë[[™HÙ[XİÂˆY[™ÎˆÜÜLÂˆ›Ü™\ˆÂˆ˜XÚÙÜ›İ[™ˆ˜[œÜ\™[ÂˆÛÛÜˆ˜\ŠKZ[šÊNÂŸB‚‹œ™[Z[™\‹\İ[[X\HÂˆY[™ÎˆMœLÂˆ\Ü^NˆÜšYÂˆÜšY][\]KXÛÛ[[œÎˆ™\X]
ËYœŠNÂˆØ\ˆÂˆ›Ü™\ˆ\ÛÛY˜\ŠK[[™JNÂˆ›Ü™\‹\˜Y]\ÎˆŒœÂˆ˜XÚÙÜ›İ[™ˆ˜\ŠK\İ\™˜XÙJNÂŸB‚‹œ™[Z[™\‹\İ[[X\Hˆ]ˆÂˆ\Ü^NˆÜšYÂˆ\İYKZ][\ÎˆÙ[\ÂˆØ\ˆœÂŸB‚‹œ™[Z[™\‹\İ[[X\Hˆ]ˆ
È]ˆÂˆ›Ü™\‹[Yˆ\ÛÛY˜\ŠK[[™JNÂŸB‚‹œ™[Z[™\‹\İ[[X\HÜ[ˆÂˆ›ÛY˜[Z[Nˆ”ÛÛ™İHĞÈ‹Ù\šYÂˆ›Û\Ú^™NˆKÜ™[NÂˆ›Û]ÙZYÚˆÌÂŸB‚‹œ™[Z[™\‹\İ[[X\HÛX[ÂˆÛÛÜˆ˜\ŠK[]]Y
NÂˆ›Û\Ú^™NˆÌœ™[NÂŸB‚‹œÙX\˜ÚX›ŞÂˆZ[‹ZZYÚˆLœÂˆY[™ÎˆM\Âˆ\Ü^Nˆ›^Âˆ[YÛ‹Z][\ÎˆÙ[\ÂˆØ\ˆLÂˆ›Ü™\ˆ\ÛÛY™Ø˜JLKLËËŒ
NÂˆ›Ü™\‹\˜Y]\ÎˆMÜÂˆ˜XÚÙÜ›İ[™ˆ˜\ŠK\İ\™˜XÙJNÂŸB‚‹œÙX\˜ÚX›Şİ™ÈÂˆ›^ˆ]]ÎÂˆÚYˆŒ\ÂˆÛÛÜˆ˜\ŠK\ØYÙJNÂŸB‚‹œÙX\˜ÚX›Ş[œ]ÂˆÚYˆL	NÂˆ›Ü™\ˆÂˆİ][™NˆÂˆ˜XÚÙÜ›İ[™ˆ˜[œÜ\™[ÂˆÛÛÜˆ˜\ŠKZ[šÊNÂˆ›Û\Ú^™Nˆ\™[NÂŸB‚‹œÙX\˜Ú]\ÈÂˆX\™Ú[ˆNÜÂˆ\Ü^Nˆ›^Âˆ[YÛ‹Z][\ÎˆÙ[\Âˆ›^]Ü˜\ˆÜ˜\ÂˆØ\ˆÂŸB‚‹œÙX\˜Ú]\ÈÂˆÚYˆL	NÂˆX\™Ú[ˆœÂˆÛÛÜˆ˜\ŠK[]]Y
NÂˆ›Û\Ú^™NˆÍ\™[NÂŸB‚‹œÙX\˜Ú]\È]ÛˆÂˆY[™ÎˆÜL\Âˆ›Ü™\ˆÂˆ›Ü™\‹\˜Y]\ÎˆNN\Âˆ˜XÚÙÜ›İ[™ˆ˜\ŠK\ØYÙK\ÛÙ
NÂˆÛÛÜˆ˜\ŠK\ØYÙJNÂˆ›Û\Ú^™NˆÍœ™[NÂŸB‚‹œÙ][™ÜËYÜ›İ\ÂˆX\™Ú[‹X›İÛNˆœÂˆY[™ÎˆN\Âˆ›Ü™\ˆ\ÛÛY˜\ŠK[[™JNÂˆ›Ü™\‹\˜Y]\ÎˆŒœÂˆ˜XÚÙÜ›İ[™ˆ™Ø˜JMKLËËŠNÂŸB‚‹œÙ][™ÜËYÜ›İ\ˆÂˆX\™Ú[‹X›İÛNˆMÂŸB‚‹œÙ][™ÜËY\ØÜš\[ÛˆÂˆX\™Ú[ˆM\MœÂˆÛÛÜˆ˜\ŠK[]]Y
NÂˆ›Û\Ú^™NˆÍÜ™[NÂˆ[™KZZYÚˆKÂŸB‚‹œÙ][™ÜË\›İÈÂˆÚYˆL	NÂˆZ[‹ZZYÚˆŒÂˆY[™Îˆ\Âˆ\Ü^NˆÜšYÂˆÜšY][\]KXÛÛ[[œÎˆ]]ÈYœˆ]]ÎÂˆ[YÛ‹Z][\ÎˆÙ[\ÂˆØ\ˆL\Âˆ›Ü™\ˆÂˆ›Ü™\‹]Üˆ\ÛÛY˜\ŠK[[™JNÂˆ˜XÚÙÜ›İ[™ˆ˜[œÜ\™[Âˆ^X[YÛˆYÂŸB‚‹œÙ][™ÜË\›İÎ™š\œİ[Ù‹]\HÂˆ›Ü™\‹]ÜˆÂŸB‚‹œÙ][™ÜË\›İÈİ›Û™Ë‹œÙ][™ÜË\›İÈÛX[Âˆ\Ü^Nˆ›ØÚÎÂŸB‚‹œÙ][™ÜË\›İÈİ›Û™ÈÂˆX\™Ú[‹X›İÛNˆÂˆ›Û\Ú^™Nˆœ™[NÂŸB‚‹œÙ][™ÜË\›İÈÛX[ÂˆÛÛÜˆ˜\ŠK[]]Y
NÂˆ›Û\Ú^™NˆÜ™[NÂˆ[™KZZYÚˆKŒÍNÂŸB‚‹œÙ][™ÜËZXÛÛˆÂˆ\Ü^NˆÜšYÂˆXÙKZ][\ÎˆÙ[\ÂˆÚYˆÍœÂˆZYÚˆÍœÂˆ›Ü™\‹\˜Y]\ÎˆL\Âˆ˜XÚÙÜ›İ[™ˆ˜\ŠK\ØYÙK\ÛÙ
NÂˆÛÛÜˆ˜\ŠK\ØYÙJNÂŸB‚‹œÙ][™ÜËZXÛÛ‹˜[X™\ˆÂˆ˜XÚÙÜ›İ[™ˆ˜\ŠKX[X™\‹\ÛÙ
NÂˆÛÛÜˆ˜\ŠKX[X™\ŠNÂŸB‚‹œÙ][™ÜËZXÛÛ‹˜›YHÂˆ˜XÚÙÜ›İ[™ˆ˜\ŠKX›YK\ÛÙ
NÂˆÛÛÜˆ˜\ŠKX›YJNÂŸB‚‹œÙ][™ÜËZXÛÛ‹›™]]˜[Âˆ˜XÚÙÜ›İ[™ˆÙYYXÙMNÂˆÛÛÜˆÍÍÍÍ™NÂŸB‚‹œÙ][™ÜËY›Ü›HÂˆ\Ü^NˆÜšYÂˆØ\ˆLœÂŸB‚‹œÙ][™ÜËY›Ü›HX™[Âˆ\Ü^NˆÜšYÂˆØ\ˆ\ÂˆÛÛÜˆ˜\ŠK[]]Y
NÂˆ›Û\Ú^™NˆÌœ™[NÂŸB‚‹œÙ][™ÜËY›Ü›H[œ]‹˜Ø\\™KYšY[[œ]‹˜Ø\\™KYšY[^\™XK‹˜Ø\\™KYšY[Ù[XİÂˆÚYˆL	NÂˆZ[‹ZZYÚˆ\ÂˆY[™ÎˆL\LœÂˆ›Ü™\ˆ\ÛÛY˜\ŠK[[™JNÂˆ›Ü™\‹\˜Y]\ÎˆLÜÂˆİ][™Nˆ›Û™NÂˆ˜XÚÙÜ›İ[™ˆ˜\ŠK\İ\™˜XÙK\İ›Û™ÊNÂˆÛÛÜˆ˜\ŠKZ[šÊNÂŸB‚‹œÙ][™ÜËY›Ü›H[œ]™›Øİ\Ë‹˜Ø\\™KYšY[[œ]™›Øİ\Ë‹˜Ø\\™KYšY[^\™XN™›Øİ\Ë‹˜Ø\\™KYšY[Ù[Xİ™›Øİ\ÈÂˆ›Ü™\‹XÛÛÜˆ™Ø˜JLKLËËJNÂˆ›Ş\ÚYİÎˆÜ™Ø˜JLKLËËŒJNÂŸB‚‹™›Ü›KXXİ[ÛœÈÂˆ\Ü^NˆÜšYÂˆÜšY][\]KXÛÛ[[œÎˆYœˆYœÂˆØ\ˆLÂˆX\™Ú[‹]ÜˆœÂŸB‚‹œš[X\KX]Û‹‹œÙXÛÛ™\KX]ÛˆÂˆZ[‹ZZYÚˆ\ÂˆY[™ÎˆLM\Âˆ›Ü™\‹\˜Y]\ÎˆMÂˆ›Û]ÙZYÚˆÌÂŸB‚‹œš[X\KX]ÛˆÂˆ›Ü™\ˆ\ÛÛY˜\ŠKZ[šÊNÂˆ˜XÚÙÜ›İ[™ˆ˜\ŠKZ[šÊNÂˆÛÛÜˆÚ]NÂŸB‚‹œÙXÛÛ™\KX]ÛˆÂˆ›Ü™\ˆ\ÛÛY˜\ŠK[[™JNÂˆ˜XÚÙÜ›İ[™ˆ˜\ŠK\İ\™˜XÙJNÂˆÛÛÜˆ˜\ŠKZ[šÊNÂŸB‚‹œš[X\KX]Û‹™[ÂˆÚYˆL	NÂŸB‚‹œŞ[˜Ë\İ]\ÈÂˆX\™Ú[ˆÂˆÛÛÜˆ˜\ŠK[]]Y
NÂˆ›Û\Ú^™NˆÌœ™[NÂˆ^X[YÛˆÙ[\ÂŸB‚‹œİÜ˜YÙK[Y]\ˆÂˆX\™Ú[‹X›İÛNˆMÂŸB‚‹œİÜ˜YÙK[X™[ÂˆX\™Ú[‹X›İÛNˆÜÂˆ\Ü^Nˆ›^Âˆ\İYKXÛÛ[ˆÜXÙKX™]ÙY[ÂˆÛÛÜˆ˜\ŠK[]]Y
NÂˆ›Û\Ú^™NˆÜ™[NÂŸB‚‹›Y]\‹]˜XÚÈÂˆZYÚˆÜÂˆİ™\™›İÎˆY[Âˆ›Ü™\‹\˜Y]\ÎˆNN\Âˆ˜XÚÙÜ›İ[™ˆÙM™MÎÂŸB‚‹›Y]\‹]˜XÚÈÜ[ˆÂˆ\Ü^Nˆ›ØÚÎÂˆÚYˆÂˆZYÚˆL	NÂˆ›Ü™\‹\˜Y]\Îˆ[š\š]Âˆ˜XÚÙÜ›İ[™ˆ˜\ŠK\ØYÙJNÂˆ˜[œÚ][ÛˆÚYŒŒ\ÈX\ÙNÂŸB‚‹™š[K\›İÈÂˆÜÚ][Ûˆ™[]]™NÂŸB‚‹™š[K\›İÈ[œ]ÂˆÜÚ][ÛˆXœÛÛ]NÂˆÚYˆ\ÂˆZYÚˆ\ÂˆÜXÚ]NˆÂŸB‚‹˜\]™\œÚ[ÛˆÂˆX\™Ú[ˆÍ\ÂˆÛÛÜˆÎXYXÂˆ›Û\Ú^™Nˆ™[NÂˆ^X[YÛˆÙ[\ÂŸB‚‹˜›İÛK[˜]ˆÂˆÜÚ][Ûˆš^YÂˆ‹Z[™^ˆLÂˆšYÚˆÂˆ›İÛNˆÂˆYˆÂˆZ[‹ZZYÚˆØ[ÊÌ
È˜\ŠK\ØY™KX›İÛJJNÂˆY[™ÎˆX^
MØ[Ê
LÈHÍŒ
HÈˆ
ÈM
JHØ[Ê
È˜\ŠK\ØY™KX›İÛJJNÂˆ\Ü^NˆÜšYÂˆÜšY][\]KXÛÛ[[œÎˆYœˆYœˆYœˆYœÂˆ[YÛ‹Z][\Îˆ[™Âˆ›Ü™\‹]Üˆ\ÛÛY˜\ŠK[[™JNÂˆ˜XÚÙÜ›İ[™ˆ™Ø˜JMKLËËLŠNÂˆ]ÙXšÚ]X˜XÚÙ›ÜYš[\ˆ›\ŠN
NÂˆ˜XÚÙ›ÜYš[\ˆ›\ŠN
NÂŸB‚‹›˜]‹Z][K‹›˜]‹XYÂˆ›Ü™\ˆÂˆ˜XÚÙÜ›İ[™ˆ˜[œÜ\™[ÂŸB‚‹›˜]‹Z][HÂˆZ[‹ZZYÚˆLÂˆ\Ü^NˆÜšYÂˆ\İYKZ][\ÎˆÙ[\Âˆ[YÛ‹XÛÛ[ˆÙ[\ÂˆØ\ˆÜÂˆÛÛÜˆÎNLÂˆ›Û\Ú^™Nˆ™[NÂŸB‚‹›˜]‹Z][Hİ™ÈÂˆÚYˆŒœÂˆZYÚˆŒœÂŸB‚‹›˜]‹Z][K˜Xİ]™HÂˆÛÛÜˆ˜\ŠK\ØYÙJNÂˆ›Û]ÙZYÚˆÌÂŸB‚‹›˜]‹XYÂˆ[YÛ‹\Ù[ˆİ\ÂˆÚYˆMœÂˆZYÚˆMœÂˆX\™Ú[ˆLN\]]ÈÂˆ›Ü™\ˆ\ÛÛY˜\ŠK\İ\™˜XÙJNÂˆ›Ü™\‹\˜Y]\ÎˆL	NÂˆ˜XÚÙÜ›İ[™ˆ˜\ŠKZ[šÊNÂˆ›Ş\ÚYİÎˆŒœ™Ø˜JÌ‹LËŒ
NÂˆÛÛÜˆÚ]NÂˆ›Û\Ú^™Nˆœ™[NÂˆ›Û]ÙZYÚˆLÂˆ[™KZZYÚˆNÂŸB‚™X[ÙÈÂˆÛÛÜˆ˜\ŠKZ[šÊNÂŸB‚™X[ÙÎ˜˜XÚÙ›ÜÂˆ˜XÚÙÜ›İ[™ˆ™Ø˜JÌ‹ŒÌŠNÂˆ]ÙXšÚ]X˜XÚÙ›ÜYš[\ˆ›\ŠÜ
NÂˆ˜XÚÙ›ÜYš[\ˆ›\ŠÜ
NÂŸB‚‹œÚY]YX[ÙÈÂˆÚYˆZ[ŠL	KÍŒ
NÂˆX^]ÚYˆ›Û™NÂˆX^ZZYÚˆLYšÂˆX\™Ú[ˆ]]È]]ÈÂˆY[™ÎˆNØ[ÊŒœ
È˜\ŠK\ØY™KX›İÛJJNÂˆİ™\™›İË^Nˆ]]ÎÂˆ›Ü™\ˆÂˆ›Ü™\‹\˜Y]\ÎˆÂˆ˜XÚÙÜ›İ[™ˆ˜\ŠKX™ÊNÂŸB‚‹œÚY]Z[™HÂˆÚYˆÂˆZYÚˆ\ÂˆX\™Ú[ˆ]]ÈÂˆ›Ü™\‹\˜Y]\ÎˆNN\Âˆ˜XÚÙÜ›İ[™ˆÙYÙNÂŸB‚‹œÚY]ZXY[™ÈÂˆZ[‹ZZYÚˆÂˆ\Ü^NˆÜšYÂˆÜšY][\]KXÛÛ[[œÎˆYœˆ]]ÈYœÂˆ[YÛ‹Z][\ÎˆÙ[\ÂŸB‚‹œÚY]ZXY[™ÈˆÂˆX\™Ú[ˆÂˆ›Û\Ú^™Nˆ\™[NÂŸB‚‹œÚY]ZXY[™Èˆ›\İXÚ[Âˆ\İYK\Ù[ˆ[™ÂŸB‚‹˜Ø\\™KYšY[Âˆ\Ü^NˆÜšYÂˆØ\ˆÜÂˆX\™Ú[‹]ÜˆMÂˆÛÛÜˆ˜\ŠK[]]Y
NÂˆ›Û\Ú^™NˆÍ™[NÂŸB‚‹˜Ø\\™KYšY[ÛX[ÂˆÛÛÜˆØLMXLNÂŸB‚‹˜Ø\\™KYšY[^\™XHÂˆZ[‹ZZYÚˆLÌÂˆ™\Ú^™Nˆ™\XØ[ÂˆÛÛÜˆ˜\ŠKZ[šÊNÂˆ›Û\Ú^™Nˆ\™[NÂˆ[™KZZYÚˆKMNÂŸB‚‹˜ÛÛ\XİYšY[ÂˆX\™Ú[‹]ÜˆLœÂŸB‚‹™]XİY\›İÈÂˆZ[‹ZZYÚˆÜÂˆ\Ü^Nˆ›^Âˆ[YÛ‹Z][\ÎˆÙ[\Âˆ\İYKXÛÛ[ˆÜXÙKX™]ÙY[ÂˆØ\ˆÂŸB‚‹™]XİY\™[Z[™\ˆÂˆY[™ÎˆÜLÂˆ›Ü™\ˆÂˆ›Ü™\‹\˜Y]\ÎˆNN\Âˆ˜XÚÙÜ›İ[™ˆ˜\ŠKX[X™\‹\ÛÙ
NÂˆÛÛÜˆÎMÍ˜LMÂˆ›Û\Ú^™NˆÜ™[NÂŸB‚‹˜Ø]YÛÜK\XÚÙ\ˆÂˆ\Ü^NˆÜšYÂˆÜšY][\]KXÛÛ[[œÎˆ™\X]
KYœŠNÂˆØ\ˆ\ÂŸB‚‹˜Ø]YÛÜK\XÚÙ\ˆ]ÛˆÂˆZ[‹ZZYÚˆÍœÂˆY[™Îˆ\œÂˆ›Ü™\ˆ\ÛÛY˜\ŠK[[™JNÂˆ›Ü™\‹\˜Y]\ÎˆL\Âˆ˜XÚÙÜ›İ[™ˆ˜\ŠK\İ\™˜XÙJNÂˆÛÛÜˆ˜\ŠK[]]Y
NÂˆ›Û\Ú^™NˆÌœ™[NÂŸB‚‹˜Ø]YÛÜK\XÚÙ\ˆ]Û‹˜Xİ]™HÂˆ›Ü™\‹XÛÛÜˆ˜\ŠK\ØYÙJNÂˆ˜XÚÙÜ›İ[™ˆ˜\ŠK\ØYÙK\ÛÙ
NÂˆÛÛÜˆ˜\ŠK\ØYÙJNÂˆ›Û]ÙZYÚˆÌÂŸB‚‹˜Ø\\™KYÜšYÂˆ\Ü^NˆÜšYÂˆÜšY][\]KXÛÛ[[œÎˆKŒÍYœˆYœÂˆØ\ˆ\ÂŸB‚‹˜]XÚY[\XÚÙ\ˆÂˆZ[‹ZZYÚˆ\ÂˆX\™Ú[‹]ÜˆM\ÂˆY[™ÎˆLœÂˆ\Ü^NˆÜšYÂˆXÙKZ][\ÎˆÙ[\Âˆ›Ü™\ˆ\\ÚY™Ø˜JLKLËËŒÍJNÂˆ›Ü™\‹\˜Y]\ÎˆM\Âˆ˜XÚÙÜ›İ[™ˆ™Ø˜JŒÌ‹ŒÍËŒ‹ŒÍJNÂˆÛÛÜˆ˜\ŠK\ØYÙJNÂˆ›Û\Ú^™NˆÎ™[NÂŸB‚‹˜]XÚY[\XÚÙ\ˆ[œ]ÂˆÜÚ][ÛˆXœÛÛ]NÂˆÚYˆ\ÂˆZYÚˆ\ÂˆÜXÚ]NˆÂŸB‚‹˜]XÚY[\XÚÙ\ˆÛX[ÂˆX\™Ú[‹]ÜˆÜÂˆÛÛÜˆ˜\ŠK[]]Y
NÂˆ›Û\Ú^™Nˆ\™[NÂŸB‚‹˜]XÚY[\™]šY]ÈÂˆX\™Ú[‹]ÜˆLœÂˆÜÚ][Ûˆ™[]]™NÂŸB‚‹˜]XÚY[\™]šY]È[YÈÂˆ\Ü^Nˆ›ØÚÎÂˆÚYˆL	NÂˆX^ZZYÚˆŒŒÂˆØš™XİYš]ˆÛİ™\Âˆ›Ü™\‹\˜Y]\ÎˆMœÂŸB‚‹˜]XÚY[\™]šY]È]ÛˆÂˆÜÚ][ÛˆXœÛÛ]NÂˆÜˆÂˆšYÚˆÂˆY[™Îˆœ\Âˆ›Ü™\ˆÂˆ›Ü™\‹\˜Y]\ÎˆNN\Âˆ˜XÚÙÜ›İ[™ˆ™Ø˜JÌ‹LËŠNÂˆÛÛÜˆÚ]NÂˆ›Û\Ú^™NˆÜ™[NÂŸB‚‹™]Z[YX[ÙÈÂˆZ[‹ZZYÚˆ™šÂŸB‚‹™]Z[X›ÙHÂˆY[™ÎˆLœœ\ÂŸB‚‹™]Z[XØ]YÛÜK[[™HÂˆ\Ü^Nˆ›^Âˆ[YÛ‹Z][\ÎˆÙ[\Âˆ\İYKXÛÛ[ˆÜXÙKX™]ÙY[ÂŸB‚‹™]Z[X›ÙHˆÂˆX\™Ú[ˆNLÂˆ›ÛY˜[Z[Nˆ”ÛÛ™İHĞÈ‹Ù\šYÂˆ›Û\Ú^™NˆK\™[NÂˆ[™KZZYÚˆKŒÍNÂŸB‚‹™]Z[X›ÙH˜ÛÛ[]^ÂˆX\™Ú[ˆÂˆÛÛÜˆÍLÍÎÂˆ›Û\Ú^™NˆLœ™[NÂˆ[™KZZYÚˆKÍNÂˆÚ]K\ÜXÙNˆ™K]Ü˜\Âˆİ™\™›İË]Ü˜\ˆ[]Ú\™NÂŸB‚‹™]Z[Z[XYÙHÂˆÚYˆL	NÂˆX^ZZYÚˆLšÂˆX\™Ú[ˆNÂˆØš™XİYš]ˆÛÛZ[Âˆ›Ü™\‹\˜Y]\ÎˆNÂˆ˜XÚÙÜ›İ[™ˆÙX™NYLÂŸB‚‹™]Z[]YÜÈÂˆX\™Ú[‹]ÜˆNÂˆ\Ü^Nˆ›^Âˆ›^]Ü˜\ˆÜ˜\ÂˆØ\ˆÜÂŸB‚‹™]Z[]YÜÈÜ[ˆÂˆY[™Îˆœ\Âˆ›Ü™\‹\˜Y]\ÎˆNN\Âˆ˜XÚÙÜ›İ[™ˆ˜\ŠK\ØYÙK\ÛÙ
NÂˆÛÛÜˆ˜\ŠK\ØYÙJNÂˆ›Û\Ú^™NˆÜ™[NÂŸB‚‹™]Z[\™[Z[™\ˆÂˆX\™Ú[‹]ÜˆNÂˆY[™ÎˆLÜÂˆ›Ü™\‹\˜Y]\ÎˆM\Âˆ˜XÚÙÜ›İ[™ˆ˜\ŠKX[X™\‹\ÛÙ
NÂˆÛÛÜˆÍÙXŒXÂˆ›Û\Ú^™NˆÎ™[NÂŸB‚‹™]Z[XXİ[ÛœÈÂˆX\™Ú[‹]ÜˆŒœÂˆ\Ü^NˆÜšYÂˆÜšY][\]KXÛÛ[[œÎˆYœˆYœÂˆØ\ˆLÂŸB‚‹™[™Ù\‹X]ÛˆÂˆZ[‹ZZYÚˆÂˆ›Ü™\ˆ\ÛÛY™Ø˜JMK‹Ì‹ŒN
NÂˆ›Ü™\‹\˜Y]\ÎˆMÂˆ˜XÚÙÜ›İ[™ˆÙ˜™Y™YÂˆÛÛÜˆ˜\ŠKY[™Ù\ŠNÂŸB‚‹š[™›ËYX[ÙÈÂˆÚYˆZ[ŠØ[ÊL	HHœ
KŒ
NÂˆY[™Îˆ\Âˆ›Ü™\ˆÂˆ›Ü™\‹\˜Y]\ÎˆÂˆ˜XÚÙÜ›İ[™ˆ˜\ŠK\İ\™˜XÙJNÂˆ›Ş\ÚYİÎˆ˜\ŠK\ÚYİÊNÂŸB‚‹š[™›ËZXÛÛˆÂˆ\Ü^NˆÜšYÂˆXÙKZ][\ÎˆÙ[\ÂˆÚYˆÂˆZYÚˆÂˆX\™Ú[ˆ]]ÈLÜÂˆ›Ü™\‹\˜Y]\ÎˆMœÂˆ˜XÚÙÜ›İ[™ˆ˜\ŠK\ØYÙK\ÛÙ
NÂˆÛÛÜˆ˜\ŠK\ØYÙJNÂˆ›Û\Ú^™NˆKŒÜ™[NÂŸB‚‹š[™›ËYX[ÙÈˆÂˆX\™Ú[ˆÂˆ^X[YÛˆÙ[\ÂŸB‚ˆÚ[™›Ğ›ÙHÂˆX\™Ú[ˆLœŒÂˆÛÛÜˆ˜\ŠK[]]Y
NÂˆ›Û\Ú^™Nˆœ™[NÂˆ[™KZZYÚˆKNÂŸB‚ˆÚ[™›Ğ›ÙHÛÂˆY[™Ë[YˆKŒœ™[NÂŸB‚‹Ø\İÂˆÜÚ][Ûˆš^YÂˆ‹Z[™^ˆLÂˆšYÚˆŒÂˆ›İÛNˆØ[Ê
È˜\ŠK\ØY™KX›İÛJJNÂˆYˆŒÂˆX^]ÚYˆŒÂˆX\™Ú[ˆ]]ÎÂˆY[™ÎˆLœMœÂˆ›Ü™\‹\˜Y]\ÎˆMÂˆ˜XÚÙÜ›İ[™ˆ™Ø˜JÌ‹LËM
NÂˆÛÛÜˆÚ]NÂˆ›Û\Ú^™NˆÎ™[NÂˆ^X[YÛˆÙ[\ÂˆÜXÚ]NˆÂˆÚ[\‹Y]™[Îˆ›Û™NÂˆ˜[œÙ›Ü›Nˆ˜[œÛ]VJ
NÂˆ˜[œÚ][ÛˆN\ÈX\ÙNÂŸB‚‹Ø\İœÚİÈÂˆÜXÚ]NˆNÂˆ˜[œÙ›Ü›Nˆ˜[œÛ]VJ
NÂŸB‚‹›ØY[[Ü™HÂˆÚYˆL	NÂˆX\™Ú[‹]ÜˆMÂŸB‚‹šY[ˆÂˆ\Ü^Nˆ›Û™HZ[\Ü[ÂŸB‚YYXH
Z[‹]ÚYˆÌŒ
HÂˆ˜\\Ú[ÂˆY[™Ë\šYÚˆÂˆY[™Ë[YˆÂˆB‚ˆ˜Ø\™[\İœÜXÚ[İ\ÈÂˆÜšY][\]KXÛÛ[[œÎˆYœˆYœÂˆB‚ˆœÙ][™ÜËYÜ›İ\ÂˆY[™ÎˆÂˆBŸB‚YYXH
™Y™\œË\™YXÙY[[İ[Ûˆ™YXÙJHÂˆ
‹ˆ
˜™Y›Ü™Kˆ
˜Y\ˆÂˆØÜ›ÛX™Z]š[Üˆ]]ÈZ[\Ü[Âˆ[š[X][Û‹Y\˜][ÛˆŒ[\ÈZ[\Ü[Âˆ˜[œÚ][Û‹Y\˜][ÛˆŒ[\ÈZ[\Ü[ÂˆBŸB