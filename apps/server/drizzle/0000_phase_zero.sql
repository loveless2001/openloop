CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content_json` text NOT NULL,
	`plain_text` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`question` text NOT NULL,
	`rationale` text NOT NULL,
	`suggested_rewrite` text,
	`severity` integer NOT NULL,
	`confidence` real NOT NULL,
	`interrupt_worthiness` real NOT NULL,
	`anchor_json` text NOT NULL,
	`keywords_json` text NOT NULL,
	`resurface_triggers_json` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`shown_count` integer DEFAULT 0 NOT NULL,
	`silent_ignore_count` integer DEFAULT 0 NOT NULL,
	`last_shown_at` integer,
	`snoozed_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issues_document_status_idx` ON `issues` (`document_id`,`status`);
--> statement-breakpoint
CREATE INDEX `issues_document_dedupe_idx` ON `issues` (`document_id`,`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `issues_document_updated_idx` ON `issues` (`document_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `issue_events` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`document_id` text NOT NULL,
	`action` text NOT NULL,
	`document_version` integer NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issue_events_issue_created_idx` ON `issue_events` (`issue_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `issue_events_document_created_idx` ON `issue_events` (`document_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `model_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`document_id` text,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_hash` text NOT NULL,
	`latency_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`status` text NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `preference_weights` (
	`user_id` text NOT NULL,
	`issue_type` text NOT NULL,
	`weight` real NOT NULL,
	`explicit_dismissals` integer DEFAULT 0 NOT NULL,
	`applies` integer DEFAULT 0 NOT NULL,
	`silent_ignores` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `issue_type`)
);
