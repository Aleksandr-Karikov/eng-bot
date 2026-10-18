ALTER TABLE `rooms` ADD `weekly_goal` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `goal_reached_week` text;