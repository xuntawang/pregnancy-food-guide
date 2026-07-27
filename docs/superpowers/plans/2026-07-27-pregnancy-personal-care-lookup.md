# Pregnancy Personal Care Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Chinese pregnancy food lookup into a unified mobile-first “饮食 / 个护” tool that gives evidence-linked, context-aware guidance for personal-care ingredients, common products, daily services, beauty treatments, and medical-aesthetic procedures.

**Architecture:** Keep the published runtime as one self-contained `index.html`. Add four embedded JSON datasets and a pure inline personal-care engine exposed as `globalThis.personalCareEngine`; the UI layer consumes that engine without network calls. Add dependency-free Node tests that extract the embedded JSON and engine from the HTML, validate the evidence contract, and protect the existing food experience.

**Tech Stack:** Semantic HTML, CSS, vanilla JavaScript, embedded JSON, Node.js built-in `node:test`, `node:assert`, `node:vm`, GitHub Pages.

## Global Constraints

- The production page remains a single self-contained `index.html`; no runtime API, CDN, remote font, analytics, account, OCR, or AI dependency.
- Preserve every existing food record and the current food-search behavior. Shared visual components may be refactored only with regression coverage.
- Use four user-facing statuses and these internal keys:
  - `safe` → 通常可用
  - `limit` → 限制使用
  - `avoid` → 建议避免
  - `consult` → 证据不足／咨询医生
- For combined results, use actionable precedence `avoid > limit > consult > safe`. “证据不足” is uncertainty, not a stronger medical finding than a known limitation or avoidance rule.
- No statement may claim absolute safety. “通常可用” means acceptable under the displayed use conditions and never overrides a clinician’s individual advice.
- Every `limit`, `avoid`, and `consult` rule must resolve to at least one authoritative source and a review date. Brand or retailer pages may establish product formula only, never pregnancy safety.
- Source hierarchy: NMPA and Chinese professional guidance first; then ACOG, FDA, EMA, NHS; then MotherToBaby, UKTIS/BUMPS; then systematic reviews or formal consensus.
- A product snapshot is formula-specific, region-specific, and time-specific. A snapshot older than 365 days automatically displays `consult` until re-reviewed.
- All ingredient-list parsing happens in the browser. Never persist pasted ingredients, searches, product names, or results. The only permitted `localStorage` key is `pregnancy-guide-channel`.
- Do not turn accidental one-time exposure into an emergency message. Reserve urgent guidance for actual red-flag symptoms and direct those users to medical care.
- The page is informational and must retain a visible medical disclaimer.
- Minimum launch coverage:
  - 80 ingredient or ingredient-family rules
  - 40 product-category or procedure rules
  - 30 verified product snapshots
- Use review dates in ISO `YYYY-MM-DD`. Use absolute HTTPS URLs for all external evidence.
- Run the full automated suite after every task. Commit only after tests pass.

---

## Task 1: Add a dependency-free test harness and lock the current food experience

**Files:**
- Create: `package.json`
- Create: `tests/helpers/load-site.mjs`
- Create: `tests/site-regression.test.mjs`
- Test: `index.html`

- [ ] Create `package.json` with no dependencies and these scripts:

```json
{
  "name": "pregnancy-food-guide",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "check": "node --check tests/helpers/load-site.mjs && node --check tests/*.test.mjs && npm test"
  }
}
```

- [ ] Add `tests/helpers/load-site.mjs` with:
  - `readIndexHtml()` returning the UTF-8 contents of the repository-root `index.html`.
  - `extractJsonScript(html, id)` locating exactly one `<script type="application/json" id="…">`, decoding its JSON, and throwing a readable error if missing or duplicated.
  - `extractScript(html, id)` locating exactly one executable `<script id="…">`.
  - `loadPersonalCareEngine(html)` executing only the extracted engine script in a fresh `vm` context and returning `globalThis.personalCareEngine`.

- [ ] Add a failing regression test that asserts the existing page contains the food search, food grid, category bar, disclaimer, and at least 160 food records.

