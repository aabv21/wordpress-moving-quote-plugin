<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Rest;

use Chivabox\MovingQuote\Rest\LocaleParam;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class LocaleParamTest extends TestCase {
	private const INSTALLED = [ 'en_US', 'es_CO' ];

	#[DataProvider( 'installed_locales' )]
	public function test_an_installed_locale_is_picked( string $requested ): void {
		self::assertSame( $requested, LocaleParam::pick( $requested, self::INSTALLED ) );
	}

	/** @return iterable<string, array{string}> */
	public static function installed_locales(): iterable {
		return [
			'English' => [ 'en_US' ],
			'Spanish' => [ 'es_CO' ],
		];
	}

	#[DataProvider( 'rejected_values' )]
	public function test_anything_else_is_null( mixed $requested ): void {
		self::assertNull( LocaleParam::pick( $requested, self::INSTALLED ) );
	}

	/** @return iterable<string, array{mixed}> */
	public static function rejected_values(): iterable {
		return [
			'missing'                   => [ null ],
			'empty'                     => [ '' ],
			'a locale not installed'    => [ 'fr_FR' ],
			'a language code alone'     => [ 'es' ],
			'a W3C tag'                 => [ 'es-CO' ],
			'different case'            => [ 'ES_co' ],
			'surrounding whitespace'    => [ ' es_CO' ],
			'markup'                    => [ 'es_CO<script>' ],
			'an array holding a locale' => [ [ 'es_CO' ] ],
			'a number'                  => [ 1 ],
			'true'                      => [ true ],
		];
	}

	public function test_nothing_is_picked_when_nothing_is_installed(): void {
		self::assertNull( LocaleParam::pick( 'en_US', [] ) );
	}
}
