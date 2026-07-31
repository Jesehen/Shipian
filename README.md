# 拾片

拾片是一款为 iPhone 设计的轻量 PWA，用来随手保存生活中的文字、链接、图片和待办。它会用本地规则自动归类，提醒直接附着在原内容上，不需要“未整理”收件箱，也不依赖 AI API。

## 第一版功能

- 自动归类：笔记、想买、想看、想去、待办
- 内容内添加提醒，统一在提醒页查看
- 中文日期提示：今天、明天、后天、周末、星期、月日
- 图片单张压缩，最长边 1600px
- 本地缓存硬上限 50MB
- IndexedDB 离线存储
- 本地全文关键词搜索
- JSON 导入和导出
- 加密同步到 GitHub 私人仓库
- 从 GitHub 恢复较新的加密记录，图片保持按需下载
- 已同步图片可清理并按需恢复
- 苹果快捷指令入口和 `.ics` 日历提醒
- 可添加到 iPhone 主屏幕

## 在 iPhone 上安装

1. 使用 Safari 打开部署地址。
2. 点击“分享”。
3. 选择“添加到主屏幕”。
4. 保持“作为网页 App 打开”并确认。

## GitHub 数据同步

建议另外创建一个名为 `shipian-data` 的 **Private** 仓库作为数据仓库。

1. 创建一个 fine-grained personal access token。
2. 只授权给数据仓库。
3. Repository permissions 只开启 `Contents: Read and write`。
4. 在拾片的“设置 → 私人仓库同步”中填写仓库、令牌和加密口令。

令牌与加密口令只保存在当前浏览器会话中；仓库名称和分支可以持久保存。内容和图片在上传前使用 AES-256-GCM 加密，密钥通过 PBKDF2-SHA256 从口令派生。

> Git 历史不会因为普通删除而自动清除，因此不要把口令或恢复密钥上传到数据仓库。忘记加密口令后，远端数据无法恢复。

## 苹果提醒事项

应用内提醒始终可用。若需要 PWA 关闭后仍由 iPhone 系统通知，可创建一条名为“拾片提醒”的快捷指令：

1. 接收文本输入。
2. 用“从输入中获取字典”解析 JSON。
3. 读取 `title` 与 `date`。
4. 使用“新建提醒事项”写入苹果提醒事项。

在片段详情中点击“加入系统提醒”，拾片会通过 `shortcuts://` 运行它。也可以使用“导出日历提醒”生成 `.ics` 文件。

## 本地运行

项目不依赖 npm 包。使用任意静态服务器即可：

```powershell
python -m http.server 4173
```

然后访问 `http://localhost:4173`。

## 检查

```powershell
cmd /c npm test
cmd /c npm run check
```

可选的移动端浏览器流程测试需要安装 Playwright 与 Chromium：

```powershell
cmd /c npm install
cmd /c npx playwright install chromium
cmd /c npm run test:e2e
```

## 部署

仓库包含 GitHub Pages 工作流。推送到 `main` 后，在仓库设置中将 Pages 的 Source 设为 **GitHub Actions**，工作流会发布静态站点。
