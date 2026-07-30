CREATE TABLE `daily_snapshots` (
	`trade_date` text PRIMARY KEY NOT NULL,
	`first_captured_at` text NOT NULL,
	`first_payload` text NOT NULL,
	`latest_captured_at` text NOT NULL,
	`latest_payload` text NOT NULL,
	`sample_count` integer DEFAULT 1 NOT NULL
);
