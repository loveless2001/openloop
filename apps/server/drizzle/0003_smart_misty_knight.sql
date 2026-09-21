CREATE TABLE `writing_evaluation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_identity_hash` text NOT NULL,
	`document_version` integer NOT NULL,
	`rubric_id` text NOT NULL,
	`rubric_revision` integer NOT NULL,
	`input_hash` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`compiled_request_json` text NOT NULL,
	`compiled_evaluation_json` text NOT NULL,
	`requested_model` text NOT NULL,
	`returned_model` text,
	`provider_id` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text,
	`policy_version` text NOT NULL,
	`policy_json` text NOT NULL,
	`provider_called` integer NOT NULL,
	`duration_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `writing_evaluation_runs_request_id_idx` ON `writing_evaluation_runs` (`request_id`);--> statement-breakpoint
CREATE INDEX `writing_evaluation_runs_document_created_idx` ON `writing_evaluation_runs` (`document_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `writing_rubrics` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`title` text NOT NULL,
	`content_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
