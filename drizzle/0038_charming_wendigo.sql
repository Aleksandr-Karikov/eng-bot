PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_usage_counters` (
	`user_id` integer NOT NULL,
	`period` text NOT NULL,
	`kind` text NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `period`, `kind`, `scope`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- scope в старой таблице ещё нет, поэтому подставляем значение по умолчанию литералом:
-- drizzle не знает истории и сгенерировал SELECT "scope", который на существующей базе упал бы.
INSERT INTO `__new_usage_counters`("user_id", "period", "kind", "scope", "count", "updated_at") SELECT "user_id", "period", "kind", '', "count", "updated_at" FROM `usage_counters`;--> statement-breakpoint
DROP TABLE `usage_counters`;--> statement-breakpoint
ALTER TABLE `__new_usage_counters` RENAME TO `usage_counters`;--> statement-breakpoint
PRAGMA foreign_keys=ON;