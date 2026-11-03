<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Install;

/**
 * The leads table definition, in the format `dbDelta()` expects. A column added after the first
 * release goes last: `dbDelta()` appends a new column to an existing table, so a fresh install
 * and an upgraded one end up with the same column order.
 */
final class Schema {
	/** Builds the `CREATE TABLE` statement for the leads table, ready for `dbDelta()`. */
	public static function sql( string $table, string $charset_collate ): string {
		return "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			request_uuid char(36) NOT NULL,
			created_at datetime NOT NULL,
			status varchar(20) NOT NULL DEFAULT 'new',
			move_type varchar(20) NOT NULL,
			rooms tinyint(3) unsigned NOT NULL,
			origin_city varchar(60) NOT NULL,
			destination_city varchar(60) NOT NULL,
			distance_km smallint(5) unsigned NOT NULL,
			move_date date NOT NULL,
			extras varchar(100) NOT NULL DEFAULT '',
			customer_name varchar(100) NOT NULL,
			phone varchar(15) NOT NULL,
			email varchar(254) NOT NULL,
			consent_at datetime NOT NULL,
			estimate_cop int(10) unsigned NOT NULL,
			estimate_low_cop int(10) unsigned NOT NULL,
			estimate_high_cop int(10) unsigned NOT NULL,
			sync_status varchar(10) NOT NULL DEFAULT 'pending',
			attempts tinyint(3) unsigned NOT NULL DEFAULT 0,
			next_attempt_at bigint(20) unsigned NOT NULL DEFAULT 0,
			last_error varchar(500) NOT NULL DEFAULT '',
			sent_at datetime NULL,
			locale varchar(20) NOT NULL DEFAULT '',
			PRIMARY KEY  (id),
			UNIQUE KEY request_uuid (request_uuid),
			KEY status_created (status,created_at),
			KEY sync_due (sync_status,next_attempt_at)
		) {$charset_collate};";
	}
}
