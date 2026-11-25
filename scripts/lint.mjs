#!/usr/bin/env node
/**
 * Линт проекта. Отдельный скрипт, потому что у `app/` своя установка зависимостей
 * (`app/node_modules`), а линт с анализом типов без неё не работает.
 *
 * Что происходит без `app/node_modules`: oxlint не может построить программу TypeScript для
 * `app/src` (React-типы не находятся) и выдаёт ~1900 ложных «error typed value» вместо настоящих
 * находок. Поэтому `app/src` проверяется только когда его зависимости на месте, а в остальных
 * случаях выводится предупреждение — молча пропускать нечего, но и врать про ошибки нельзя.
 *
 * Полный обхват даёт установка зависимостей приложения: `cd app && npm ci` (так делает CI и деплой).
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const ROOT_DIRS = ["src", "tests", "scripts"];
const APP_DIR = "app/src";

const fix = process.argv.includes("--fix");
const appReady = existsSync("app/node_modules");

const dirs = appReady ? [...ROOT_DIRS, APP_DIR] : ROOT_DIRS;
const args = ["oxlint", ...dirs, ...(fix ? ["--fix"] : [])];

if (!appReady) {
  console.warn(
    "lint: app/node_modules нет — app/src не проверен. Полный прогон: cd app && npm ci",
  );
}

const result = spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
