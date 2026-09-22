CREATE TABLE `writing_evaluation_feedback` (
	`run_id` text NOT NULL,
	`criterion_id` text NOT NULL,
	`verdict` text NOT NULL,
	`preferred_level` integer,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`run_id`, `criterion_id`),
	FOREIGN KEY (`run_id`) REFERENCES `writing_evaluation_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
