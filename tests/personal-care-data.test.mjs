import assert from "node:assert/strict";
import test from "node:test";

import { extractJsonScript, readIndexHtml } from "./helpers/load-site.mjs";

const html = readIndexHtml();
const sources = extractJsonScript(html, "personal-care-sources");
const ingredients = extractJsonScript(html, "personal-care-ingredients");
const procedures = extractJsonScript(html, "personal-care-procedures");
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
