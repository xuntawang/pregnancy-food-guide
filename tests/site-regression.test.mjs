import assert from "node:assert/strict";
import test from "node:test";

import { extractJsonScript, readIndexHtml } from "./helpers/load-site.mjs";

test("保留现有孕期饮食速查", () => {
  const html = readIndexHtml();
  const foods = extractJsonScript(html, "food-data");
  assert.ok(html.includes('id="food-search"'));
  assert.ok(html.includes('id="food-grid"'));
  assert.ok(html.includes('id="category-bar"'));
  assert.match(html, /不能替代产科医生|个体化建议/);
  assert.equal(foods.length, 157);
  for (const name of ["全熟鸡蛋", "巴氏杀菌或灭菌牛奶", "三文鱼", "咖啡", "生鱼片"]) {
    assert.ok(foods.some((food) => food.name === name), `缺少：${name}`);
  }
});
