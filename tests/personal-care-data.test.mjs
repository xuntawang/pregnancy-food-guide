import assert from "node:assert/strict";
import test from "node:test";

import { extractJsonScript, readIndexHtml } from "./helpers/load-site.mjs";

const html = readIndexHtml();
const sources = extractJsonScript(html, "personal-care-sources");
const ingredients = extractJsonScript(html, "personal-care-ingredients");
const sourceIds = new Set(sources.map(({ id }) => id));
const validStatuses = new Set(["safe", "limit", "avoid", "consult"]);
const conditionKeys = [
  "rinseOff",
  "leaveOn",
  "area",
  "frequency",
  "concentration",
  "trimester",
  "ventilation",
  "brokenSkin",
];

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function normalizeAlias(value) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
}

test("来源台账数据具有唯一且可追溯的权威来源", () => {
  assert.ok(sources.length >= 12, `来源过少：${sources.length}`);
  assert.equal(new Set(sources.map(({ id }) => id)).size, sources.length, "来源 ID 必须唯一");

  for (const source of sources) {
    assert.ok(source.id, "来源缺少 ID");
    assert.ok(source.organization?.trim(), `${source.id} 缺少机构`);
    assert.ok(source.title?.trim(), `${source.id} 缺少标题`);
    assert.match(source.url, /^https:\/\//, `${source.id} 不是 HTTPS 链接`);
    assert.ok(validDate(source.accessed), `${source.id} 的访问日期无效`);
    assert.ok(Array.isArray(source.topics) && source.topics.length > 0, `${source.id} 缺少主题`);
  }
});

test("至少 80 条医学上可区分的成分规则满足完整数据契约", () => {
  assert.ok(ingredients.length >= 80, `成分规则不足 80 条：${ingredients.length}`);
  assert.equal(new Set(ingredients.map(({ id }) => id)).size, ingredients.length, "规则 ID 必须唯一");

  for (const rule of ingredients) {
    assert.ok(rule.id, "规则缺少 ID");
    assert.ok(rule.family?.trim(), `${rule.id} 缺少成分家族`);
    assert.ok(rule.category?.trim(), `${rule.id} 缺少分类`);
    assert.ok(validStatuses.has(rule.status), `${rule.id} 状态无效`);
    assert.ok(validDate(rule.reviewed), `${rule.id} 的复核日期无效`);
    assert.ok(rule.summary?.trim(), `${rule.id} 缺少简短结论`);
    assert.ok(rule.rationale?.trim(), `${rule.id} 缺少理由`);
    assert.ok(rule.names && ["zh", "en", "inci", "aliases"].every(
      (key) => Array.isArray(rule.names[key]),
    ), `${rule.id} 名称结构无效`);
    assert.ok(Object.keys(rule.names).some(
      (key) => rule.names[key].some((name) => name.trim()),
    ), `${rule.id} 至少需要一个名称`);
    assert.deepEqual(Object.keys(rule.conditions).sort(), [...conditionKeys].sort(), `${rule.id} 限制条件结构无效`);
    assert.ok(Array.isArray(rule.alternatives), `${rule.id} 替代方案必须是数组`);
    assert.ok(Array.isArray(rule.sourceIds) && rule.sourceIds.length > 0, `${rule.id} 缺少权威来源`);
    for (const sourceId of rule.sourceIds) {
      assert.ok(sourceIds.has(sourceId), `${rule.id} 引用了不存在的来源 ${sourceId}`);
    }
    if (rule.status === "limit") {
      assert.ok(conditionKeys.some((key) => rule.conditions[key]?.trim()), `${rule.id} 没有写明限制条件`);
    }
    if (rule.status === "avoid") {
      assert.ok(rule.alternatives.length > 0, `${rule.id} 没有提供替代方案`);
    }
  }
});

test("不同规则没有会导致精确匹配歧义的规范化名称", () => {
  const claimed = new Map();
  for (const rule of ingredients) {
    for (const list of Object.values(rule.names)) {
      for (const rawName of list) {
        const name = normalizeAlias(rawName);
        assert.ok(name, `${rule.id} 包含空名称`);
        const previousRule = claimed.get(name);
        assert.ok(!previousRule || previousRule === rule.id, `名称“${rawName}”同时属于 ${previousRule} 和 ${rule.id}`);
        claimed.set(name, rule.id);
      }
    }
  }
});

test("高风险或证据有限规则有来源且文案不作绝对化保证", () => {
  const forbiddenClaims = /绝对安全|完全安全|一定致畸/;
  for (const rule of ingredients) {
    const copy = `${rule.summary} ${rule.rationale}`;
    assert.doesNotMatch(copy, forbiddenClaims, `${rule.id} 使用了绝对化文案`);
    if (["limit", "avoid", "consult"].includes(rule.status)) {
      assert.ok(rule.sourceIds.length > 0, `${rule.id} 缺少权威来源`);
    }
  }
});

test("规则覆盖任务要求的主要成分和场景", () => {
  const requiredIds = [
    "tretinoin", "adapalene", "tazarotene", "retinol", "retinal", "retinyl-esters",
    "salicylic-acid", "benzoyl-peroxide", "azelaic-acid", "glycolic-acid", "lactic-acid", "sulfur",
    "hydroquinone", "arbutin", "tranexamic-acid-topical", "kojic-acid", "vitamin-c-derivatives", "niacinamide",
    "zinc-oxide", "titanium-dioxide", "avobenzone", "octocrylene", "oxybenzone", "octinoxate", "homosalate",
    "minoxidil", "ketoconazole", "selenium-sulfide", "zinc-pyrithione", "coal-tar", "piroctone-olamine", "oxidative-hair-dye",
    "chlorhexidine-topical", "triclosan", "parabens", "phenoxyethanol", "formaldehyde-releasers", "methylisothiazolinone",
    "fragrance-mixture", "peppermint-oil", "rosemary-oil", "tea-tree-oil", "lavender-oil", "eucalyptus-oil", "clary-sage-oil", "phototoxic-citrus-oils",
    "fluoride-toothpaste", "hydrogen-peroxide-whitening", "chlorhexidine-mouthwash", "alcohol-mouthwash",
    "acetone", "toluene", "formaldehyde-nail", "dibutyl-phthalate", "methacrylates", "cyanoacrylates",
    "thioglycolates", "aluminum-antiperspirants", "depilatory-alkalis",
    "hyaluronic-acid", "ceramides", "glycerin", "petrolatum", "squalane", "panthenol", "peptides", "caffeine-topical", "urea", "centella-asiatica", "aloe-vera",
    "lidocaine-topical", "pramoxine", "hydrocortisone-topical", "clotrimazole-topical", "terbinafine-topical",
  ];
  const ids = new Set(ingredients.map(({ id }) => id));
  for (const id of requiredIds) assert.ok(ids.has(id), `缺少规则：${id}`);
});
