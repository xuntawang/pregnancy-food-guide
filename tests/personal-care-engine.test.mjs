import assert from "node:assert/strict";
import test from "node:test";

import {
  extractJsonScript,
  loadPersonalCareEngine,
  readIndexHtml,
} from "./helpers/load-site.mjs";

const html = readIndexHtml();
const engine = () => loadPersonalCareEngine(html);
const products = extractJsonScript(html, "personal-care-products");
const ingredientRules = extractJsonScript(html, "personal-care-ingredients");
const categoryRules = extractJsonScript(html, "personal-care-procedures");
const plain = (value) => JSON.parse(JSON.stringify(value));

test("规范化名称统一宽字符、大小写、空白与中英文括号", () => {
  const { normalizeIngredientName } = engine();

  assert.equal(normalizeIngredientName("  Ｒetinol （ 维A醇 ） "), "retinol (维a醇)");
  assert.equal(normalizeIngredientName("Salicylic   Acid"), "salicylic acid");
});

test("切分混合成分表时保留复合 INCI 名称、去重并标记截断", () => {
  const { splitIngredientList } = engine();
  const result = splitIngredientList("1. Retinyl Palmitate，Salicylic Acid; 水杨酸；\n2) Retinyl Palmitate\n(香精, Fragrance)");

  assert.deepEqual(plain(result), {
    tokens: ["retinyl palmitate", "salicylic acid", "水杨酸", "香精", "fragrance"],
    truncated: false,
  });

  const tooMany = splitIngredientList(Array.from({ length: 201 }, (_, index) => `成分${index}`).join("、"));
  assert.equal(tooMany.tokens.length, 200);
  assert.equal(tooMany.truncated, true);
});

test("别名索引只允许精确命中，未知名称不会被默认判为安全", () => {
  const { buildIngredientAliasIndex, matchIngredient, scanIngredientList } = engine();
  const retinol = { id: "retinol", aliases: ["维A醇", "视黄醇", "Retinol"], status: "avoid" };
  const index = buildIngredientAliasIndex([retinol]);

  assert.deepEqual(plain(matchIngredient("维A醇", index)), { ruleId: "retinol", status: "avoid" });
  assert.deepEqual(plain(matchIngredient("视黄醇", index)), { ruleId: "retinol", status: "avoid" });
  assert.deepEqual(plain(matchIngredient("Retinol", index)), { ruleId: "retinol", status: "avoid" });
  assert.equal(matchIngredient("醇", index), null);
  assert.deepEqual(plain(scanIngredientList("视黄醇, 神秘成分", index)), {
    tokens: ["视黄醇", "神秘成分"],
    matches: [{ token: "视黄醇", ruleId: "retinol", status: "avoid" }],
    unresolved: ["神秘成分"],
    truncated: false,
    overallStatus: "avoid",
  });

  const truncated = scanIngredientList(
    ["视黄醇", ...Array.from({ length: 200 }, (_, index) => `未知成分${index}`)].join("、"),
    index,
  );
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.overallStatus, "avoid");
});

test("组合结论采用固定风险优先级", () => {
  const { deriveOverallStatus } = engine();

  assert.equal(deriveOverallStatus(["safe", "consult"]), "consult");
  assert.equal(deriveOverallStatus(["safe", "limit"]), "limit");
  assert.equal(deriveOverallStatus(["consult", "limit"]), "limit");
  assert.equal(deriveOverallStatus(["limit", "avoid"]), "avoid");
});

test("常见商品别名精确找到对应快照且冲突别名被拒绝", () => {
  const { buildProductAliasIndex, findProductSnapshot } = engine();
  const products = [
    { id: "cerave-cleanser-us-v1", brand: "CeraVe", name: "Hydrating Facial Cleanser", aliases: ["适乐肤氨基酸洁面"] },
    { id: "differin-gel-us-v1", brand: "Differin", name: "Differin Gel 0.1% Adapalene", aliases: ["达芙文凝胶"] },
  ];
  const index = buildProductAliasIndex(products);

  assert.equal(findProductSnapshot("适乐肤氨基酸洁面", index)?.id, "cerave-cleanser-us-v1");
  assert.equal(findProductSnapshot(" DIFFERIN   GEL 0.1% ADAPALENE ", index)?.id, "differin-gel-us-v1");
  assert.equal(findProductSnapshot("凝胶", index), null);
  assert.throws(
    () => buildProductAliasIndex([...products, { id: "collision", name: "Other", aliases: ["达芙文凝胶"] }]),
    /别名冲突/,
  );
});

test("商品结论只由成分规则、类别规则和时效动态计算并分离配方来源", () => {
  const { resolveProductSnapshot } = engine();
  const snapshot = {
    id: "retinol-serum-us-v1",
    formulaReviewed: "2026-07-28",
    formulaSourceUrl: "https://brand.example/formula",
    categoryRuleId: "anti-aging-care",
    ingredients: ["Water", "Retinol", "Mystery Extract"],
  };
  const ingredientRules = [{
    id: "retinol",
    names: { zh: ["维A醇"], en: ["Retinol"], inci: ["Retinol"], aliases: [] },
    status: "avoid",
    sourceIds: ["medical-retinol"],
  }];
  const categoryRules = [{
    id: "anti-aging-care",
    status: "consult",
    sourceIds: ["medical-anti-aging"],
  }];

  assert.deepEqual(plain(resolveProductSnapshot(snapshot, "2026-07-28", ingredientRules, categoryRules)), {
    snapshot,
    stale: false,
    ingredientScan: {
      tokens: ["water", "retinol", "mystery extract"],
      matches: [{ token: "retinol", ruleId: "retinol", status: "avoid" }],
      unresolved: ["water", "mystery extract"],
      truncated: false,
      overallStatus: "avoid",
    },
    categoryRule: { id: "anti-aging-care", status: "consult" },
    medicalSourceIds: ["medical-retinol", "medical-anti-aging"],
    overallStatus: "avoid",
  });
  assert.equal(
    resolveProductSnapshot(snapshot, "2026-07-28", ingredientRules, categoryRules).medicalSourceIds.includes(snapshot.formulaSourceUrl),
    false,
  );
});

