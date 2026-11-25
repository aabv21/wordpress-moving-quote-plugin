<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Frontend;

use Chivabox\MovingQuote\Frontend\Prefill;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class PrefillTest extends TestCase {
	private const CITIES = [ 'Barranquilla', 'Cartagena', 'Santa Marta' ];

	public function test_takes_a_known_type_and_two_known_cities(): void {
		self::assertSame(
			[
				'move_type'   => 'office',
				'origin'      => 'Barranquilla',
				'destination' => 'Santa Marta',
			],
			Prefill::from_query(
				[
					'mq_type' => 'office',
					'mq_from' => 'Barranquilla',
					'mq_to'   => 'Santa Marta',
					'other'   => 'ignored',
				],
				self::CITIES
			)
		);
	}

	public function test_an_empty_query_prefills_nothing(): void {
		self::assertSame(
			[
				'move_type'   => null,
				'origin'      => null,
				'destination' => null,
			],
			Prefill::from_query( [], self::CITIES )
		);
	}

	#[DataProvider( 'not_a_city' )]
	public function test_ignores_a_value_that_is_not_one_of_the_cities( mixed $value ): void {
		$prefill = Prefill::from_query(
			[
				'mq_type' => $value,
				'mq_from' => $value,
				'mq_to'   => $value,
			],
			self::CITIES
		);
		self::assertNull( $prefill['move_type'] );
		self::assertNull( $prefill['origin'] );
		self::assertNull( $prefill['destination'] );
	}

	/** @return array<string, array{mixed}> */
	public static function not_a_city(): array {
		return [
			'a script tag'           => [ '<script>' ],
			'a city not in the table' => [ 'Medellín' ],
			'another case'           => [ 'barranquilla' ],
			'blank'                  => [ '' ],
			'an array'               => [ [ 'Barranquilla' ] ],
		];
	}

	public function test_a_get_form_keeps_the_query_its_target_already_has(): void {
		// Plain permalinks and Polylang's language-as-query mode put the page in the query string,
		// which a GET form would otherwise replace with its own fields.
		self::assertSame(
			[
				'action' => 'https://example.com/',
				'fields' => [
					'page_id' => '12',
					'lang'    => 'es',
				],
			],
			Prefill::form_target( 'https://example.com/?page_id=12&lang=es' )
		);
		self::assertSame(
			[
				'action' => 'https://example.com/get-a-quote/',
				'fields' => [],
			],
			Prefill::form_target( 'https://example.com/get-a-quote/' )
		);
	}
}
