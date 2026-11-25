<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Leads;

use Chivabox\MovingQuote\Pricing\{Extra, MoveType};

/**
 * The translated name of each move type, extra, lead status and delivery status, in one place so
 * the form, the Settings page, the Leads table and the privacy export always agree.
 */
final class Labels {
	/** @return array<string, string> each `MoveType` value and its label, in the enum's order */
	public static function move_types(): array {
		$labels = [];
		foreach ( MoveType::cases() as $case ) {
			$labels[ $case->value ] = match ( $case ) {
				MoveType::Apartment => __( 'Apartment', 'moving-quote' ),
				MoveType::House     => __( 'House', 'moving-quote' ),
				MoveType::Office    => __( 'Office', 'moving-quote' ),
			};
		}
		return $labels;
	}

	/** @return array<string, string> each `Extra` value and its label, in the enum's order */
	public static function extras(): array {
		$labels = [];
		foreach ( Extra::cases() as $case ) {
			$labels[ $case->value ] = match ( $case ) {
				Extra::Packing           => __( 'Packing', 'moving-quote' ),
				Extra::FurnitureAssembly => __( 'Furniture disassembly and assembly', 'moving-quote' ),
				Extra::Storage           => __( 'Temporary storage', 'moving-quote' ),
				Extra::PianoFragile      => __( 'Piano or fragile items', 'moving-quote' ),
			};
		}
		return $labels;
	}

	/** The raw value for a move type this plugin version doesn't know. */
	public static function move_type( string $value ): string {
		return self::move_types()[ $value ] ?? $value;
	}

	/** The raw value for an extra this plugin version doesn't know. */
	public static function extra( string $value ): string {
		return self::extras()[ $value ] ?? $value;
	}

	/** Context-tagged: "New" or "Won" agree in gender with "lead" in some languages. */
	public static function status( LeadStatus $status ): string {
		return match ( $status ) {
			LeadStatus::New       => _x( 'New', 'lead status', 'moving-quote' ),
			LeadStatus::Contacted => _x( 'Contacted', 'lead status', 'moving-quote' ),
			LeadStatus::Quoted    => _x( 'Quoted', 'lead status', 'moving-quote' ),
			LeadStatus::Won       => _x( 'Won', 'lead status', 'moving-quote' ),
			LeadStatus::Lost      => _x( 'Lost', 'lead status', 'moving-quote' ),
		};
	}

	/** Context-tagged: "Sent" or "Failed" alone don't say what was sent. */
	public static function sync( SyncStatus $status ): string {
		return match ( $status ) {
			SyncStatus::Pending => _x( 'Pending', 'delivery status', 'moving-quote' ),
			SyncStatus::Sent    => _x( 'Sent', 'delivery status', 'moving-quote' ),
			SyncStatus::Failed  => _x( 'Failed', 'delivery status', 'moving-quote' ),
		};
	}
}
