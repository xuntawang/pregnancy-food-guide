import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { extractScript, readIndexHtml } from "./helpers/load-site.mjs";

const html = readIndexHtml();
const styles = html.match(/<style>([\s\S]*?)<\/style>/i)?.[1] ?? "";

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

function loadUiHelpers() {
  try {
    const context = {};
    vm.runInNewContext(extractScript(html, "personal-care-ui-helpers"), context);
    return context.personalCareUIHelpers ?? null;
  } catch {
    return null;
  }
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test("统一页提供完整 ARIA tabs 关系且默认只有饮食 tab 可顺序聚焦", () => {
  const switcher = html.match(/<nav\b[^>]*class=(["'])[^"']*\bchannel-switch\b[^"']*\1[^>]*aria-label=(["'])速查类型\2[^>]*>([\s\S]*?)<\/nav>/i);
  assert.ok(switcher, "缺少标为“速查类型”的频道导航");
  assert.match(switcher[0], /\brole=(["'])tablist\1/i);

  const foodTab = tagWithAttribute("button", "data-channel-target", "food");
  const personalCareTab = tagWithAttribute("button", "data-channel-target", "personal-care");
  assert.match(foodTab ?? "", /\brole=(["'])tab\1/i);
  assert.match(foodTab ?? "", /\bid=(["'])channel-tab-food\1/i);
  assert.match(foodTab ?? "", /\baria-controls=(["'])food-channel\1/i);
  assert.match(foodTab ?? "", /\baria-selected=(["'])true\1/i);
  assert.match(foodTab ?? "", /\btabindex=(["'])0\1/i);
  assert.match(personalCareTab ?? "", /\brole=(["'])tab\1/i);
  assert.match(personalCareTab ?? "", /\bid=(["'])channel-tab-personal-care\1/i);
  assert.match(personalCareTab ?? "", /\baria-controls=(["'])personal-care-channel\1/i);
  assert.match(personalCareTab ?? "", /\baria-selected=(["'])false\1/i);
  assert.match(personalCareTab ?? "", /\btabindex=(["'])-1\1/i);

  const foodPanel = tagWithAttribute("section", "id", "food-channel");
  const personalCarePanel = tagWithAttribute("section", "id", "personal-care-channel");
  assert.match(foodPanel ?? "", /\brole=(["'])tabpanel\1/i);
  assert.match(foodPanel ?? "", /\baria-labelledby=(["'])channel-tab-food\1/i);
  assert.doesNotMatch(foodPanel ?? "", /\bhidden\b/i);
  assert.match(personalCarePanel ?? "", /\brole=(["'])tabpanel\1/i);
  assert.match(personalCarePanel ?? "", /\baria-labelledby=(["'])channel-tab-personal-care\1/i);
  assert.match(personalCarePanel ?? "", /\bhidden\b/i);
});

test("频道状态模型同步 selected、roving tabindex 与面板隐藏状态", () => {
  const helpers = loadUiHelpers();
  assert.ok(helpers, "缺少可执行的个护 UI 辅助层");

  assert.deepEqual(plain(helpers.channelPresentation("food")), {
    food: { selected: true, tabIndex: 0, panelHidden: false },
    "personal-care": { selected: false, tabIndex: -1, panelHidden: true },
  });
  assert.deepEqual(plain(helpers.channelPresentation("personal-care")), {
    food: { selected: false, tabIndex: -1, panelHidden: true },
    "personal-care": { selected: true, tabIndex: 0, panelHidden: false },
  });
  assert.equal(helpers.nextChannel("food", "ArrowRight"), "personal-care");
  assert.equal(helpers.nextChannel("personal-care", "ArrowLeft"), "food");
});

test("频道 transient reset 清空搜索筛选与扫描结果且不调用 focus", () => {
  const helpers = loadUiHelpers();
  assert.ok(helpers, "缺少可执行的个护 UI 辅助层");
  let focusCalls = 0;
  const focusableField = (value) => ({ value, focus: () => { focusCalls += 1; } });
  const foodState = { query: "咖啡", status: "limit", category: "饮品", visibleLimit: 72 };
  const personalCareState = { query: "视黄醇", status: "avoid", category: "护肤" };
  const foodSearch = focusableField("咖啡");
  const personalCareSearch = focusableField("视黄醇");
  const scannerInput = focusableField("Retinol, Mystery");
  const scannerResult = { textContent: "综合建议：建议避免", focus: () => { focusCalls += 1; } };

  helpers.resetTransientState({
    foodState,
    personalCareState,
    foodSearch,
    personalCareSearch,
    scannerInput,
    scannerResult,
  });

  assert.deepEqual(foodState, { query: "", status: "all", category: "all", visibleLimit: 24 });
  assert.deepEqual(personalCareState, { query: "", status: "all", category: "all" });
  assert.equal(foodSearch.value, "");
  assert.equal(personalCareSearch.value, "");
  assert.equal(scannerInput.value, "");
  assert.equal(scannerResult.textContent, "输入成分表后，选择“开始分析”。");
  assert.equal(focusCalls, 0);
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

test("未知商品空状态引导用户粘贴包装成分表", () => {
  const emptyState = html.match(/<div\b[^>]*data-personal-care-empty[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
  assert.match(emptyState, /(?:粘贴[^。；]*成分表|成分表[^。；]*粘贴)/);
  assert.match(emptyState, /不认识的成分不会被当作“可以用”/);
});

test("移动端主要交互控件保持至少 44px 触控高度", () => {
  assert.match(styles, /\.skip-link\s*\{[^}]*min-height:\s*44px/s);
  assert.match(styles, /\.clear-search\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s);
  assert.match(styles, /\.filter-button,\s*\.category-button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(styles, /\.channel-switch button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(styles, /\.evidence-disclosure summary\s*\{[^}]*min-height:\s*44px/s);
  assert.match(styles, /\.primary-button,\s*\.secondary-button\s*\{[^}]*min-height:\s*44px/s);
});

test("Chrome 搜索框只显示站点提供的单一清除按钮", () => {
  assert.match(
    styles,
    /input\[type="search"\]::?-webkit-search-cancel-button\s*\{[^}]*-webkit-appearance:\s*none;[^}]*appearance:\s*none;/s,
  );
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

for (const [count, omitted] of [[35, 5], [200, 170]]) {
  test(`成分表 UI 对 ${count} 个未知项明确说明未展示数量`, () => {
    const helpers = loadUiHelpers();
    assert.ok(helpers, "缺少可执行的个护 UI 辅助层");
    const unresolved = Array.from({ length: count }, (_, index) => `unknown-${index + 1}`);
    const presentation = helpers.scannerPresentation({
      tokens: unresolved,
      matches: [],
      unresolved,
      truncated: false,
      overallStatus: "consult",
    });

    assert.equal(presentation.summary, `共识别 ${count} 项；命中 0 项规则；${count} 项未识别。`);
    assert.equal(presentation.unresolvedItems.length, 30);
    assert.equal(presentation.unresolvedItems[0], "unknown-1");
    assert.equal(presentation.unresolvedItems[29], "unknown-30");
    assert.equal(presentation.unresolvedOmitted, omitted);
    assert.equal(presentation.unresolvedNotice, `另有 ${omitted} 项未展示；请分段核对。`);
  });
}

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
