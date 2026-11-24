import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const planPath = join(root, 'docs/PLAN.md');
const indexPath = join(root, 'docs/INDEX.md');

/** Номер задачи: E — eng-bot. Менять только вместе с существующими строками плана. */
const TASK_ID = /^- \[([ x])\] \*\*(E\d+)\*\* — (.+)$/;

export function parsePlan(source) {
    let fenced = false;
    return source.split('\n').flatMap((line, index) => {
        if (line.startsWith('```')) {
            fenced = !fenced;
            return [];
        }
        if (fenced) return [];
        const match = TASK_ID.exec(line);
        return match ? [{ id: match[2], done: match[1] === 'x', body: match[3], line: index + 1, raw: line }] : [];
    });
}

export function validatePlan(tasks, journalExists) {
    const errors = [];
    const seen = new Set();
    for (const task of tasks) {
        if (seen.has(task.id)) errors.push(`${task.id}: повтор номера`);
        seen.add(task.id);
        if (task.done) {
            if (!task.body.includes(`[журнал](journal/${task.id}.md)`)) errors.push(`${task.id}: нет ссылки на журнал`);
            if (!journalExists(task.id)) errors.push(`${task.id}: нет файла журнала`);
        } else {
            for (const field of ['**Спека:**', '**Приёмка:**', '➡️ **Сейчас:**']) {
                if (!task.body.includes(field)) errors.push(`${task.id}: нет ${field}`);
            }
        }
    }
    return errors;
}

export function renderIndex(tasks) {
    return [
        '# Индекс задач',
        '',
        '<!-- Генерируется командой npm run docs:index. Руками не править. -->',
        '',
        '| Номер | Статус | Задача | Строка плана |',
        '| --- | --- | --- | --- |',
        ...tasks.map(
            ({ id, done, body, line }) =>
                `| ${id} | ${done ? 'Готово' : 'Открыта'} | ${body.split(' **Спека:**')[0].replace(/\.$/, '')} | ${line} |`,
        ),
        '',
    ].join('\n');
}

function main(args) {
    const [command, id] = args;
    if (!existsSync(planPath)) throw new Error(`Нет ${planPath}: план задач ещё не заведён`);
    const tasks = parsePlan(readFileSync(planPath, 'utf8'));
    const errors = validatePlan(tasks, (taskId) => existsSync(join(root, `docs/journal/${taskId}.md`)));
    if (errors.length) throw new Error(errors.join('\n'));
    const index = renderIndex(tasks);
    if (command === 'index') {
        writeFileSync(indexPath, index);
        console.log(`Обновлён docs/INDEX.md: ${tasks.length} задач`);
    } else if (command === 'check') {
        if (!existsSync(indexPath) || readFileSync(indexPath, 'utf8') !== index)
            throw new Error('docs/INDEX.md устарел: запусти npm run docs:index');
        console.log(`Документы согласованы: ${tasks.length} задач`);
    } else if (command === 'context') {
        const task = tasks.find((row) => row.id === id);
        if (!task) throw new Error(`Задача ${id || '(номер не указан)'} не найдена в docs/PLAN.md`);
        console.log(`${planPath}:${task.line}\n${task.raw}\n`);
        if (task.done) console.log(`Журнал: docs/journal/${id}.md`);
        else console.log('Открытая задача: дополняй блок ➡️ **Сейчас:** по ходу работы — он часть задачи.');
        console.log(
            [
                '',
                'Правила правки: AGENTS.md',
                'Карта системы: docs/architecture.md',
                'Лимиты и права админа: docs/limits.md',
                'Путь задачи: docs/CONTRIBUTING.md',
                '',
                'Гейт: npm test && npm run typecheck (Mini App — cd app && npm run build)',
            ].join('\n'),
        );
    } else {
        throw new Error('Использование: node scripts/docs.mjs index|check|context E<номер>');
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
