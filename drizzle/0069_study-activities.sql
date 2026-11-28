CREATE TABLE `study_activities` (
	`key` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`energy_deci` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `study_activities_user_day_idx` ON `study_activities` (`user_id`,`day`);