import assert from "node:assert/strict";
import test from "node:test";

import {
  extractJsonScript,
  loadPersonalCareEngine,
  readIndexHtml,
} from "./helpers/load-site.mjs";

const html = readIndexHtml();
const personalCareEngine = loadPersonalCareEngine(html);
const sources = extractJsonScript(html, "personal-care-sources");
const ingredients = extractJsonScript(html, "personal-care-ingredients");
const procedures = extractJsonScript(html, "personal-care-procedures");
const products = extractJsonScript(html, "personal-care-products");
const sourceIds = new Set(sources.map(({ id }) => id));
const sourceById = new Map(sources.map((source) => [source.id, source]));
const validStatuses = new Set(["safe", "limit", "avoid", "consult"]);
const validEvidenceTypes = new Set([
  "clinical-pregnancy",
  "pregnancy-teratology",
  "drug-label",
  "pregnancy-review",
  "occupational-pregnancy",
  "general-regulation",
  "formulation-safety",
  "search-gap",
]);
const validAuthorityLevels = new Set([
  "clinical-authority",
  "teratology-service",
  "regulator",
  "systematic-review",
  "narrative-review",
  "formal-label",
  "official-safety-committee",
  "documented-gap",
]);
const directPregnancyEvidenceTypes = new Set([
  "clinical-pregnancy",
  "pregnancy-teratology",
  "drug-label",
  "pregnancy-review",
  "occupational-pregnancy",
]);
const safeEvidenceTypes = new Set([
  "clinical-pregnancy",
  "pregnancy-teratology",
  "pregnancy-review",
]);
const consumerStrongEvidenceTypes = new Set([
  "clinical-pregnancy",
  "pregnancy-teratology",
  "drug-label",
  "pregnancy-review",
]);
const consumerStrongAuthorityLevels = new Set([
  "clinical-authority",
  "teratology-service",
  "systematic-review",
  "narrative-review",
  "formal-label",
]);
const validEvidencePopulations = new Set([
  "consumer-pregnancy",
  "occupational-pregnancy",
]);
const validEvidenceRoutes = new Set([
  "rinse-off",
  "leave-on",
  "scalp",
  "inhalation",
  "mucosal-local",
  "oral-local",
  "nail-topical",
  "heat",
  "massage",
  "injection",
  "skin-breaking",
  "energy",
]);
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
  return Boolean(personalCareEngine.parseDate?.(value));
}

const normalizeAlias = personalCareEngine.normalizeIngredientName;

function hasMatchingConsumerStrongEvidence(rule, sourcesById) {
  const evidence = rule.sourceIds.map((sourceId) => sourcesById.get(sourceId));
  const eligibleEvidenceTypes = rule.status === "safe"
    ? safeEvidenceTypes
    : consumerStrongEvidenceTypes;
  return evidence.some((source) => source
    && eligibleEvidenceTypes.has(source.evidenceType)
    && consumerStrongAuthorityLevels.has(source.authorityLevel)
    && (source.procedureClaims ?? []).some((claim) => claim.procedureId === rule.id
      && claim.population === "consumer-pregnancy"
      && claim.supportsStatus.includes(rule.status)
      && rule.evidenceRoutes.every((route) => claim.route.includes(route))));
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
    assert.ok(validEvidenceTypes.has(source.evidenceType), `${source.id} 的证据类型无效`);
    assert.ok(validAuthorityLevels.has(source.authorityLevel), `${source.id} 的权威层级无效`);
    if (source.evidenceType === "search-gap") {
      assert.equal(source.authorityLevel, "documented-gap", `${source.id} 的检索缺口层级无效`);
      assert.ok(source.searchDetails, `${source.id} 缺少检索细节`);
      assert.equal(source.searchDetails.searchedOn, "2026-07-28", `${source.id} 检索日期不正确`);
      assert.ok(Array.isArray(source.searchDetails.terms) && source.searchDetails.terms.length > 0, `${source.id} 缺少检索词`);
      assert.ok(Array.isArray(source.searchDetails.resources) && source.searchDetails.resources.length > 0, `${source.id} 缺少检索资源`);
      assert.ok(source.searchDetails.resources.every((url) => /^https:\/\//.test(url)), `${source.id} 含无效检索资源`);
      assert.ok(source.searchDetails.finding?.trim(), `${source.id} 缺少检索结论`);
    }
  }
});

