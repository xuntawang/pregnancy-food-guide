import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const indexHtmlUrl = new URL("../../index.html", import.meta.url);
const javaScriptMimeTypes = new Set([
  "application/ecmascript",
  "application/javascript",
  "text/ecmascript",
  "text/javascript",
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getAttribute(attributes, name) {
  const match = attributes.match(
    new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])(.*?)\\1`, "i"),
  );
  return match?.[2];
}

function findScripts(html, id) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter((match) => getAttribute(match[1], "id") === id)
    .map((match) => ({ attributes: match[1], content: match[2] }));
}

function isExecutableJavaScript(attributes) {
  const type = getAttribute(attributes, "type");
  return type === undefined || javaScriptMimeTypes.has(type.trim().toLowerCase());
}

export function readIndexHtml() {
  return readFileSync(fileURLToPath(indexHtmlUrl), "utf8");
}

export function extractJsonScript(html, id) {
  const scripts = findScripts(html, id).filter(
    ({ attributes }) => getAttribute(attributes, "type")?.toLowerCase() === "application/json",
  );

  if (scripts.length === 0) {
    throw new Error(`未找到 ID 为 \"${id}\" 的 application/json 脚本`);
  }
  if (scripts.length > 1) {
    throw new Error(`找到多个 ID 为 \"${id}\" 的 application/json 脚本`);
  }

  return JSON.parse(scripts[0].content);
}

export function extractScript(html, id) {
  const scripts = findScripts(html, id);

  if (scripts.length === 0) {
    throw new Error(`未找到 ID 为 \"${id}\" 的可执行脚本`);
  }

  const invalidScripts = scripts.filter(({ attributes }) => !isExecutableJavaScript(attributes));
  if (invalidScripts.length > 0) {
    if (scripts.length > 1) {
      throw new Error(`ID 为 \"${id}\" 的脚本包含非可执行脚本`);
    }
    throw new Error(`ID 为 \"${id}\" 的脚本不是可执行 JavaScript 脚本`);
  }
  if (scripts.length > 1) {
    throw new Error(`找到多个 ID 为 \"${id}\" 的可执行脚本`);
  }

  return scripts[0].content;
}

export function loadPersonalCareEngine(html) {
  const context = {};
  vm.runInNewContext(extractScript(html, "personal-care-engine"), context);
  if (!context.personalCareEngine) {
    throw new Error("个人护理规则引擎未设置 globalThis.personalCareEngine");
  }
  return context.personalCareEngine;
}
