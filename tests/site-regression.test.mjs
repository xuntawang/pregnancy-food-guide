import assert from "node:assert/strict";
import test from "node:test";

import { extractJsonScript, extractScript, readIndexHtml } from "./helpers/load-site.mjs";

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

  const keyFoods = new Map(foods.map((food) => [food.name, food]));
  assert.deepEqual(
    {
      "全熟鸡蛋": keyFoods.get("全熟鸡蛋")?.status,
      "巴氏杀菌或灭菌牛奶": keyFoods.get("巴氏杀菌或灭菌牛奶")?.status,
      "三文鱼": keyFoods.get("三文鱼")?.status,
      "咖啡": keyFoods.get("咖啡")?.status,
      "生鱼片": keyFoods.get("生鱼片")?.status,
    },
    {
      "全熟鸡蛋": "safe",
      "巴氏杀菌或灭菌牛奶": "safe",
      "三文鱼": "safe",
      "咖啡": "limit",
      "生鱼片": "avoid",
    },
  );
});

test("extractScript 接受省略 type 的脚本", () => {
  assert.equal(extractScript('<script id="engine">globalThis.ok = true;</script>', "engine"), "globalThis.ok = true;");
});

test("extractScript 接受标准 JavaScript MIME 类型", () => {
  assert.equal(
    extractScript('<script id="engine" type="application/javascript">globalThis.ok = true;</script>', "engine"),
    "globalThis.ok = true;",
  );
});

test("extractScript 接受带参数的 JavaScript MIME 类型", () => {
  assert.equal(
    extractScript('<script id="engine" type=" text/javascript; charset=utf-8 ">globalThis.ok = true;</script>', "engine"),
    "globalThis.ok = true;",
  );
});

for (const type of ["text/plain", "application/ld+json"]) {
  test(`extractScript 拒绝 ${type}`, () => {
    assert.throws(
      () => extractScript(`<script id="engine" type="${type}">globalThis.ok = true;</script>`, "engine"),
      /不是可执行 JavaScript 脚本/,
    );
  });
}

test("extractScript 拒绝带参数的非 JavaScript MIME 类型", () => {
  assert.throws(
    () => extractScript('<script id="engine" type="application/ld+json; charset=utf-8">{}</script>', "engine"),
    /不是可执行 JavaScript 脚本/,
  );
});

test("extractScript 拒绝同 ID 的非可执行脚本冲突", () => {
  assert.throws(
    () => extractScript('<script id="engine">globalThis.ok = true;</script><script id="engine" type="text/plain">not code</script>', "engine"),
    /包含非可执行脚本/,
  );
});

test("extractScript 拒绝多个同 ID 的可执行脚本", () => {
  assert.throws(
    () => extractScript('<script id="engine"></script><script id="engine" type="text/javascript"></script>', "engine"),
    /找到多个 ID 为 "engine" 的可执行脚本/,
  );
});
