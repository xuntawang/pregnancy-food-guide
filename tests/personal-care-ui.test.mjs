import assert from "node:assert/strict";
import test from "node:test";

import { readIndexHtml } from "./helpers/load-site.mjs";

const html = readIndexHtml();

function tagWithAttribute(tagName, attributeName, value) {
  const tags = html.match(new RegExp(`<${tagName}\\b[^>]*>`, "gi")) ?? [];
  return tags.find((tag) => new RegExp(`\\b${attributeName}=(["'])${value}\\1`, "i").test(tag));
}

function executableScripts(markup) {
  return [...markup.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(([, attributes]) => {
      const type = attributes.match(/\btype=(["'])(.*?)\1/i)?.[2]
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase();
      return type === undefined || ["text/javascript", "application/javascript"].includes(type);
    })
    .map((match) => match[2])
    .join("\n");
}

test("统一页提供语义化双频道且默认显示饮食", () => {
  const switcher = html.match(/<nav\b[^>]*class=(["'])[^"']*\bchannel-switch\b[^"']*\1[^>]*aria-label=(["'])速查类型\2[^>]*>([\s\S]*?)<\/nav>/i);
  assert.ok(switcher, "缺少标为“速查类型”的频道导航");

  const foodTab = tagWithAttribute("button", "data-channel-target", "food");
  const personalCareTab = tagWithAttribute("button", "data-channel-target", "personal-care");
  assert.match(foodTab ?? "", /\brole=(["'])tab\1/i);
  assert.match(foodTab ?? "", /\baria-selected=(["'])true\1/i);
  assert.match(personalCareTab ?? "", /\brole=(["'])tab\1/i);
  assert.match(personalCareTab ?? "", /\baria-selected=(["'])false\1/i);

  assert.ok(tagWithAttribute("section", "id", "food-channel"), "缺少饮食频道容器");
  assert.match(tagWithAttribute("section", "id", "personal-care-channel") ?? "", /\bhidden\b/i);
});

test("个护频道提供生活化搜索、九类快捷筛选和四种状态筛选", () => {
  const search = tagWithAttribute("input", "id", "personal-care-search");
  assert.match(search ?? "", /placeholder=(["'])搜成分、商品或项目，如：视黄醇、防晒霜、染发\1/);

  const categories = [...html.matchAll(/\bdata-personal-care-category=(["'])(.*?)\1/gi)]
    .map((match) => match[2]);
  assert.deepEqual(categories, [
    "护肤",
    "防晒",
    "彩妆",
    "洗发护发",
    "口腔",
    "身体护理",
    "美甲美睫",
    "美容项目",
    "医美项目",
  ]);

  const statuses = [...html.matchAll(/\bdata-personal-care-status=(["'])(.*?)\1/gi)]
    .map((match) => match[2]);
  assert.deepEqual(statuses, ["safe", "limit", "avoid", "consult"]);
  assert.ok(tagWithAttribute("p", "id", "personal-care-result-count"), "缺少个护结果数量");
  assert.ok(tagWithAttribute("div", "data-personal-care-empty", ""), "缺少个护无结果提示");
});

test("成分表分析器需要用户明确操作并向辅助技术宣布结果", () => {
  assert.ok(tagWithAttribute("textarea", "id", "ingredient-scanner-input"));
  assert.ok(tagWithAttribute("button", "id", "ingredient-scanner-start"));
  assert.ok(tagWithAttribute("button", "id", "ingredient-scanner-clear"));
  assert.ok(tagWithAttribute("button", "data-scanner-demo", ""));
  assert.match(html, /演示内容/);

  const liveRegion = tagWithAttribute("div", "id", "ingredient-scanner-result");
  assert.match(liveRegion ?? "", /\baria-live=(["'])polite\1/i);
  assert.doesNotMatch(executableScripts(html), /navigator\.clipboard|clipboard\.read/i);
});

test("个护说明区分证据、未知项与紧急或偶发情况", () => {
  assert.ok(tagWithAttribute("details", "data-evidence-disclosure", ""));
  assert.match(html, /配方来源/);
  assert.match(html, /医学依据/);
  assert.match(html, /怎么判断的/);
  assert.match(html, /运行时不使用 AI/);
  assert.match(html, /未知成分[^。；]*不[^。；]*放心使用/);
  assert.match(html, /呼吸困难、面唇肿胀、广泛水疱、昏厥或其他严重反应：立即寻求医疗帮助。/);
  assert.match(html, /无症状的一次误用/);
  assert.match(html, /常规产检时咨询/);
  assert.match(html, /<noscript\b/i);
});

test("应用只持久化频道且不依赖运行时网络资源", () => {
  const scripts = executableScripts(html);
  const storageCalls = [...scripts.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*(["'])(.*?)\1/g)]
    .map((match) => match[2]);
  assert.ok(storageCalls.length >= 2, "频道需要可恢复地写入本地存储");
  assert.deepEqual([...new Set(storageCalls)], ["pregnancy-guide-channel"]);

  assert.doesNotMatch(scripts, /\b(?:fetch|XMLHttpRequest|WebSocket)\b/);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(html, /<link\b[^>]*\brel=(["'])stylesheet\1/i);
  assert.doesNotMatch(html, /@import\s+(?:url\()?["']?https?:/i);
});