```js
test("keeps the current food lookup intact", () => {
  const html = readIndexHtml();
  const foods = extractJsonScript(html, "food-data");
  assert.ok(html.includes('id="food-search"'));
  assert.ok(html.includes('id="food-grid"'));
  assert.ok(html.includes('id="category-bar"'));
  assert.match(html, /不替代医生|医疗建议/);
  assert.ok(foods.length >= 160);
  for (const name of ["鸡蛋", "牛奶", "三文鱼", "咖啡", "生鱼片"]) {
    assert.ok(foods.some((food) => food.name === name), `missing ${name}`);
  }
});
```

- [ ] Run `npm test`.
  - Expected: the regression test passes against the current page.

- [ ] Run `npm run check`.
  - Expected: syntax checks and all tests pass with exit code 0.

- [ ] Commit:

```bash
git add package.json tests
git commit -m "test: protect existing pregnancy food lookup"
```

---

## Task 2: Define the personal-care data contract and implement the pure matching engine

**Files:**
- Modify: `index.html`
- Create: `tests/personal-care-engine.test.mjs`
- Modify: `tests/helpers/load-site.mjs`

- [ ] Add four initially empty embedded JSON arrays immediately after `food-data`:
  - `personal-care-sources`
  - `personal-care-ingredients`
  - `personal-care-products`
  - `personal-care-procedures`

- [ ] Add `<script id="personal-care-engine">` before the existing application script. It must have no DOM dependency and export this exact interface:

```js
globalThis.personalCareEngine = Object.freeze({
  normalizeIngredientName,
  splitIngredientList,
  buildIngredientAliasIndex,
  matchIngredient,
  scanIngredientList,
  deriveOverallStatus,
  isSnapshotStale,
  resolveProductSnapshot
});
```

- [ ] Write failing tests for normalization and splitting:
  - Normalize Unicode width, case, punctuation, whitespace, Chinese/English parentheses, and common separators.
  - Split on commas, Chinese commas, semicolons, Chinese semicolons, line breaks, and numbered-list prefixes.
  - Preserve compound INCI names such as `Retinyl Palmitate` and `Salicylic Acid`.
  - Remove duplicates while retaining first-seen order.
  - Return at most 200 tokens and mark remaining input as truncated.

- [ ] Write failing tests for exact alias matching:
  - `维A醇`, `视黄醇`, and `Retinol` resolve to the same rule.
  - A short token cannot match by arbitrary substring; `醇` must not resolve to `视黄醇`.
  - Unrecognized tokens are returned separately and never silently classified as safe.

- [ ] Write failing tests for combined status precedence:

```js
assert.equal(deriveOverallStatus(["safe", "consult"]), "consult");
assert.equal(deriveOverallStatus(["safe", "limit"]), "limit");
assert.equal(deriveOverallStatus(["consult", "limit"]), "limit");
assert.equal(deriveOverallStatus(["limit", "avoid"]), "avoid");
```

- [ ] Write failing tests for product freshness:
  - Exactly 365 days old is current.
  - More than 365 days old is stale.
  - Missing or invalid review date is stale.
  - A stale snapshot resolves to `consult` even if every matched ingredient is `safe`.
  - A current snapshot uses ingredient and category/procedure findings with the defined precedence.

- [ ] Implement the smallest pure functions needed to pass the tests. Return structured scan results:

```js
{
  tokens: [],
  matches: [{ token, ruleId, status }],
  unresolved: [],
  truncated: false,
  overallStatus: "safe" | "limit" | "avoid" | "consult"
}
```

- [ ] Run `npm run check`.
  - Expected: all engine and food-regression tests pass.

- [ ] Commit:

```bash
git add index.html tests
git commit -m "feat: add deterministic personal care matching engine"
```

---

## Task 3: Build the authoritative evidence registry and 80+ ingredient rules

**Files:**
- Modify: `index.html`
- Create: `docs/personal-care-evidence.md`
- Create: `tests/personal-care-data.test.mjs`

- [ ] Create `docs/personal-care-evidence.md` as the audit ledger. Each row must contain:
  - rule ID
  - exact conclusion used
  - authority and document title
  - direct URL
  - publication/update date when available
  - access date
  - concise paraphrase of the relevant evidence
  - whether it supports safety, limitation, avoidance, uncertainty, or only formula identity

