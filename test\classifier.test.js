import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyContent,
  deriveTitle,
  detectDate,
  extractUrl
} from "../classifier.js";

test("根据电商域名自动归入想买", () => {
  const result = classifyContent("这双鞋不错 https://item.jd.com/123.html");
  assert.equal(result.category, "buy");
});

test("根据视频域名自动归入想看", () => {
  const result = classifyContent("https://www.bilibili.com/video/BV123");
  assert.equal(result.category, "watch");
});

test("根据提醒词和日期自动归入待办", () => {
  const result = classifyContent("明天下午三点记得取消视频会员");
  assert.equal(result.category, "todo");
});

test("普通内容默认归入笔记而不是未整理", () => {
  const result = classifyContent("今天在路上看到很好看的晚霞");
  assert.equal(result.category, "note");
});

test("识别明天下午三点", () => {
  const now = new Date("2026-07-31T08:00:00+08:00");
  const result = detectDate("明天下午3点提醒我", now);
  assert.ok(result);
  assert.equal(result.date.getDate(), 1);
  assert.equal(result.date.getHours(), 15);
});

test("识别中文月日", () => {
  const now = new Date("2026-07-31T08:00:00+08:00");
  const result = detectDate("8月15日上午9点取消会员", now);
  assert.ok(result);
  assert.equal(result.date.getMonth(), 7);
  assert.equal(result.date.getDate(), 15);
  assert.equal(result.date.getHours(), 9);
});

test("提取链接和标题", () => {
  const text = "杭州旅行攻略\nhttps://example.com/hangzhou";
  assert.equal(extractUrl(text), "https://example.com/hangzhou");
  assert.equal(deriveTitle(text), "杭州旅行攻略");
});
