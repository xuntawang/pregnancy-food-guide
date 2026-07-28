import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM, VirtualConsole } from "jsdom";

import { readIndexHtml } from "./helpers/load-site.mjs";

const html = readIndexHtml();

function loadProductionPage({
  storedChannel = null,
  storageThrows = false,
  clock = null,
} = {}) {
  const scriptErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => scriptErrors.push(error));
  const dom = new JSDOM(html, {
    beforeParse(window) {
      if (storedChannel) {
        window.localStorage.setItem("pregnancy-guide-channel", storedChannel);
      }
      if (storageThrows) {
        window.Storage.prototype.getItem = () => {
          throw new window.DOMException("storage blocked", "SecurityError");
        };
        window.Storage.prototype.setItem = () => {
          throw new window.DOMException("storage blocked", "SecurityError");
        };
      }
      if (clock) {
        const RealDate = window.Date;
        window.Date = class extends RealDate {
          constructor(...args) {
            super(...(args.length ? args : [clock.instant]));
          }

          getFullYear() {
            return clock.year;
          }

          getMonth() {
            return clock.monthIndex;
          }

          getDate() {
            return clock.day;
          }
        };
      }
    },
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://example.test/pregnancy-food-guide/",
    virtualConsole,
  });
  assert.deepEqual(
    scriptErrors.map(({ message }) => message),
    [],
    "生产 index.html 初始化不应抛出脚本错误",
  );
  return dom;
}

function input(window, selector, value) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `缺少生产选择器：${selector}`);
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
  return element;
}

function click(window, selector) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `缺少生产选择器：${selector}`);
  element.click();
  return element;
}

function visibleCardText(document, selector) {
  return [...document.querySelectorAll(selector)].map(({ textContent }) => textContent);
}

test("生产 index.html 主脚本完成初始渲染、频道切换和饮食搜索", () => {
  const dom = loadProductionPage();
  const { window } = dom;
  const { document } = window;

  assert.equal(document.querySelector("#food-channel").hidden, false);
  assert.equal(document.querySelector("#personal-care-channel").hidden, true);
  assert.equal(
    document.querySelector('meta[name="pregnancy-guide-release"]')?.content,
    "2026-07-28-final-fix",
  );
  assert.equal(document.querySelectorAll("#food-grid [data-food-card]").length, 24);
  assert.match(document.querySelector("#result-count").textContent, /^共 \d+ 项，已显示 24 项$/);
  assert.equal(document.querySelectorAll("#personal-care-grid .personal-care-card").length, 24);

  input(window, "#food-search", "生鱼片");
  assert.equal(document.querySelector("#result-count").textContent, "找到 1 项");
  assert.match(document.querySelector("#food-grid").textContent, /生鱼片/);
  assert.match(document.querySelector("#food-grid").textContent, /避免吃/);

  click(window, '[data-channel-target="personal-care"]');
  assert.equal(document.querySelector("#food-channel").hidden, true);
  assert.equal(document.querySelector("#personal-care-channel").hidden, false);
  assert.equal(document.querySelector("#food-search").value, "");
  assert.equal(document.title, "孕期个护速查｜成分、商品与项目建议");
  dom.window.close();
});

test("生产个护搜索与状态、类别筛选实际重绘卡片", () => {
  const dom = loadProductionPage();
  const { window } = dom;
  const { document } = window;
  click(window, '[data-channel-target="personal-care"]');

  input(window, "#personal-care-search", "视黄醇");
  assert.match(document.querySelector("#personal-care-result-count").textContent, /^找到 [1-9]\d* 项$/);
  assert.match(document.querySelector("#personal-care-grid").textContent, /视黄醇/);
  click(window, "#personal-care-clear-search");
  assert.equal(document.querySelector("#personal-care-search").value, "");

  click(window, '[data-personal-care-status="avoid"]');
  click(window, '[data-personal-care-category="护肤"]');
  const cards = [...document.querySelectorAll("#personal-care-grid .personal-care-card")];
  assert.equal(document.querySelector("#personal-care-result-count").textContent, "找到 12 项");
  assert.equal(cards.length, 12);
  assert.ok(cards.every(({ dataset }) => dataset.status === "avoid"));
  dom.window.close();
});

test("生产成分分析事件链识别真实包装格式并可清空", () => {
  const dom = loadProductionPage();
  const { window } = dom;
  const { document } = window;
  click(window, '[data-channel-target="personal-care"]');

  input(
    window,
    "#ingredient-scanner-input",
    "Retinol 1%, Salicylic Acid; Active ingredient: Adapalene 0.1%; Toluene-2,5-Diamine",
  );
  click(window, "#ingredient-scanner-start");
  const result = document.querySelector("#ingredient-scanner-result").textContent;
  assert.match(result, /综合建议：建议避免/);
  assert.match(result, /视黄醇（建议避免）/);
  assert.match(result, /阿达帕林（建议避免）/);
  assert.match(result, /氧化型染发剂中间体（有条件使用）/);

  click(window, "#ingredient-scanner-clear");
  assert.equal(document.querySelector("#ingredient-scanner-input").value, "");
  assert.equal(
    document.querySelector("#ingredient-scanner-result").textContent,
    "输入成分表后，选择“开始分析”。",
  );
  dom.window.close();
});

test("localStorage 异常时生产主脚本仍初始化并允许频道切换", () => {
  const dom = loadProductionPage({ storageThrows: true });
  const { window } = dom;
  const { document } = window;

  assert.equal(document.querySelectorAll("#food-grid [data-food-card]").length, 24);
  click(window, '[data-channel-target="personal-care"]');
  assert.equal(document.querySelector("#personal-care-channel").hidden, false);
  input(window, "#personal-care-search", "染发");
  assert.match(document.querySelector("#personal-care-result-count").textContent, /^找到 [1-9]\d* 项$/);
  dom.window.close();
});