- [ ] Populate `personal-care-sources` with stable IDs and this schema:

```js
{
  "id": "acog-skin-pregnancy",
  "organization": "ACOG",
  "title": "Skin Conditions During Pregnancy",
  "url": "https://www.acog.org/womens-health/faqs/skin-conditions-during-pregnancy",
  "publishedOrUpdated": "",
  "accessed": "2026-07-27",
  "topics": ["acne", "retinoids", "salicylic-acid", "azelaic-acid"]
}
```

- [ ] Verify and record, at minimum, these already-identified primary pages:
  - ACOG, `Skin Conditions During Pregnancy`
  - MotherToBaby, `Topical Acne Treatments`
  - FDA, `Cosmetics & Pregnancy`
  - NHS, `Using hair dye in pregnancy: is it safe?`
  - Relevant NMPA cosmetics labeling, prohibited/restricted ingredient, sunscreen, hair dye, and safety-assessment materials
  - FDA/EMA/NHS or formal professional guidance for minoxidil, topical anesthetics, medicated anti-dandruff products, essential oils, and cosmetic procedures

- [ ] If a direct page is inaccessible, record the access gap in the ledger and replace it with a second authoritative public source. Do not cite a search-results page, blog, forum, marketplace description, or AI summary.

- [ ] Add a failing schema test requiring every source to have unique `id`, authoritative `organization`, `title`, HTTPS `url`, valid `accessed`, and non-empty `topics`.

- [ ] Define every ingredient rule with:

```js
{
  "id": "retinoids-topical",
  "names": {
    "zh": ["外用维A酸类"],
    "en": ["topical retinoids"],
    "inci": ["Retinol", "Retinal", "Retinyl Palmitate"],
    "aliases": ["维A醇", "视黄醇", "视黄醛", "A醇"]
  },
  "family": "retinoids",
  "category": "功效护肤",
  "status": "avoid",
  "summary": "孕期建议避免外用维A酸类成分。",
  "rationale": "权威孕期皮肤指导基于风险规避建议避免使用。",
  "conditions": {
    "rinseOff": "",
    "leaveOn": "避免",
    "area": "",
    "frequency": "",
    "concentration": "",
    "trimester": "全孕期",
    "ventilation": "",
    "brokenSkin": ""
  },
  "alternatives": ["壬二酸", "烟酰胺"],
  "sourceIds": ["acog-skin-pregnancy", "mothertobaby-topical-acne"],
  "reviewed": "2026-07-27"
}
```

- [ ] Write failing data tests requiring:
  - at least 80 rules and unique rule IDs
  - unique normalized aliases across unrelated rules
  - valid status and review date
  - non-empty summary and rationale
  - all `sourceIds` resolve
  - every `limit`, `avoid`, and `consult` rule has at least one source
  - every `limit` rule names the actual limiting condition
  - every `avoid` rule offers an alternative when a reasonable substitute exists
  - no summary contains `绝对安全`, `完全安全`, `一定致畸`, or unsupported alarmist wording

- [ ] Populate at least 80 rules covering all of these launch families:
  - Retinoids: tretinoin, adapalene, tazarotene, retinol, retinal, retinyl esters
  - Acne/keratolytic: salicylic acid, beta-hydroxy acids, benzoyl peroxide, azelaic acid, glycolic acid, lactic acid, sulfur
  - Pigmentation: hydroquinone, arbutin, tranexamic acid, kojic acid, vitamin C derivatives, niacinamide
  - Sun protection: zinc oxide, titanium dioxide, avobenzone, octocrylene, oxybenzone/benzophenone-3, octinoxate, homosalate
  - Hair/scalp: minoxidil, ketoconazole, selenium sulfide, zinc pyrithione where market-relevant, coal tar, piroctone olamine, hair-dye oxidative intermediates
  - Antimicrobial/preservative: chlorhexidine, triclosan, parabens, phenoxyethanol, formaldehyde releasers, methylisothiazolinone
  - Fragrance/essential oils: fragrance mixtures, peppermint, rosemary, tea tree, lavender, eucalyptus, clary sage, citrus phototoxic oils
  - Oral care: fluoride, hydrogen peroxide whitening, chlorhexidine rinse, alcohol-containing rinse
  - Nail/adhesive/solvent: acetone, toluene, formaldehyde, dibutyl phthalate, methacrylates, cyanoacrylates
  - Depilation/deodorant: thioglycolates, aluminum salts, depilatory alkalis
  - Cosmetic actives/base ingredients: hyaluronic acid, ceramides, glycerin, petrolatum, squalane, panthenol, peptides, caffeine, urea, centella components, aloe
  - Topical medicines encountered in personal care: lidocaine, pramoxine, hydrocortisone, clotrimazole, terbinafine

