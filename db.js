const DB_NAME = "shipian";
const DB_VERSION = 1;
const ENTRIES = "entries";
const ATTACHMENTS = "attachments";
const META = "meta";

let dbPromise;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ENTRIES)) {
        const entries = db.createObjectStore(ENTRIES, { keyPath: "id" });
        entries.createIndex("createdAt", "createdAt");
        entries.createIndex("category", "category");
        entries.createIndex("reminderAt", "reminderAt");
        entries.createIndex("syncStatus", "syncStatus");
      }
      if (!db.objectStoreNames.contains(ATTACHMENTS)) {
        db.createObjectStore(ATTACHMENTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function store(name, mode = "readonly") {
  const db = await openDatabase();
  return db.transaction(name, mode).objectStore(name);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllEntries() {
  return requestResult((await store(ENTRIES)).getAll());
}

export async function getEntry(id) {
  return requestResult((await store(ENTRIES)).get(id));
}

export async function saveEntry(entry) {
  return requestResult((await store(ENTRIES, "readwrite")).put(entry));
}

export async function deleteEntry(id) {
  const db = await openDatabase();
  const tx = db.transaction([ENTRIES, ATTACHMENTS], "readwrite");
  tx.objectStore(ENTRIES).delete(id);
  tx.objectStore(ATTACHMENTS).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveAttachment(id, blob) {
  return requestResult(
    (await store(ATTACHMENTS, "readwrite")).put({
      id,
      blob,
      size: blob.size,
      type: blob.type,
      updatedAt: new Date().toISOString()
    })
  );
}

export async function getAttachment(id) {
  return requestResult((await store(ATTACHMENTS)).get(id));
}

export async function deleteAttachment(id) {
  return requestResult((await store(ATTACHMENTS, "readwrite")).delete(id));
}

export async function getMeta(key) {
  const value = await requestResult((await store(META)).get(key));
  return value?.value;
}

export async function setMeta(key, value) {
  return requestResult((await store(META, "readwrite")).put({ key, value }));
}

export async function estimateLocalUsage() {
  const [entries, attachmentRows] = await Promise.all([
    getAllEntries(),
    requestResult((await store(ATTACHMENTS)).getAll())
  ]);
  const textBytes = new Blob([JSON.stringify(entries)]).size;
  const attachmentBytes = attachmentRows.reduce((sum, item) => sum + (item.size || 0), 0);
  return {
    textBytes,
    attachmentBytes,
    totalBytes: textBytes + attachmentBytes,
    entryCount: entries.length,
    attachmentCount: attachmentRows.length
  };
}

export async function clearSyncedAttachmentCache() {
  const entries = await getAllEntries();
  const synced = entries.filter((entry) => entry.remoteAttachmentPath);
  const db = await openDatabase();
  const tx = db.transaction(ATTACHMENTS, "readwrite");
  synced.forEach((entry) => tx.objectStore(ATTACHMENTS).delete(entry.id));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(synced.length);
    tx.onerror = () => reject(tx.error);
  });
}

export async function exportDatabase() {
  const [entries, attachments] = await Promise.all([
    getAllEntries(),
    requestResult((await store(ATTACHMENTS)).getAll())
  ]);
  const serializedAttachments = [];
  for (const item of attachments) {
    const bytes = new Uint8Array(await item.blob.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    serializedAttachments.push({
      id: item.id,
      type: item.type,
      data: btoa(binary)
    });
  }
  return {
    format: "shipian-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
    attachments: serializedAttachments
  };
}

export async function importDatabase(payload) {
  if (payload?.format !== "shipian-backup" || !Array.isArray(payload.entries)) {
    throw new Error("这不是有效的拾片备份文件");
  }
  const existing = new Map((await getAllEntries()).map((entry) => [entry.id, entry]));
  let imported = 0;
  for (const entry of payload.entries) {
    const current = existing.get(entry.id);
    if (!current || new Date(entry.updatedAt) > new Date(current.updatedAt)) {
      await saveEntry(entry);
      imported += 1;
    }
  }
  for (const attachment of payload.attachments ?? []) {
    const binary = atob(attachment.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    await saveAttachment(attachment.id, new Blob([bytes], { type: attachment.type }));
  }
  return imported;
}