test("商品成分数组把含逗号 INCI 作为单个法定名称精确匹配", () => {
  const { resolveProductSnapshot } = engine();
  const snapshot = products.find(({ id }) => id === "eucerin-sensitive-mineral-sunscreen-spf50-us-spl-v5");
  const exactRule = {
    id: "hexanediol-exact-fixture",
    names: { zh: [], en: [], inci: ["1,2-Hexanediol"], aliases: [] },
    status: "consult",
    sourceIds: ["medical-hexanediol-fixture"],
  };

  const result = resolveProductSnapshot(snapshot, "2026-07-28", [exactRule], categoryRules);

  assert.ok(result.ingredientScan.tokens.includes("1,2-hexanediol"));
  assert.deepEqual(
    plain(result.ingredientScan.matches.filter(({ ruleId }) => ruleId === exactRule.id)),
    [{ token: "1,2-hexanediol", ruleId: exactRule.id, status: "consult" }],
  );
});

test("场景限定成分规则只在匹配商品类别中生效，未知类别保守为未解析", () => {
  const {
    buildIngredientAliasIndex,
    resolveProductSnapshot,
    scanIngredientList,
  } = engine();
  const depilatoryRule = ingredientRules.find(({ id }) => id === "depilatory-alkalis");
  const unrelatedProductIds = [
    "eucerin-advanced-hydration-face-sunscreen-spf50-us-spl-v2",
    "cerave-acne-foaming-cream-cleanser-us-spl-v3",
    "selsun-blue-itchy-dry-scalp-us-spl-v15",
  ];

  for (const productId of unrelatedProductIds) {
    const snapshot = products.find(({ id }) => id === productId);
    const result = resolveProductSnapshot(snapshot, "2026-07-28", ingredientRules, categoryRules);
    assert.equal(
      result.ingredientScan.matches.some(({ ruleId }) => ruleId === depilatoryRule.id),
      false,
      `${productId} 不应触发脱毛膏碱剂规则`,
    );
  }

  const scopedRules = new Map(
    ingredientRules
      .filter(({ applicableProcedureIds }) => Array.isArray(applicableProcedureIds))
      .map((rule) => [rule.id, rule]),
  );
  for (const snapshot of products) {
    const result = resolveProductSnapshot(snapshot, "2026-07-28", ingredientRules, categoryRules);
    for (const { ruleId } of result.ingredientScan.matches) {
      const scopedRule = scopedRules.get(ruleId);
      if (!scopedRule) continue;
      assert.ok(
        scopedRule.applicableProcedureIds.includes(snapshot.categoryRuleId),
        `${snapshot.id} 命中了不适用当前类别的 ${ruleId}`,
      );
    }
  }

  const unknownContext = scanIngredientList(
    "Potassium Hydroxide",
    buildIngredientAliasIndex(ingredientRules),
  );
  assert.deepEqual(plain(unknownContext), {
    tokens: ["potassium hydroxide"],
    matches: [],
    unresolved: ["potassium hydroxide"],
    truncated: false,
    overallStatus: "consult",
  });

  const sunscreenContext = resolveProductSnapshot(
    {
      id: "sunscreen-context-fixture",
      categoryRuleId: "sunscreen-use",
      formulaReviewed: "2026-07-28",
      ingredients: ["Potassium Hydroxide"],
    },
    "2026-07-28",
    ingredientRules,
    [{ id: "sunscreen-use", status: "limit", sourceIds: ["medical-sunscreen-fixture"] }],
  );
  assert.deepEqual(plain(sunscreenContext.medicalSourceIds), ["medical-sunscreen-fixture"]);

  const depilatorySnapshot = {
    id: "depilatory-context-fixture",
    categoryRuleId: "depilatory-cream",
    formulaReviewed: "2026-07-28",
    ingredients: ["Potassium Hydroxide"],
  };
  const depilatoryResult = resolveProductSnapshot(
    depilatorySnapshot,
    "2026-07-28",
    ingredientRules,
    categoryRules,
  );
  assert.deepEqual(
    plain(depilatoryResult.ingredientScan.matches),
    [{ token: "potassium hydroxide", ruleId: "depilatory-alkalis", status: "limit" }],
  );
});

test("商品快照在 365 天内有效，超过 365 天或缺少日期时降级", () => {
  const { isSnapshotStale, resolveProductSnapshot } = engine();
  const today = "2026-07-28";
  const current = { id: "current", formulaReviewed: "2025-07-28", ingredients: [] };
  const stale = { id: "stale", formulaReviewed: "2025-07-27", ingredients: [] };

  assert.equal(isSnapshotStale(current, today), false);
  assert.equal(isSnapshotStale(stale, today), true);
  assert.equal(isSnapshotStale({}, today), true);
  assert.equal(isSnapshotStale({ formulaReviewed: "not-a-date" }, today), true);
  assert.equal(resolveProductSnapshot(stale, today, [], []).overallStatus, "consult");
});