- [ ] Model families plus individual aliases rather than inventing separate medical conclusions merely to reach the count. Multiple rules are allowed only when route, concentration, or use context materially changes the advice.

- [ ] Run `npm run check`.
  - Expected: at least 80 ingredient rules pass every schema, evidence, wording, and alias-integrity test.

- [ ] Commit:

```bash
git add index.html docs/personal-care-evidence.md tests
git commit -m "data: add evidence-linked pregnancy ingredient guidance"
```

---

## Task 4: Add 40+ category, salon, and medical-aesthetic procedure rules

**Files:**
- Modify: `index.html`
- Modify: `docs/personal-care-evidence.md`
- Modify: `tests/personal-care-data.test.mjs`

- [ ] Add failing tests requiring at least 40 procedure/category rules with unique IDs, aliases, a valid status, rationale, conditions, review date, and resolvable sources.

- [ ] Use this schema:

```js
{
  "id": "hair-dye",
  "name": "染发",
  "aliases": ["染头发", "染发剂", "永久染发"],
  "category": "美发",
  "status": "limit",
  "summary": "多数研究提示个人使用暴露较低，但应减少不必要暴露并严格通风。",
  "rationale": "证据不能覆盖所有配方和职业性高频暴露。",
  "conditions": {
    "trimester": "如希望更谨慎，可考虑孕12周后",
    "frequency": "降低频率",
    "ventilation": "良好通风并戴手套",
    "skin": "头皮破损或过敏时不要使用",
    "duration": "不超过标签规定时间"
  },
  "alternatives": ["挑染或不接触头皮的方式", "暂缓染发"],
  "sourceIds": ["nhs-hair-dye-pregnancy"],
  "reviewed": "2026-07-27"
}
```

- [ ] Cover at least these categories and procedures:
  - Daily skin care: cleansing, moisturizing, sunscreen, sheet masks, makeup, makeup removal, anti-acne, brightening, anti-aging
  - Hair/scalp: shampoo, conditioner, anti-dandruff products, hair dye, bleaching, perming, straightening, hair spray, dry shampoo, minoxidil
  - Oral/body care: toothpaste, mouthwash, tooth whitening, deodorant/antiperspirant, body lotion, intimate wash, depilatory cream, self-tanner
  - Nails/lashes: ordinary manicure, gel manicure, acrylic nails, nail removal, nail glue, eyelash extensions, lash perm/lift
  - Salon/spa: facial extraction, superficial peel, strong chemical peel, steam/sauna, hot bath, massage, aromatherapy, spray tan
  - Medical aesthetics: botulinum toxin, dermal filler, microneedling, radiofrequency, ultrasound lifting, IPL, pigment laser, ablative laser, hair-removal laser, injectable skin boosters, mesotherapy

- [ ] For every procedure, explicitly distinguish:
  - home cosmetic use versus professional/occupational exposure
  - leave-on versus rinse-off when relevant
  - heat, inhalation, broken-skin, infection, anesthetic, and post-procedure medication considerations
  - elective cosmetic procedures versus medically necessary treatment

- [ ] Use `consult` when direct pregnancy evidence is inadequate, especially for elective energy-based or injectable procedures. Do not translate “no evidence of harm” into “safe.”

- [ ] Run `npm run check`.
  - Expected: all procedure/category schema and evidence tests pass, and total coverage is at least 40.

