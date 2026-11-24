-- Удаление изучаемого языка: остаётся только английский (E23).
--
-- Почему данные удаляются, а не переносятся: корейский был экспериментом и оказался не нужен.
-- В проде на 24 ноября 2026 — 2 корейские комнаты и 9 слов в них, при этом ни одного ответа по этим
-- словам не было (проверено по копии прод-базы: `review_logs` по их карточкам пуст), а у обоих
-- участников есть английские комнаты. Переносить нечего, терять нечего.
--
-- Удаление идёт ПЕРВЫМ шагом, до удаления колонки `language`: после `DROP COLUMN` отличить корейские
-- комнаты было бы уже нечем. Порядок здесь — часть смысла миграции, а не удобство.
-- Порядок обратный зависимостям: сначала то, что ссылается, потом то, на что ссылаются.
-- На копии прод-базы у корейских комнат было 9 слов, 6 карточек и 5 записей ответов — поэтому
-- удаление слов первым падало на FOREIGN KEY, и это проверено прогоном, а не предположено.
DELETE FROM `review_logs` WHERE `card_id` IN (
  SELECT `c`.`id` FROM `cards` `c` JOIN `words` `w` ON `w`.`id` = `c`.`word_id`
  WHERE `w`.`room_id` IN (SELECT `id` FROM `rooms` WHERE `language` = 'ko')
);--> statement-breakpoint
DELETE FROM `cards` WHERE `word_id` IN (
  SELECT `id` FROM `words` WHERE `room_id` IN (SELECT `id` FROM `rooms` WHERE `language` = 'ko')
);--> statement-breakpoint
DELETE FROM `words` WHERE `room_id` IN (SELECT `id` FROM `rooms` WHERE `language` = 'ko');--> statement-breakpoint
DELETE FROM `room_members` WHERE `room_id` IN (SELECT `id` FROM `rooms` WHERE `language` = 'ko');--> statement-breakpoint
-- Истории недель тоже ссылаются на комнату. На копии прод-базы у корейской комнаты 19 была одна
-- история — поэтому без этой строки удаление комнаты падало на FOREIGN KEY (проверено прогоном).
DELETE FROM `stories` WHERE `room_id` IN (SELECT `id` FROM `rooms` WHERE `language` = 'ko');--> statement-breakpoint
DELETE FROM `rooms` WHERE `language` = 'ko';--> statement-breakpoint

DROP INDEX `rooms_personal_lang_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_personal_idx` ON `rooms` (`personal_owner`);--> statement-breakpoint
ALTER TABLE `rooms` DROP COLUMN `language`;--> statement-breakpoint
ALTER TABLE `grammar_topics` DROP COLUMN `language`;--> statement-breakpoint
ALTER TABLE `word_sets` DROP COLUMN `language`;