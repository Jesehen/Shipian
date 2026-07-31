export const CATEGORIES = {
  note: { label: "笔记", glyph: "记" },
  buy: { label: "想买", glyph: "购" },
  watch: { label: "想看", glyph: "看" },
  go: { label: "想去", glyph: "去" },
  todo: { label: "待办", glyph: "办" }
};

const DOMAIN_RULES = [
  {
    category: "buy",
    domains: [
      "taobao.com",
      "tmall.com",
      "jd.com",
      "smzdm.com",
      "amazon.",
      "yangkeduo.com",
      "pinduoduo.com",
      "suning.com",
      "vip.com",
      "dewu.com",
      "kaola.com"
    ]
  },
  {
    category: "watch",
    domains: [
      "bilibili.com",
      "youtube.com",
      "youtu.be",
      "douban.com",
      "iqiyi.com",
      "v.qq.com",
      "youku.com",
      "mgtv.com",
      "netflix.com",
      "xiaohongshu.com",
      "zhihu.com",
      "mp.weixin.qq.com",
      "weibo.com"
    ]
  },
  {
    category: "go",
    domains: [
      "maps.apple.com",
      "maps.google.",
      "amap.com",
      "dianping.com",
      "trip.com",
      "ctrip.com",
      "booking.com",
      "meituan.com",
      "qunar.com",
      "fliggy.com",
      "mafengwo.cn",
      "airbnb."
    ]
  }
];

const KEYWORD_RULES = [
  {
    category: "note",
    weight: 4,
    words: [
      "笔记",
      "记录一下",
      "随记",
      "日记",
      "灵感",
      "想法",
      "摘抄",
      "金句",
      "心得",
      "总结",
      "观后感",
      "读后感",
      "备忘"
    ]
  },
  {
    category: "todo",
    weight: 5,
    words: [
      "记得",
      "别忘",
      "需要",
      "待办",
      "完成",
      "处理",
      "提交",
      "回复",
      "取消",
      "缴费",
      "续费",
      "预约",
      "打电话",
      "提醒",
      "要做",
      "去办",
      "办理",
      "截止",
      "到期",
      "开会",
      "会议",
      "交作业",
      "还款",
      "取快递",
      "寄快递",
      "复诊",
      "吃药",
      "报名",
      "申请",
      "联系",
      "发邮件",
      "打印",
      "报销",
      "签到",
      "清理",
      "检查"
    ]
  },
  {
    category: "buy",
    weight: 4,
    words: [
      "想买",
      "购买",
      "下单",
      "价格",
      "优惠",
      "折扣",
      "元",
      "补货",
      "购物",
      "型号",
      "到手价",
      "入手",
      "买一个",
      "买点",
      "加入购物车",
      "购物车",
      "好价",
      "比价",
      "降价",
      "优惠券",
      "领券",
      "包邮",
      "凑单",
      "预售",
      "定金",
      "尾款",
      "缺货",
      "预算",
      "尺码",
      "配色",
      "配置",
      "值得买",
      "性价比"
    ]
  },
  {
    category: "watch",
    weight: 4,
    words: [
      "想看",
      "电影",
      "电视剧",
      "纪录片",
      "视频",
      "书",
      "文章",
      "阅读",
      "播客",
      "剧集",
      "片单",
      "影单",
      "书单",
      "小说",
      "漫画",
      "动漫",
      "综艺",
      "节目",
      "课程",
      "教程",
      "论文",
      "新闻",
      "访谈",
      "音乐",
      "专辑",
      "歌曲",
      "有声书",
      "稍后看",
      "收藏阅读",
      "推荐看",
      "上映"
    ]
  },
  {
    category: "go",
    weight: 4,
    words: [
      "想去",
      "餐厅",
      "咖啡馆",
      "酒店",
      "民宿",
      "旅行",
      "地址",
      "路线",
      "景点",
      "公园",
      "展览",
      "探店",
      "打卡",
      "菜馆",
      "酒吧",
      "面包店",
      "火锅",
      "烧烤",
      "景区",
      "博物馆",
      "美术馆",
      "商场",
      "夜市",
      "徒步",
      "露营",
      "爬山",
      "海边",
      "航班",
      "车票",
      "门票",
      "行程",
      "攻略",
      "周边游",
      "度假",
      "出发",
      "导航",
      "位置"
    ]
  }
];