- [ ] Commit:

```bash
git add index.html docs/personal-care-evidence.md tests
git commit -m "data: add pregnancy guidance for personal care procedures"
```

---

## Task 5: Add 30+ formula-versioned common product snapshots

**Files:**
- Modify: `index.html`
- Modify: `docs/personal-care-evidence.md`
- Modify: `tests/personal-care-data.test.mjs`
- Modify: `tests/personal-care-engine.test.mjs`

- [ ] Add failing schema tests requiring every product snapshot to have:
  - unique `id`
  - `brand`, exact `name`, and useful aliases
  - category
  - `formulaRegion`
  - valid `formulaReviewed`
  - direct HTTPS `formulaSourceUrl`
  - non-empty INCI ingredient array
  - no independent medical status override

- [ ] Require at least 30 verified snapshots across these quotas:
  - 6 cleansers/moisturizers
  - 6 sunscreen products
  - 8 acne, brightening, or anti-aging products
  - 4 shampoo or anti-dandruff products
  - 3 oral-care products
  - 3 body-care, deodorant, nail, or hair-styling products

- [ ] Prefer products commonly available in mainland China from brands such as CeraVe, Curél, La Roche-Posay, Avène, Bioderma, Olay, L’Oréal, The Ordinary, Anessa, Head & Shoulders, Colgate, and Crest. Include a product only when the exact regional formula can be verified from an official brand page, regulator filing, official package image, or another traceable primary record. If one target is unverifiable, replace it with another product in the same quota.

- [ ] Use this exact shape:

```js
{
  "id": "brand-product-region-version",
  "brand": "品牌",
  "name": "包装上的完整商品名",
  "aliases": ["用户常搜简称", "系列名"],
  "category": "防晒",
  "formulaRegion": "中国大陆",
  "formulaReviewed": "2026-07-27",
  "formulaSourceUrl": "https://...",
  "ingredients": ["Aqua", "Zinc Oxide"],
  "notes": ["配方可能改版，请以当前包装成分表为准"]
}
```

- [ ] Do not copy a US/EU formula into a mainland-China snapshot. If only a non-China formula is available, label that exact region and ensure the display warns users to compare their package.

- [ ] Add product-resolution tests:
  - aliases find the correct product
  - a current product derives status only from matched ingredient rules and applicable category conditions
  - unmatched ingredients remain visible as unresolved
  - a formula older than 365 days downgrades the overall result to `consult`
  - formula source never appears as the medical evidence source

- [ ] Record formula provenance in the evidence ledger under a distinct “formula identity only” classification.

- [ ] Run `npm run check`.
  - Expected: at least 30 snapshots pass all provenance, region, freshness, and resolution tests.

- [ ] Commit:

```bash
git add index.html docs/personal-care-evidence.md tests
git commit -m "data: add versioned common product snapshots"
```

---

## Task 6: Build the unified “饮食 / 个护” mobile interface

**Files:**
- Modify: `index.html`
- Modify: `tests/site-regression.test.mjs`
- Create: `tests/personal-care-ui.test.mjs`

- [ ] Before changing the UI, invoke the `frontend-design` skill and preserve the page’s restrained, reassuring visual language. Do not make it resemble an e-commerce catalog or a medical diagnosis app.

- [ ] Add a semantic top-level channel switch:

```html
<nav class="channel-switch" aria-label="速查类型">
  <button type="button" role="tab" aria-selected="true" data-channel-target="food">饮食</button>
  <button type="button" role="tab" aria-selected="false" data-channel-target="personal-care">个护</button>
</nav>
```

- [ ] Keep the food channel initially active for first-time visitors. Restore only the last chosen channel from `localStorage["pregnancy-guide-channel"]`; guard storage access so private-browsing failures do not break the page.

- [ ] Create separate channel containers with `data-channel="food"` and `data-channel="personal-care"`. On channel switch:
  - update `aria-selected`
  - update hidden state and focus behavior
  - update document title/intro/search copy
  - clear transient queries and results
  - never persist query text

