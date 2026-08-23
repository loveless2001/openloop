CREATE TABLE `document_events` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`action` text NOT NULL,
	`document_version` integer NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_events_document_created_idx` ON `document_events` (`document_id`,`created_at`);