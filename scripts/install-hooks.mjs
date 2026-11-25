#!/usr/bin/env node
/**
 * Ставит git-хуки проекта: `core.hooksPath` → `.githooks`.
 *
 * Зачем нужен, когда есть `core.hooksPath`: переменная живёт в `.git/config`, то есть у каждого
 * человека своя. Без установки свежий клон о хуках не знает вовсе. `prepare` вызывается сам после
 * `npm install`, поэтому новая машина получает их без отдельного шага.
 *
 * В CI и на сервере хуки не нужны: там `CI` выставлен, а гейт всё равно прогоняет GitHub Actions.
 * Ошибкой это не считается — установка просто пропускается.
 */
import { execFileSync } from "node:child_process";
import { existsSync, chmodSync } from "node:fs";

const quiet = process.env.CI === "1" || process.env.CI === "true" || !process.stdin.isTTY;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** `git config --get` без ключа выходит с кодом 1 — это «не задано», а не ошибка. */
function configGet(key) {
  try {
    return git(["config", "--get", key]);
  } catch {
    return "";
  }
}

try {
  // Не в репозитории (архив, распакованный тарбол) — ставить нечего.
  const root = git(["rev-parse", "--show-toplevel"]);
  if (!existsSync(`${root}/.githooks/pre-commit`)) {
    if (!quiet) console.log("hooks: .githooks/pre-commit не найден — пропускаю");
    process.exit(0);
  }

  // Права на исполнение не едут через git: `chmod +x` нужен в каждом клоне.
  chmodSync(`${root}/.githooks/pre-commit`, 0o755);

  if (configGet("core.hooksPath") === ".githooks") {
    if (!quiet) console.log("hooks: уже установлены");
    process.exit(0);
  }

  git(["config", "core.hooksPath", ".githooks"]);
  if (!quiet) console.log("hooks: установлены (.githooks) — проверки пойдут на git commit");
} catch (err) {
  // Установка хуков не должна валить `npm install`: без неё проект собирается и работает.
  if (!quiet) console.log(`hooks: не удалось установить — ${err instanceof Error ? err.message : String(err)}`);
}