- [ ] Build the personal-care search entry around ordinary user language:
  - placeholder: `搜成分、商品或项目，如：视黄醇、防晒霜、染发`
  - quick categories: 护肤、防晒、彩妆、洗发护发、口腔、身体护理、美甲美睫、美容项目、医美项目
  - status filters for all four statuses
  - result count and empty state

- [ ] Render ingredient/procedure cards with:
  - status and short conclusion first
  - “为什么”
  - context conditions: leave-on/rinse-off, area, frequency, concentration, trimester, ventilation, and broken skin only when present
  - practical alternatives
  - “查看依据” disclosure with organization, title, review date, and direct link
  - no raw internal IDs

- [ ] Render product cards with:
  - exact brand/product/region
  - derived status rather than hard-coded pregnancy verdict
  - matched ingredients and unresolved ingredients
  - formula review date and freshness warning
  - separate “配方来源” and “医学依据”
  - reminder to compare the current package

- [ ] Add an ingredient-list scanner below the ordinary search:
  - multiline `<textarea id="ingredient-scanner-input">`
  - explicit `开始分析` and `清空` buttons
  - sample-input button using a clearly labeled demonstration formula
  - result summary, matched rule list, unresolved list, and truncation warning
  - all result announcements through an `aria-live="polite"` region
  - never read the clipboard automatically

- [ ] Add a visible “怎么判断的” section explaining deterministic rules, formula version limits, unknown-ingredient handling, and the absence of runtime AI judgment.

- [ ] Add red-flag guidance separate from ordinary cards:
  - breathing difficulty, facial/lip swelling, widespread blistering, fainting, or other severe reactions → urgent medical help
  - accidental one-time use without symptoms → stop if appropriate, retain package/ingredient information, and discuss at routine care rather than panic

- [ ] Add UI structure tests that assert:
  - both channel tabs and both channel containers exist
  - personal-care search and scanner controls exist
  - four status filters exist
  - `aria-live` and disclosure controls exist
  - the only literal localStorage key in application code is `pregnancy-guide-channel`
  - no `fetch`, `XMLHttpRequest`, `WebSocket`, remote script, or remote stylesheet is introduced

- [ ] Extend food regression tests to compare the food-data count and named fixtures before and after rendering changes.

- [ ] Run `npm run check`.
  - Expected: all engine, data, UI, accessibility-structure, and food-regression tests pass.

- [ ] Commit:

```bash
git add index.html tests
git commit -m "feat: add unified pregnancy personal care lookup UI"
```

---

## Task 7: Perform medical-content QA, accessibility QA, and real browser verification

**Files:**
- Modify: `index.html` only if verification exposes defects
- Modify: `docs/personal-care-evidence.md` only if evidence defects are found
- Create: `docs/personal-care-release-checklist.md`

- [ ] Create `docs/personal-care-release-checklist.md` with separate sections for:
  - automated checks
  - medical-content review
  - mobile/browser review
  - post-deploy checks

- [ ] Run `npm run check`.
  - Expected: exit code 0 and no skipped tests.

- [ ] Run a static-page audit for outbound links:

```bash
node --input-type=module -e '
import { readFile } from "node:fs/promises";
const html = await readFile("index.html", "utf8");
const urls = [...html.matchAll(/https:\/\/[^"<> ]+/g)].map((m) => m[0]);
console.log(JSON.stringify({ total: urls.length, unique: new Set(urls).size }));
'
```

  - Expected: all external links are HTTPS; manually check each unique evidence/formula URL returns a valid page or redirect.

- [ ] Conduct a reverse medical review, working from every `avoid`, `limit`, and `consult` conclusion back to its source:
  - conclusion is no stronger than the evidence
  - use route and context match the source
  - formula-only sources are not used medically
  - concentration or trimester claims are supported
  - uncertainty is visible
  - alternatives do not introduce another restricted ingredient

- [ ] Test these exact searches in a local browser:
  - `视黄醇` → avoid guidance with sources
  - `水杨酸` → context-limited guidance, not blanket prohibition
  - `染发` → limitation, ventilation/glove/skin conditions
  - `肉毒素` → consultation/avoid-elective framing without alarmism
  - one verified product alias → correct region/version and derived result
  - unknown brand/product → no fabricated verdict; route to ingredient-list scanner

