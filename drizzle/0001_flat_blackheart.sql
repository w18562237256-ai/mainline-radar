CREATE TABLE `signal_events` (
	`event_key` text PRIMARY KEY NOT NULL,
	`trade_date` text NOT NULL,
	`triggered_at` text NOT NULL,
	`signal_type` text NOT NULL,
	`stock_code` text NOT NULL,
	`stock_name` text NOT NULL,
	`sector_name` text NOT NULL,
	`score` integer NOT NULL,
	`summary` text NOT NULL,
	`payload` text NOT NULL
);
