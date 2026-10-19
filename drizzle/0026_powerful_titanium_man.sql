CREATE INDEX `cards_word_idx` ON `cards` (`word_id`);--> statement-breakpoint
CREATE INDEX `cloze_word_idx` ON `cloze_sentences` (`word_id`);--> statement-breakpoint
CREATE INDEX `drill_answers_user_category_idx` ON `drill_answers` (`user_id`,`category`);--> statement-breakpoint
CREATE INDEX `mistakes_user_idx` ON `mistakes` (`user_id`);--> statement-breakpoint
CREATE INDEX `review_logs_user_time_idx` ON `review_logs` (`user_id`,`reviewed_at`);--> statement-breakpoint
CREATE INDEX `review_logs_card_idx` ON `review_logs` (`card_id`);--> statement-breakpoint
CREATE INDEX `room_members_user_idx` ON `room_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `stories_room_idx` ON `stories` (`room_id`);--> statement-breakpoint
CREATE INDEX `word_uses_user_time_idx` ON `word_uses` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `word_uses_room_time_idx` ON `word_uses` (`room_id`,`created_at`);