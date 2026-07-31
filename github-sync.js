import { encryptBytes, encryptJson, decryptBytes, decryptJson } from "./crypto.js";

const API_ROOT = "https://api.github.com";

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToUtf8(value) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function encodePath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export class GitHubSync {
  constructor({ owner, repo, branch = "main", token, passphrase }) {
    this.owner = owner.trim();
    this.repo = repo.trim();
    this.branch = branch.trim() || "main";
    this.token = token.trim();
    this.passphrase = passphrase;
  }

  validate() {
    if (!this.owner || !this.repo || !this.token) {
      throw new Error("请完整填写 GitHub 仓库和访问令牌");
    }
    if (!this.passphrase || this.passphrase.length < 8) {
      throw new Error("加密口令至少需要 8 位");
    }
  }

  async request(path, options = {}) {
    this.validate();
    const response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers
      }
    });
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const body = await response.json();
        message = body.message || message;
      } catch {
        // Keep HTTP message.
      }
      if (response.status === 404) {
        throw new Error("找不到仓库或分支，请确认令牌拥有该私人仓库的 Contents 权限");
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error("GitHub 授权失败，请检查令牌权限");
      }
      throw new Error(`GitHub：${message}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async testConnection() {
    const repository = await this.request(`/repos/${this.owner}/${this.repo}`);
    const branch = await this.request(
      `/repos/${this.owner}/${this.repo}/branches/${encodeURIComponent(this.branch)}`
    );
    return {
      repository: repository.full_name,
      private: repository.private,
      branch: branch.name
    };
  }

  async getFile(path) {
    try {
      return await this.request(
        `/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(this.branch)}`
      );
    } catch (error) {
      if (String(error.message).includes("找不到仓库或分支")) return null;
      throw error;
    }
  }

  async upsertText(path, content, message) {
    const existing = await this.getFile(path);
    const body = {
      message,
      content: utf8ToBase64(content),
      branch: this.branch
    };
    if (existing?.sha) body.sha = existing.sha;
    return this.request(`/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  pathsForEntry(entry) {
    const date = new Date(entry.createdAt);
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const base = `${year}/${month}/${entry.id}`;
    return {
      entry: `data/${base}.json.enc`,
      attachment: `assets/${base}.blob.enc`
    };
  }

  async uploadEntry(entry, attachment) {
    const paths = this.pathsForEntry(entry);
    const cleanEntry = { ...entry };
    delete cleanEntry.syncStatus;
    const encryptedEntry = await encryptJson(cleanEntry, this.passphrase);
    await this.upsertText(paths.entry, encryptedEntry, `sync: ${entry.id}`);

    let remoteAttachmentPath = entry.remoteAttachmentPath || null;
    if (attachment?.blob) {
      const bytes = new Uint8Array(await attachment.blob.arrayBuffer());
      const encryptedAttachment = await encryptBytes(bytes, this.passphrase);
      await this.upsertText(paths.attachment, encryptedAttachment, `sync asset: ${entry.id}`);
      remoteAttachmentPath = paths.attachment;
    }

    return {
      ...entry,
      remoteEntryPath: paths.entry,
      remoteAttachmentPath,
      syncStatus: "synced",
      syncedAt: new Date().toISOString()
    };
  }

  async downloadAttachment(path) {
    const file = await this.getFile(path);
    if (!file?.content) throw new Error("GitHub 中找不到这张图片");
    const envelope = base64ToUtf8(file.content);
    return decryptBytes(envelope, this.passphrase);
  }

  async downloadAllEntries(onProgress = () => {}) {
    const tree = await this.request(
      `/repos/${this.owner}/${this.repo}/git/trees/${encodeURIComponent(this.branch)}?recursive=1`
    );
    const files = (tree.tree || []).filter(
      (item) => item.type === "blob" && /^data\/.+\.json\.enc$/.test(item.path)
    );
    const entries = [];
    for (let index = 0; index < files.length; index += 1) {
      onProgress(index + 1, files.length);
      const file = await this.getFile(files[index].path);
      if (!file?.content) continue;
      const envelope = base64ToUtf8(file.content);
      const entry = await decryptJson(envelope, this.passphrase);
      entries.push({
        ...entry,
        remoteEntryPath: files[index].path,
        remoteAttachmentPath: entry.hasAttachment
          ? entry.remoteAttachmentPath ||
            files[index].path.replace(/^data\//, "assets/").replace(/\.json\.enc$/, ".blob.enc")
          : null,
        syncStatus: "synced"
      });
    }
    return entries;
  }
}