test("数据日期复用运行时严格解析并拒绝不存在的日历日期", () => {
  assert.equal(personalCareEngine.parseDate?.("2026-07-28")?.toISOString(), "2026-07-28T00:00:00.000Z");
  for (const invalid of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10"]) {
    assert.equal(personalCareEngine.parseDate?.(invalid), null, `${invalid} 不应被接受`);
  }
});

test("叙述性综述与系统综述的权威层级不可混标", () => {
  const narrativeReviewIds = [
    "pmc-skin-care-pregnancy",
    "pmc-topical-products-pregnancy",
    "pubmed-topical-antifungals",
    "pubmed-cosmetic-procedures",
  ];
  for (const id of narrativeReviewIds) {
    assert.equal(sourceById.get(id)?.authorityLevel, "narrative-review", `${id} 应标为 narrative-review`);
  }
  assert.deepEqual(
    sources.filter(({ authorityLevel }) => authorityLevel === "systematic-review").map(({ id }) => id).sort(),
    ["cochrane-topical-corticosteroids"],
    "只有实际系统综述可标为 systematic-review",
  );
});

test("BOTOX Cosmetic 使用 2024 完整处方标签并准确记录修订日期", () => {
  const source = sourceById.get("fda-botox-cosmetic-label");
  assert.equal(source?.title, "BOTOX Cosmetic Prescribing Information");
  assert.equal(
    source?.url,
    "https://www.accessdata.fda.gov/drugsatfda_docs/label/2024/103000s5316s5319s5323s5326s5331lbl.pdf",
  );
  assert.equal(source?.publishedOrUpdated, "2024-10");
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
    if (rule.applicableProcedureIds !== undefined) {
      assert.ok(
        Array.isArray(rule.applicableProcedureIds) && rule.applicableProcedureIds.length > 0,
        `${rule.id} 的适用场景必须是非空数组`,
      );
      for (const procedureId of rule.applicableProcedureIds) {
        assert.ok(procedures.some(({ id }) => id === procedureId), `${rule.id} 关联不存在的适用场景 ${procedureId}`);
      }
    }
    for (const sourceId of rule.sourceIds) {
      assert.ok(sourceIds.has(sourceId), `${rule.id} 引用了不存在的来源 ${sourceId}`);
    }
    const evidence = rule.sourceIds.map((sourceId) => sourceById.get(sourceId));
    if (rule.status === "safe") {
      assert.ok(
        evidence.some(({ evidenceType }) => safeEvidenceTypes.has(evidenceType)),
        `${rule.id} 的 safe 结论缺少直接孕期医学证据，通用法规或配方安全资料不能单独支持 safe`,
      );
    }
    if (["limit", "avoid"].includes(rule.status)) {
      assert.ok(
        evidence.some(({ evidenceType }) => directPregnancyEvidenceTypes.has(evidenceType)),
        `${rule.id} 的 ${rule.status} 结论缺少孕期医学证据`,
      );
    }
    if (rule.status === "consult") {
      assert.ok(
        evidence.some((source) => directPregnancyEvidenceTypes.has(source.evidenceType)
          && source.topics.includes(rule.id))
          || evidence.some((source) => source.evidenceType === "search-gap"
            && source.topics.includes(rule.id)
            && source.searchDetails?.finding?.trim()),
        `${rule.id} 的 consult 结论既无孕期医学证据，也无成分特异的可核验检索缺口`,
      );
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

test("全部成分与项目的替代方案不命中任何受限成分或项目名称", () => {
  const searchableRules = [
    ...ingredients.map((rule) => ({
      kind: "ingredient",
      id: rule.id,
      status: rule.status,
      labels: Object.values(rule.names).flat(),
      alternatives: rule.alternatives,
    })),
    ...procedures.map((rule) => ({
      kind: "procedure",
      id: rule.id,
      status: rule.status,
      labels: [rule.name, ...rule.aliases],
      alternatives: rule.alternatives,
    })),
  ];
  const restrictedAliases = searchableRules
    .filter(({ status }) => ["limit", "avoid", "consult"].includes(status))
    .flatMap((rule) => rule.labels.map((label) => ({
      kind: rule.kind,
      id: rule.id,
      status: rule.status,
      alias: normalizeAlias(label),
    })));
  const collisions = [];

  for (const rule of searchableRules) {
    for (const alternative of rule.alternatives) {
      const normalized = normalizeAlias(alternative);
      for (const target of restrictedAliases) {
        if (!normalized.includes(target.alias)) continue;
        collisions.push({
          source: `${rule.kind}:${rule.id}`,
          alternative,
          target: `${target.kind}:${target.id}`,
          status: target.status,
          alias: target.alias,
        });
      }
    }
  }

  assert.deepEqual(collisions, []);
});

test("ACOG 点名成分按最高风险建议归类，法规浓度框架不冒充孕期结论", () => {
  const statusById = new Map(ingredients.map(({ id, status }) => [id, status]));
  for (const id of ["parabens", "oxybenzone", "triclosan", "dibutyl-phthalate"]) {
    assert.equal(statusById.get(id), "avoid", `${id} 应按 ACOG 孕期保守建议归入 avoid`);
  }
  for (const id of ["octocrylene", "homosalate"]) {
    assert.equal(statusById.get(id), "consult", `${id} 不能仅凭防晒剂监管浓度得出孕期 limit`);
  }
  assert.equal(statusById.get("fragrance-mixture"), "limit", "香精规则应采用 ACOG fragrance-free 保守建议");
  for (const id of ["phototoxic-citrus-oils", "alcohol-mouthwash", "urea"]) {
    assert.equal(statusById.get(id), "consult", `${id} 缺少途径特异孕期依据时不应保留 limit`);
  }
  for (const id of ["acetone", "formaldehyde-nail", "methacrylates", "cyanoacrylates"]) {
    assert.equal(statusById.get(id), "consult", `${id} 的职业混合暴露证据不能外推为消费者 limit/avoid`);
  }
});

test("缺少直接孕期证据的原 safe 规则已降级或获得直接证据", () => {
  const rulesById = new Map(ingredients.map((rule) => [rule.id, rule]));
  const formerlyGeneralOnlySafe = [
    "vitamin-c-derivatives", "niacinamide", "phenoxyethanol", "aluminum-antiperspirants",
    "hyaluronic-acid", "ceramides", "glycerin", "petrolatum", "squalane", "panthenol",
    "aloe-vera", "dimethicone", "mineral-oil", "allantoin", "tocopherol",
  ];
  for (const id of formerlyGeneralOnlySafe) {
    const rule = rulesById.get(id);
    if (rule.status === "safe") {
      const evidence = rule.sourceIds.map((sourceId) => sourceById.get(sourceId));
      assert.ok(
        evidence.some(({ evidenceType }) => safeEvidenceTypes.has(evidenceType)),
        `${id} 仍为 safe 但没有直接孕期医学证据`,
      );
    } else {
      assert.equal(rule.status, "consult", `${id} 在无直接证据时应降为 consult`);
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

test("至少 40 条商品类别与美容项目规则满足完整数据契约", () => {
  assert.ok(procedures.length >= 40, `项目规则不足 40 条：${procedures.length}`);
  assert.equal(new Set(procedures.map(({ id }) => id)).size, procedures.length, "项目规则 ID 必须唯一");

  for (const rule of procedures) {
    assert.match(rule.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${rule.id} 的 ID 格式无效`);
    assert.ok(rule.name?.trim(), `${rule.id} 缺少名称`);
    assert.ok(Array.isArray(rule.aliases) && rule.aliases.length > 0, `${rule.id} 缺少别名`);
    assert.ok(rule.aliases.every((alias) => alias.trim()), `${rule.id} 包含空别名`);
    assert.ok(rule.category?.trim(), `${rule.id} 缺少分类`);
    assert.ok(validStatuses.has(rule.status), `${rule.id} 状态无效`);
    assert.ok(rule.summary?.trim(), `${rule.id} 缺少简短结论`);
    assert.ok(rule.rationale?.trim(), `${rule.id} 缺少理由`);
    assert.ok(rule.conditions && Object.values(rule.conditions).some((value) => value.trim()), `${rule.id} 缺少使用条件`);
    assert.ok(Array.isArray(rule.alternatives), `${rule.id} 替代方案必须是数组`);
    assert.ok(Array.isArray(rule.sourceIds) && rule.sourceIds.length > 0, `${rule.id} 缺少来源引用`);
    assert.ok(validDate(rule.reviewed), `${rule.id} 的复核日期无效`);
    assert.equal(rule.reviewed, "2026-07-28", `${rule.id} 应使用本次复核日期`);
    for (const sourceId of rule.sourceIds) {
      assert.ok(sourceIds.has(sourceId), `${rule.id} 引用了不存在的来源 ${sourceId}`);
    }
  }
});

test("项目规则覆盖任务 4 的全部指定场景", () => {
  const requiredIds = [
    "facial-cleansing", "facial-moisturizing", "sunscreen-use", "facial-mask", "makeup",
    "makeup-removal", "acne-care", "brightening-care", "anti-aging-care",
    "shampooing", "hair-conditioning", "dandruff-care", "hair-dye", "hair-bleaching",
    "hair-perming", "chemical-straightening", "hair-styling-spray", "dry-shampoo-spray", "topical-minoxidil",
    "fluoride-toothpaste", "mouthwash", "teeth-whitening", "antiperspirant", "body-lotion",
    "intimate-wash", "depilatory-cream", "self-tanning-lotion",
    "regular-nail-polish", "gel-manicure", "nail-extensions", "nail-polish-removal",
    "press-on-nail-glue", "eyelash-extensions", "lash-lift",
    "comedone-extraction", "superficial-chemical-peel", "deep-chemical-peel", "steam-sauna",
    "hot-bath", "prenatal-massage", "aromatherapy", "spray-tanning",
    "botulinum-toxin", "dermal-fillers", "microneedling", "radiofrequency-treatment",
    "focused-ultrasound-lift", "intense-pulsed-light", "pigment-laser", "ablative-laser",
    "laser-hair-removal", "skin-booster-injection", "mesotherapy",
  ];
  const ids = new Set(procedures.map(({ id }) => id));
  for (const id of requiredIds) assert.ok(ids.has(id), `缺少项目规则：${id}`);
});

test("项目状态结论不强于其孕期证据", () => {
  for (const rule of procedures) {
    const evidence = rule.sourceIds.map((sourceId) => sourceById.get(sourceId));
    if (rule.status === "safe") {
      assert.ok(
        evidence.some(({ evidenceType }) => safeEvidenceTypes.has(evidenceType)),
        `${rule.id} 的 safe 结论缺少直接孕期医学证据`,
      );
    }
    if (["limit", "avoid"].includes(rule.status)) {
      assert.ok(
        evidence.some(({ evidenceType }) => directPregnancyEvidenceTypes.has(evidenceType)),
        `${rule.id} 的 ${rule.status} 结论只有一般监管或配方资料`,
      );
    }
    if (rule.status === "consult") {
      assert.ok(
        evidence.some(({ evidenceType }) => directPregnancyEvidenceTypes.has(evidenceType))
          || evidence.some(({ evidenceType, searchDetails }) => evidenceType === "search-gap"
            && searchDetails?.finding?.trim()),
        `${rule.id} 的 consult 结论缺少孕期医学资料或可核验检索缺口`,
      );
    }
  }
});

test("项目证据声明具有可机器核查的人群、途径、状态方向和精确项目关联", () => {
  for (const source of sources) {
    if (source.procedureClaims === undefined) continue;
    assert.ok(Array.isArray(source.procedureClaims) && source.procedureClaims.length > 0, `${source.id} 的项目证据声明无效`);
    for (const claim of source.procedureClaims) {
      assert.ok(procedures.some(({ id }) => id === claim.procedureId), `${source.id} 关联不存在的项目 ${claim.procedureId}`);
      assert.ok(validEvidencePopulations.has(claim.population), `${source.id}/${claim.procedureId} 的人群无效`);
      assert.ok(Array.isArray(claim.route) && claim.route.length > 0, `${source.id}/${claim.procedureId} 缺少途径`);
      assert.ok(claim.route.every((route) => validEvidenceRoutes.has(route)), `${source.id}/${claim.procedureId} 含无效途径`);
      assert.ok(Array.isArray(claim.supportsStatus) && claim.supportsStatus.length > 0, `${source.id}/${claim.procedureId} 缺少状态方向`);
      assert.ok(claim.supportsStatus.every((status) => validStatuses.has(status)), `${source.id}/${claim.procedureId} 含无效状态方向`);
    }
  }
});

test("所有消费者 safe、limit 和 avoid 结论均有同项目同途径的人群匹配来源", () => {
  for (const rule of procedures.filter(({ status }) => ["safe", "limit", "avoid"].includes(status))) {
    assert.ok(Array.isArray(rule.evidenceRoutes) && rule.evidenceRoutes.length > 0, `${rule.id} 缺少待匹配的证据途径`);
    assert.ok(
      hasMatchingConsumerStrongEvidence(rule, sourceById),
      `${rule.id} 的 ${rule.status} 仅有职业、一般监管、错误途径或错误状态方向证据`,
    );
  }
});

test("消费者强结论不能拼接一般监管声明与不相关职业孕期证据", () => {
  const rule = {
    id: "synthetic-consumer-procedure",
    status: "limit",
    evidenceRoutes: ["inhalation"],
    sourceIds: ["general-regulation-with-claim", "unrelated-occupational-source"],
  };
  const fixtureSources = new Map([
    ["general-regulation-with-claim", {
      evidenceType: "general-regulation",
      authorityLevel: "regulator",
      procedureClaims: [{
        procedureId: "synthetic-consumer-procedure",
        population: "consumer-pregnancy",
        route: ["inhalation"],
        supportsStatus: ["limit"],
      }],
    }],
    ["unrelated-occupational-source", {
      evidenceType: "occupational-pregnancy",
      authorityLevel: "teratology-service",
      procedureClaims: [{
        procedureId: "different-procedure",
        population: "occupational-pregnancy",
        route: ["inhalation"],
        supportsStatus: ["limit"],
      }],
    }],
  ]);

  assert.equal(hasMatchingConsumerStrongEvidence(rule, fixtureSources), false);
});

test("审查点名的消费者项目不能由宽泛或职业证据绕过契约", () => {
  const expected = new Map([
    ["facial-cleansing", { status: "consult", routes: ["rinse-off"] }],
    ["makeup", { status: "consult", routes: ["leave-on"] }],
    ["makeup-removal", { status: "consult", routes: ["rinse-off"] }],
    ["hair-bleaching", { status: "limit", routes: ["scalp", "inhalation"] }],
    ["hair-styling-spray", { status: "consult", routes: ["inhalation"] }],
    ["intimate-wash", { status: "consult", routes: ["mucosal-local"] }],
    ["regular-nail-polish", { status: "limit", routes: ["nail-topical", "inhalation"] }],
    ["gel-manicure", { status: "limit", routes: ["nail-topical", "inhalation"] }],
    ["nail-extensions", { status: "limit", routes: ["nail-topical", "inhalation"] }],
    ["nail-polish-removal", { status: "limit", routes: ["nail-topical", "inhalation"] }],
  ]);
  const rulesById = new Map(procedures.map((rule) => [rule.id, rule]));
  for (const [id, want] of expected) {
    const rule = rulesById.get(id);
    assert.equal(rule?.status, want.status, `${id} 状态未按证据范围修复`);
    const claims = rule.sourceIds.flatMap((sourceId) => sourceById.get(sourceId)?.procedureClaims ?? []);
    assert.ok(
      claims.some((claim) => claim.procedureId === id
        && claim.population === "consumer-pregnancy"
        && claim.supportsStatus.includes(want.status)
        && want.routes.every((route) => claim.route.includes(route))),
      `${id} 缺少同人群、同项目、同途径、同状态方向的来源声明`,
    );
  }
});

test("桑拿与高热蒸汽按 MotherToBaby 的限制结论而非一概避免", () => {
  const rule = procedures.find(({ id }) => id === "steam-sauna");
  assert.equal(rule?.status, "limit");
  assert.ok(rule.sourceIds.includes("mothertobaby-hyperthermia"));
  assert.match(`${rule.summary} ${Object.values(rule.conditions).join(" ")}`, /温度/);
  assert.match(`${rule.summary} ${Object.values(rule.conditions).join(" ")}`, /时长|时间/);
  assert.match(`${rule.summary} ${Object.values(rule.conditions).join(" ")}`, /头晕|脱水/);
  assert.match(`${rule.summary} ${Object.values(rule.conditions).join(" ")}`, /离开/);
});

test("选择性注射、破皮与能量医美在无直接孕期安全证据时先咨询并建议暂缓", () => {
  const rulesById = new Map(procedures.map((rule) => [rule.id, rule]));
  const electiveProcedures = [
    "botulinum-toxin", "dermal-fillers", "microneedling", "radiofrequency-treatment",
    "focused-ultrasound-lift", "intense-pulsed-light", "pigment-laser", "ablative-laser",
    "laser-hair-removal", "skin-booster-injection", "mesotherapy",
  ];
  for (const id of electiveProcedures) {
    const rule = rulesById.get(id);
    assert.equal(rule?.status, "consult", `${id} 应为 consult`);
    assert.match(`${rule?.summary} ${rule?.rationale} ${rule?.conditions?.aftercare}`, /暂缓|推迟|延期/, `${id} 未明确建议孕期暂缓`);
    assert.doesNotMatch(`${rule?.summary} ${rule?.rationale}`, /未发现危害.{0,8}(安全|可用)|没有危害.{0,8}(安全|可用)/, `${id} 把证据缺口误写为安全`);
  }
});

test("项目条件区分暴露途径、消费者与职业暴露及操作相关风险", () => {
  const rulesById = new Map(procedures.map((rule) => [rule.id, rule]));
  for (const id of ["hair-dye", "regular-nail-polish", "gel-manicure", "nail-extensions"]) {
    assert.match(rulesById.get(id)?.conditions?.occupational ?? "", /职业|从业|高频/, `${id} 未区分职业高频暴露`);
  }
  for (const id of ["hair-styling-spray", "dry-shampoo-spray", "spray-tanning"]) {
    assert.match(rulesById.get(id)?.conditions?.ventilation ?? "", /吸入|通风|喷雾/, `${id} 未处理吸入风险`);
  }
  for (const id of ["microneedling", "skin-booster-injection", "mesotherapy"]) {
    const conditions = rulesById.get(id)?.conditions ?? {};
    assert.match(`${conditions.skin} ${conditions.anesthesia} ${conditions.aftercare}`, /破损|针|感染/, `${id} 未处理破皮或感染`);
    assert.match(`${conditions.anesthesia} ${conditions.aftercare}`, /麻醉|用药|抗病毒|抗生素/, `${id} 未处理麻醉或术后用药`);
  }
  for (const id of ["steam-sauna", "hot-bath", "radiofrequency-treatment", "focused-ultrasound-lift"]) {
    assert.match(rulesById.get(id)?.conditions?.heat ?? "", /热|温度|体温/, `${id} 未处理热暴露`);
  }
  assert.match(rulesById.get("depilatory-cream")?.conditions?.route ?? "", /冲洗/, "脱毛膏未标明冲洗型使用");
  assert.match(rulesById.get("body-lotion")?.conditions?.route ?? "", /驻留/, "身体乳未标明驻留型使用");
});

test("至少 30 个商品快照具有地区、版本、完整配方来源且不保存孕期结论", () => {
  const forbiddenConclusionFields = [
    "status", "overallStatus", "pregnancyStatus", "categoryStatus", "ingredientStatuses",
  ];

  assert.ok(products.length >= 30, `商品快照不足 30 个：${products.length}`);
  assert.equal(new Set(products.map(({ id }) => id)).size, products.length, "商品 ID 必须唯一");

  for (const product of products) {
    assert.match(product.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${product.id} 的 ID 格式无效`);
    assert.ok(product.brand?.trim(), `${product.id} 缺少品牌`);
    assert.ok(product.name?.trim(), `${product.id} 缺少包装完整商品名`);
    assert.ok(Array.isArray(product.aliases) && product.aliases.length > 0, `${product.id} 缺少常用别名`);
    assert.ok(product.aliases.every((alias) => alias.trim()), `${product.id} 包含空别名`);
    assert.ok(product.category?.trim(), `${product.id} 缺少商品类别`);
    assert.ok(product.categoryRuleId?.trim(), `${product.id} 缺少类别规则关联`);
    assert.ok(procedures.some(({ id }) => id === product.categoryRuleId), `${product.id} 关联不存在的类别规则`);
    assert.ok(product.formulaRegion?.trim(), `${product.id} 缺少配方地区`);
    assert.ok(product.formulaVersion?.trim(), `${product.id} 缺少配方版本`);
    assert.equal(product.formulaReviewed, "2026-07-28", `${product.id} 的配方复核日期不正确`);
    assert.match(product.formulaSourceUrl, /^https:\/\/[^\s]+$/, `${product.id} 缺少直接 HTTPS 配方来源`);
    assert.ok(Array.isArray(product.ingredients) && product.ingredients.length > 0, `${product.id} 缺少完整成分数组`);
    assert.ok(product.ingredients.every((ingredient) => ingredient.trim()), `${product.id} 包含空成分`);
    assert.ok(Array.isArray(product.notes) && product.notes.length > 0, `${product.id} 缺少版本提示`);
    assert.match(product.notes.join(" "), /包装|标签/, `${product.id} 未提醒对照当前包装或标签`);
    for (const field of forbiddenConclusionFields) {
      assert.equal(Object.hasOwn(product, field), false, `${product.id} 不得保存独立孕期结论字段 ${field}`);
    }
  }
});

test("首发商品覆盖六类最低配额", () => {
  const quotas = new Map([
    ["洁面或保湿", { categories: new Set(["洁面", "保湿"]), minimum: 6 }],
    ["防晒", { categories: new Set(["防晒"]), minimum: 6 }],
    ["祛痘淡斑抗老", { categories: new Set(["祛痘", "淡斑", "抗老"]), minimum: 8 }],
    ["洗发或去屑", { categories: new Set(["洗发", "去屑"]), minimum: 4 }],
    ["口腔护理", { categories: new Set(["口腔护理"]), minimum: 3 }],
    ["身体止汗美甲造型", { categories: new Set(["身体护理", "止汗", "美甲", "头发造型"]), minimum: 3 }],
  ]);

  for (const [label, { categories, minimum }] of quotas) {
    const count = products.filter(({ category }) => categories.has(category)).length;
    assert.ok(count >= minimum, `${label} 商品不足 ${minimum} 个：${count}`);
  }
});

test("商品完整名称和普通搜索别名规范化后不冲突", () => {
  const claimed = new Map();
  for (const product of products) {
    for (const rawAlias of [product.name, ...product.aliases]) {
      const alias = normalizeAlias(rawAlias);
      assert.ok(alias, `${product.id} 包含空搜索名称`);
      assert.equal(claimed.has(alias), false, `商品搜索名称“${rawAlias}”同时属于 ${claimed.get(alias)} 和 ${product.id}`);
      claimed.set(alias, product.id);
    }
  }
});

test("Colgate 商品使用当前标签完整名且简化名称保留为别名", () => {
  const colgate = products.find(({ id }) => id === "colgate-total-clean-mint-us-spl-v17");

  assert.equal(colgate.name, "COLGATE TOTAL SF CLEAN MINT");
  assert.ok(colgate.aliases.includes("Colgate Total Clean Mint Toothpaste"));
});