- [ ] Test scanner inputs:
  - mixed Chinese/INCI separators
  - duplicate ingredients
  - one known avoid plus several safe ingredients
  - one limit plus one unknown ingredient
  - more than 200 tokens
  - empty input

- [ ] Verify at 375×812 and 430×932 viewports:
  - no horizontal scrolling
  - 44px minimum touch targets
  - channel switch remains visible and understandable
  - search, filters, cards, disclosures, and scanner fit without clipped text
  - long INCI names and URLs wrap
  - on-screen keyboard does not hide the primary action

- [ ] Verify keyboard-only navigation and visible focus for channel tabs, filters, category buttons, disclosures, search, textarea, and scanner actions.

- [ ] Verify with JavaScript disabled that the page at least shows the title, explanatory copy, and a notice that search requires JavaScript.

- [ ] Record exact pass/fail evidence and any residual limitations in `docs/personal-care-release-checklist.md`. Leave the post-deploy section pending until Task 8.

- [ ] Fix any defect found, rerun `npm run check`, and repeat the affected manual case.

- [ ] Commit:

```bash
git add index.html docs
git commit -m "docs: complete personal care release verification"
```

---

## Task 8: Publish to GitHub Pages and verify the public no-login experience

**Files:**
- Modify: `docs/personal-care-release-checklist.md`
- Git refs: `main`, `gh-pages`

- [ ] Invoke `superpowers:verification-before-completion`.

- [ ] Confirm the intended scope:

```bash
git status --short
git log --oneline --decorate -8
git diff 030a363..HEAD --stat
```

  - Expected: only `index.html`, `package.json`, `tests/`, and `docs/` contain planned changes; the worktree is clean.

- [ ] Run the final local gate:

```bash
npm run check
```

  - Expected: exit code 0.

- [ ] Push the reviewed commits to `main`:

```bash
git push origin main
```

- [ ] Update the existing `gh-pages` branch from the verified source commit without dropping the project history:

```bash
git switch gh-pages
git merge --ff-only main
git push origin gh-pages
git switch main
```

  - If fast-forward is impossible, stop and inspect the divergence. Do not force-push.

- [ ] Poll GitHub Pages until `https://xuntawang.github.io/pregnancy-food-guide/` returns HTTP 200 and the deployed HTML includes both `personal-care-ingredients` and the “饮食 / 个护” switch.

- [ ] Open the public URL in a clean/no-login browser session and verify:
  - page loads without GitHub or ChatGPT login
  - food lookup still works
  - personal-care search works
  - ingredient scanner works without a network request
  - source links open
  - refresh restores only the selected channel

- [ ] Fill the post-deploy section of `docs/personal-care-release-checklist.md` with the public URL, deployed commit SHA, verification time, HTTP result, and the five checks above.

- [ ] Commit and publish only the completed post-deploy record:

```bash
git add docs/personal-care-release-checklist.md
git commit -m "docs: record personal care production verification"
git push origin main
git switch gh-pages
git merge --ff-only main
git push origin gh-pages
git switch main
```

- [ ] Recheck the public page after the documentation-only deploy and report the final URL plus any known content limitations.

---

## Definition of Done

- [ ] The public page offers a clear top-level “饮食 / 个护” switch and needs no login.
- [ ] Existing food lookup and all existing food records remain intact.
- [ ] Personal-care search covers ingredients, common product categories, verified products, salon services, and medical-aesthetic procedures.
- [ ] Ingredient-list scanning is deterministic, local-only, transparent, and never labels an unknown ingredient safe.
- [ ] Launch data meets the 80 / 40 / 30 minimums and passes schema/evidence tests.
- [ ] Every actionable restriction is traceable to authoritative evidence and a review date.
- [ ] Product advice is formula-, region-, and date-aware, with stale snapshots downgraded.
- [ ] Mobile, keyboard, and no-login public checks are recorded.
- [ ] `npm run check` passes against the exact commit deployed to GitHub Pages.