const URL_REGEX = /https?:\/\/[^\s<>"']+/i;

export function extractUrl(text = "") {
  return text.match(URL_REGEX)?.[0] ?? "";
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function classifyContent(text = "") {
  const normalized = text.trim().toLowerCase();
  const url = extractUrl(normalized);
  const hostname = hostnameFromUrl(url);

  for (const rule of DOMAIN_RULES) {
    if (rule.domains.some((domain) => hostname.includes(domain))) {
      return { category: rule.category, confidence: 0.96, reason: "网址来源" };
    }
  }

  const scores = { note: 1, buy: 0, watch: 0, go: 0, todo: 0 };
  const matched = [];
  for (const rule of KEYWORD_RULES) {
    for (const word of rule.words) {
      if (normalized.includes(word)) {
        scores[rule.category] += rule.weight;
        matched.push(word);
      }
    }
  }

  if (
    detectDate(normalized) &&
    (/(提醒|记得|别忘|待办|需要|计划|预约|取消|提交|完成)/.test(normalized) ||
      /(?:上午|下午|晚上|中午|早上)?\s*\d{1,2}(?:[:：点时])\d{0,2}/.test(normalized) ||
      /(明天|后天|周末|下周)/.test(normalized))
  ) {
    scores.todo += 3;
  }

  const [category, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return {
    category,
    confidence: Math.min(0.95, 0.45 + score * 0.08),
    reason: matched.length ? `关键词：${matched.slice(0, 2).join("、")}` : "默认笔记"
  };
}

function atTime(date, hours = 9, minutes = 0) {
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function parseClock(text, fallbackHour = 9) {
  const clock =
    text.match(/(上午|下午|晚上|中午|早上)\s*(\d{1,2})(?:[:：点时](\d{1,2})?)?/) ||
    text.match(/()(\d{1,2})[:：点时](\d{1,2})?/);
  if (!clock) return { hour: fallbackHour, minute: 0 };
  let hour = Number(clock[2]);
  const minute = Number(clock[3] || 0);
  if (/下午|晚上/.test(clock[1]) && hour < 12) hour += 12;
  if (/中午/.test(clock[1]) && hour < 11) hour += 12;
  return { hour: Math.min(hour, 23), minute: Math.min(minute, 59) };
}

export function detectDate(text = "", now = new Date()) {
  const normalized = text.replace(/\s+/g, " ");
  const { hour, minute } = parseClock(normalized);
  const base = new Date(now);

  if (normalized.includes("后天")) {
    base.setDate(base.getDate() + 2);
    return { date: atTime(base, hour, minute), label: "后天" };
  }
  if (normalized.includes("明天")) {
    base.setDate(base.getDate() + 1);
    return { date: atTime(base, hour, minute), label: "明天" };
  }
  if (normalized.includes("今天")) {
    return { date: atTime(base, hour, minute), label: "今天" };
  }
  if (/本周末|周末/.test(normalized)) {
    const day = base.getDay();
    const delta = day === 0 ? 6 : 6 - day;
    base.setDate(base.getDate() + delta);
    return { date: atTime(base, hour, minute), label: "本周六" };
  }

  const weekdayMatch = normalized.match(/(?:下周|本周|周|星期)([一二三四五六日天])/);
  if (weekdayMatch) {
    const target = "一二三四五六日".indexOf(weekdayMatch[1]) + 1;
    const current = base.getDay() || 7;
    let delta = target - current;
    if (normalized.includes("下周")) delta += delta <= 0 ? 7 : 7;
    else if (delta <= 0) delta += 7;
    base.setDate(base.getDate() + delta);
    return { date: atTime(base, hour, minute), label: weekdayMatch[0] };
  }

  const fullDate = normalized.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]?/);
  if (fullDate) {
    const year = Number(fullDate[1] || base.getFullYear());
    const month = Number(fullDate[2]) - 1;
    const day = Number(fullDate[3]);
    const result = new Date(year, month, day, hour, minute);
    if (!fullDate[1] && result < base) result.setFullYear(result.getFullYear() + 1);
    return { date: result, label: fullDate[0] };
  }

  return null;
}

export function deriveTitle(text = "", customTitle = "") {
  if (customTitle.trim()) return customTitle.trim().slice(0, 80);
  const withoutUrl = text.replace(URL_REGEX, "").trim();
  const firstLine = withoutUrl.split(/\r?\n/).find(Boolean)?.trim();
  if (firstLine) return firstLine.slice(0, 46);
  const url = extractUrl(text);
  if (url) {
    const hostname = hostnameFromUrl(url);
    return hostname ? `来自 ${hostname} 的链接` : "收藏的链接";
  }
  return "新的片段";
}

export function formatCategory(category) {
  return CATEGORIES[category] ?? CATEGORIES.note;
}
