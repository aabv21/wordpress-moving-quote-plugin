<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Admin;

use Chivabox\MovingQuote\Leads\{LeadRepository, LeadStatus};
use DateTimeZone;

final class CsvExporter {
	private const CHUNK = 500;

	/**
	 * Writes a UTF-8 BOM, the header, then every matching lead in batches of `CHUNK`.
	 *
	 * @param resource $out
	 */
	public static function stream( $out, LeadRepository $repository, ?LeadStatus $status, DateTimeZone $tz ): void {
		fwrite( $out, "\u{FEFF}" ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fwrite -- streaming to an output handle, not a filesystem path; WP_Filesystem has no equivalent.
		fputcsv( $out, LeadCsv::HEADER, ',', '"', '' );

		$after_id  = 0;
		$raw_count = self::CHUNK;
		while ( self::CHUNK === $raw_count ) {
			$chunk     = $repository->chunk_after( $status, $after_id, self::CHUNK );
			$raw_count = $chunk['raw_count'];
			foreach ( $chunk['records'] as $lead ) {
				fputcsv( $out, LeadCsv::row( $lead, $tz ), ',', '"', '' );
			}
			// Loop on raw_count and advance to last_raw_id; see LeadRepository::chunk_after().
			$after_id = $chunk['last_raw_id'];
		}
	}
}
