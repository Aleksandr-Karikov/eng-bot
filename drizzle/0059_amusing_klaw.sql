CREATE TABLE `grammar_exercises` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` integer NOT NULL,
	`kind` text NOT NULL,
	`prompt` text NOT NULL,
	`options` text DEFAULT '' NOT NULL,
	`answer` text NOT NULL,
	`why` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `grammar_topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `grammar_exercises_topic_idx` ON `grammar_exercises` (`topic_id`);--> statement-breakpoint
CREATE TABLE `grammar_progress` (
	`user_id` integer NOT NULL,
	`topic_id` integer NOT NULL,
	`streak` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`passed` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `topic_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`topic_id`) REFERENCES `grammar_topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `grammar_topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`level` text DEFAULT 'A1' NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`rule` text DEFAULT '' NOT NULL,
	`examples` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grammar_topics_slug_unique` ON `grammar_topics` (`slug`);