test("刷新后仅恢复频道，不恢复饮食、个护搜索或成分分析内容", () => {
  const first = loadProductionPage();
  const firstWindow = first.window;
  click(firstWindow, '[data-channel-target="personal-care"]');
  input(firstWindow, "#food-search", "咖啡");
  input(firstWindow, "#personal-care-search", "肉毒素");
  input(firstWindow, "#ingredient-scanner-input", "Retinol");
  click(firstWindow, "#ingredient-scanner-start");
  const storedChannel = firstWindow.localStorage.getItem("pregnancy-guide-channel");
  assert.equal(storedChannel, "personal-care");
  first.window.close();

  const refreshed = loadProductionPage({ storedChannel });
  const { document } = refreshed.window;
  assert.equal(document.querySelector("#personal-care-channel").hidden, false);
  assert.equal(document.querySelector("#food-search").value, "");
  assert.equal(document.querySelector("#personal-care-search").value, "");
  assert.equal(document.querySelector("#ingredient-scanner-input").value, "");
  assert.equal(
    document.querySelector("#ingredient-scanner-result").textContent.trim(),
    "输入成分表后，选择“开始分析”。",
  );
  refreshed.window.close();
});

test("固定浏览器搜索用例逐案经过生产 DOM 事件链", async (t) => {
  const cases = [
    { name: "视黄醇", query: "视黄醇", expected: /建议避免/ },
    { name: "水杨酸", query: "水杨酸", expected: /有条件使用/ },
    { name: "染发", query: "染发", expected: /通风/ },
    { name: "肉毒素", query: "肉毒素", expected: /先咨询/ },
    { name: "Differin 商品", query: "Differin", expected: /商品快照[\s\S]*建议避免/ },
  ];

  for (const browserCase of cases) {
    await t.test(browserCase.name, () => {
      const dom = loadProductionPage();
      const { window } = dom;
      click(window, '[data-channel-target="personal-care"]');
      input(window, "#personal-care-search", browserCase.query);
      const cardText = visibleCardText(window.document, "#personal-care-grid .personal-care-card").join("\n");
      assert.match(cardText, browserCase.expected);
      dom.window.close();
    });
  }

  await t.test("未知商品", () => {
    const dom = loadProductionPage();
    const { window } = dom;
    click(window, '[data-channel-target="personal-care"]');
    input(window, "#personal-care-search", "不存在品牌神秘精华");
    assert.equal(window.document.querySelector("#personal-care-result-count").textContent, "0 项结果");
    assert.match(
      window.document.querySelector("[data-personal-care-empty]").textContent,
      /(?:粘贴.*成分表|成分表.*粘贴)/,
    );
    dom.window.close();
  });
});

test("固定成分表用例逐案经过生产 DOM 事件链", async (t) => {
  const cases = [
    {
      name: "混合分隔符与重复成分",
      input: "Retinol，Glycerin; Retinol\nWater",
      expected: /共识别 3 项；命中 2 项规则；1 项未识别/,
    },
    {
      name: "高风险加通常可用",
      input: "Retinol, Glycerin, Water",
      expected: /综合建议：建议避免/,
    },
    {
      name: "限制加未知",
      input: "Salicylic Acid, Mystery Extract",
      expected: /综合建议：有条件使用[\s\S]*1 项未识别/,
    },
    {
      name: "超过 200 项截断",
      input: Array.from({ length: 201 }, (_, index) => `Mystery ${index}`).join(","),
      expected: /输入超过 200 项，结果已截断/,
    },
  ];

  for (const scannerCase of cases) {
    await t.test(scannerCase.name, () => {
      const dom = loadProductionPage();
      const { window } = dom;
      click(window, '[data-channel-target="personal-care"]');
      input(window, "#ingredient-scanner-input", scannerCase.input);
      click(window, "#ingredient-scanner-start");
      assert.match(window.document.querySelector("#ingredient-scanner-result").textContent, scannerCase.expected);
      dom.window.close();
    });
  }

  await t.test("空输入", () => {
    const dom = loadProductionPage();
    const { window } = dom;
    click(window, '[data-channel-target="personal-care"]');
    click(window, "#ingredient-scanner-start");
    assert.equal(
      window.document.querySelector("#ingredient-scanner-result").textContent,
      "请先输入包装上的成分表。",
    );
    dom.window.close();
  });
});

for (const boundary of [
  {
    name: "UTC+8 次日凌晨按本地第 366 天降级",
    clock: { instant: "2027-07-28T16:30:00.000Z", year: 2027, monthIndex: 6, day: 29 },
    expectStale: true,
  },
  {
    name: "负时区前一日晚间按本地第 365 天保持有效",
    clock: { instant: "2027-07-29T05:30:00.000Z", year: 2027, monthIndex: 6, day: 28 },
    expectStale: false,
  },
]) {
  test(`生产商品卡：${boundary.name}`, () => {
    const dom = loadProductionPage({ clock: boundary.clock });
    const { window } = dom;
    click(window, '[data-channel-target="personal-care"]');
    input(window, "#personal-care-search", "适乐肤止痒保湿霜");
    const card = window.document.querySelector("#personal-care-grid .personal-care-card");
    assert.ok(card);
    assert.equal(Boolean(card.querySelector(".stale-note")), boundary.expectStale);
    dom.window.close();
  });
}
