CREATE TABLE `signal_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`observed_at` text NOT NULL,
	`observed_bucket` text NOT NULL,
	`session_date` text NOT NULL,
	`source_mode` text NOT NULL,
	`board_id` text NOT NULL,
	`theme_name` text NOT NULL,
	`phase` text NOT NULL,
	`score` integer NOT NULL,
	`leader_one_code` text,
	`leader_one_name` text,
	`leader_one_change_bps` integer,
	`leader_two_code` text,
	`leader_two_name` text,
	`leader_two_change_bps` integer,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signal_observation_bucket_board_uq` ON `signal_observations` (`observed_bucket`,`board_id`);--> statement-breakpoint
CREATE INDEX `signal_observation_time_idx` ON `signal_observations` (`observed_at`);--> statement-breakpoint
CREATE INDEX `signal_observation_board_idx` ON `signal_observations` (`board_id`,`observed_at`);