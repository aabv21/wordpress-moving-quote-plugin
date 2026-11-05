<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Admin;

use Chivabox\MovingQuote\Pricing\DistanceTable;
use Chivabox\MovingQuote\Settings\{Options, SettingsSanitizer};

/**
 * Registers the setting on `admin_init` only, so a WP-CLI `wp option update`/`patch` never runs
 * through the form sanitizer.
 *
 * @phpstan-import-type SettingsShape from \Chivabox\MovingQuote\Settings\Defaults
 */
final class SettingsPage {
	private const OPTION_GROUP     = 'moving_quote';
	private const BLANK_ROUTE_ROWS = 3;

	public static function register(): void {
		add_action(
			'admin_init',
			static function (): void {
				register_setting(
					self::OPTION_GROUP,
					Options::NAME,
					[
						'type'              => 'array',
						'sanitize_callback' => [ self::class, 'sanitize' ],
						'show_in_rest'      => false,
					]
				);
			}
		);
	}

	/**
	 * Per-field sanitizers, never a blanket `sanitize_text_field()`, which would strip `%xx` and
	 * tags from the URL and secret. `options.php` has already unslashed the value.
	 *
	 * @return SettingsShape
	 */
	public static function sanitize( mixed $input ): array {
		$current = Options::all();
		$form    = self::wp_sanitize_form( is_array( $input ) ? $input : [] );

		$result   = SettingsSanitizer::sanitize( $form, $current );
		$messages = self::error_messages();

		foreach ( $result->errors as $key => $code ) {
			add_settings_error( Options::NAME, str_replace( '.', '-', $key ), $messages[ $code ] ?? $code );
		}

		$settings = $result->settings;
		if ( ! isset( $result->errors['webhook_url'] ) && '' !== $settings['webhook_url'] ) {
			$settings['webhook_url'] = esc_url_raw( $settings['webhook_url'] );
		}

		return $settings;
	}

	/** @return array<string, string> error code to the message shown in the settings notice */
	private static function error_messages(): array {
		return [
			'invalid_amount'  => __( 'Enter a whole amount in COP, such as 150,000.', 'moving-quote' ),
			'invalid_percent' => __( 'Enter a percentage from 0 to 50.', 'moving-quote' ),
			'invalid_city'    => __( 'City names must be 2–60 characters.', 'moving-quote' ),
			'same_city'       => __( 'The origin and destination cities must be different.', 'moving-quote' ),
			'duplicate_route' => __( 'This city pair already has a distance; remove the duplicate row.', 'moving-quote' ),
			'invalid_km'      => __( 'Enter a distance in km from 1 to 3,000.', 'moving-quote' ),
			'no_routes'       => __( 'At least one route is required.', 'moving-quote' ),
			'invalid_url'     => __( 'Enter a valid http:// or https:// URL, or leave it blank.', 'moving-quote' ),
			'short_secret'    => __( 'The webhook secret must be at least 32 characters.', 'moving-quote' ),
			'invalid_email'   => __( 'Enter a valid email address, or leave it blank.', 'moving-quote' ),
		];
	}

	/**
	 * @param array<string, mixed> $input
	 * @return array<string, mixed>
	 */
	private static function wp_sanitize_form( array $input ): array {
		return [
			'base_rates'     => self::wp_sanitize_text_map( $input['base_rates'] ?? null ),
			'per_room'       => self::wp_sanitize_text( $input['per_room'] ?? null ),
			'per_km'         => self::wp_sanitize_text( $input['per_km'] ?? null ),
			'extras'         => self::wp_sanitize_text_map( $input['extras'] ?? null ),
			'range_percent'  => self::wp_sanitize_text( $input['range_percent'] ?? null ),
			'routes'         => self::wp_sanitize_routes( $input['routes'] ?? null ),
			// trim() only: esc_url_raw() turns a disallowed scheme into '', which would pass as a
			// blank instead of invalid_url. sanitize() runs esc_url_raw() after validation.
			'webhook_url'    => is_string( $input['webhook_url'] ?? null ) ? trim( $input['webhook_url'] ) : '',
			'webhook_secret' => is_string( $input['webhook_secret'] ?? null ) ? trim( $input['webhook_secret'] ) : '',
			// trim() only: sanitize_email() turns an invalid address into '', a blank, not invalid_email.
			'team_email'     => is_string( $input['team_email'] ?? null ) ? trim( $input['team_email'] ) : '',
		];
	}

	/** @return array<string, string> */
	private static function wp_sanitize_text_map( mixed $input ): array {
		if ( ! is_array( $input ) ) {
			return [];
		}
		$out = [];
		foreach ( $input as $key => $value ) {
			if ( is_string( $key ) ) {
				$out[ $key ] = self::wp_sanitize_text( $value );
			}
		}
		return $out;
	}

	private static function wp_sanitize_text( mixed $input ): string {
		return is_string( $input ) || is_int( $input ) ? sanitize_text_field( (string) $input ) : '';
	}

	/** @return list<array<string, string>> */
	private static function wp_sanitize_routes( mixed $input ): array {
		if ( ! is_array( $input ) ) {
			return [];
		}
		$rows = [];
		foreach ( $input as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			$rows[] = [
				'from'   => self::wp_sanitize_text( $row['from'] ?? null ),
				'to'     => self::wp_sanitize_text( $row['to'] ?? null ),
				'km'     => self::wp_sanitize_text( $row['km'] ?? null ),
				'remove' => self::wp_sanitize_text( $row['remove'] ?? null ),
			];
		}
		return $rows;
	}

	public static function render(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to access this page.', 'moving-quote' ) );
		}

		$settings  = Options::all();
		$distances = DistanceTable::from_settings( $settings );
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Moving Quote Settings', 'moving-quote' ); ?></h1>
			<?php settings_errors(); ?>
			<form method="post" action="options.php">
				<?php settings_fields( self::OPTION_GROUP ); ?>

				<h2><?php esc_html_e( 'Rates', 'moving-quote' ); ?></h2>
				<?php self::render_rates_section( $settings ); ?>

				<h2><?php esc_html_e( 'Cities and distances', 'moving-quote' ); ?></h2>
				<?php self::render_routes_section( $settings, $distances ); ?>

				<h2><?php esc_html_e( 'Delivery', 'moving-quote' ); ?></h2>
				<?php self::render_delivery_section( $settings ); ?>

				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}

	/** @param SettingsShape $settings */
	private static function render_rates_section( array $settings ): void {
		$move_type_labels = [
			'apartment' => __( 'Apartment', 'moving-quote' ),
			'house'     => __( 'House', 'moving-quote' ),
			'office'    => __( 'Office', 'moving-quote' ),
		];
		$extra_labels     = [
			'packing'            => __( 'Packing', 'moving-quote' ),
			'furniture_assembly' => __( 'Furniture disassembly and assembly', 'moving-quote' ),
			'storage'            => __( 'Temporary storage', 'moving-quote' ),
			'piano_fragile'      => __( 'Piano or fragile items', 'moving-quote' ),
		];
		?>
		<table class="form-table" role="presentation">
			<?php foreach ( $move_type_labels as $key => $label ) : ?>
				<tr>
					<th scope="row"><label for="mq-base-rate-<?php echo esc_attr( $key ); ?>"><?php echo esc_html( $label ); ?></label></th>
					<td>
						<input type="text" id="mq-base-rate-<?php echo esc_attr( $key ); ?>" name="<?php echo esc_attr( Options::NAME ); ?>[base_rates][<?php echo esc_attr( $key ); ?>]" value="<?php echo esc_attr( (string) $settings['base_rates'][ $key ] ); ?>" class="regular-text" />
					</td>
				</tr>
			<?php endforeach; ?>
			<tr>
				<th scope="row"><label for="mq-per-room"><?php esc_html_e( 'Per room', 'moving-quote' ); ?></label></th>
				<td><input type="text" id="mq-per-room" name="<?php echo esc_attr( Options::NAME ); ?>[per_room]" value="<?php echo esc_attr( (string) $settings['per_room'] ); ?>" class="regular-text" /></td>
			</tr>
			<tr>
				<th scope="row"><label for="mq-per-km"><?php esc_html_e( 'Per km', 'moving-quote' ); ?></label></th>
				<td><input type="text" id="mq-per-km" name="<?php echo esc_attr( Options::NAME ); ?>[per_km]" value="<?php echo esc_attr( (string) $settings['per_km'] ); ?>" class="regular-text" /></td>
			</tr>
			<?php foreach ( $extra_labels as $key => $label ) : ?>
				<tr>
					<th scope="row"><label for="mq-extra-<?php echo esc_attr( $key ); ?>"><?php echo esc_html( $label ); ?></label></th>
					<td>
						<input type="text" id="mq-extra-<?php echo esc_attr( $key ); ?>" name="<?php echo esc_attr( Options::NAME ); ?>[extras][<?php echo esc_attr( $key ); ?>]" value="<?php echo esc_attr( (string) $settings['extras'][ $key ] ); ?>" class="regular-text" />
					</td>
				</tr>
			<?php endforeach; ?>
			<tr>
				<th scope="row"><label for="mq-range-percent"><?php esc_html_e( 'Range percent', 'moving-quote' ); ?></label></th>
				<td><input type="text" id="mq-range-percent" name="<?php echo esc_attr( Options::NAME ); ?>[range_percent]" value="<?php echo esc_attr( (string) $settings['range_percent'] ); ?>" class="small-text" /></td>
			</tr>
		</table>
		<?php
	}

	/** @param SettingsShape $settings */
	private static function render_routes_section( array $settings, DistanceTable $distances ): void {
		$missing = $distances->missing_pairs();
		if ( [] !== $missing ) {
			$pairs = array_map(
				static fn ( array $pair ): string => "{$pair[0]} \u{2194} {$pair[1]}",
				$missing
			);
			?>
			<div class="notice notice-warning inline">
				<p><?php esc_html_e( 'Missing distances for:', 'moving-quote' ); ?> <?php echo esc_html( implode( ', ', $pairs ) ); ?></p>
			</div>
			<?php
		}

		$rows = $settings['routes'];
		for ( $i = 0; $i < self::BLANK_ROUTE_ROWS; $i++ ) {
			$rows[] = [
				'from' => '',
				'to'   => '',
				'km'   => 0,
			];
		}
		?>
		<table class="widefat">
			<thead>
				<tr>
					<th><?php echo esc_html_x( 'From', 'route origin city', 'moving-quote' ); ?></th>
					<th><?php echo esc_html_x( 'To', 'route destination city', 'moving-quote' ); ?></th>
					<th><?php esc_html_e( 'Distance (km)', 'moving-quote' ); ?></th>
					<th><?php esc_html_e( 'Remove', 'moving-quote' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( $rows as $i => $row ) : ?>
					<tr>
						<td><input type="text" name="<?php echo esc_attr( Options::NAME ); ?>[routes][<?php echo esc_attr( (string) $i ); ?>][from]" value="<?php echo esc_attr( $row['from'] ); ?>" class="regular-text" /></td>
						<td><input type="text" name="<?php echo esc_attr( Options::NAME ); ?>[routes][<?php echo esc_attr( (string) $i ); ?>][to]" value="<?php echo esc_attr( $row['to'] ); ?>" class="regular-text" /></td>
						<td><input type="text" name="<?php echo esc_attr( Options::NAME ); ?>[routes][<?php echo esc_attr( (string) $i ); ?>][km]" value="<?php echo esc_attr( $row['km'] > 0 ? (string) $row['km'] : '' ); ?>" class="small-text" /></td>
						<td><input type="checkbox" name="<?php echo esc_attr( Options::NAME ); ?>[routes][<?php echo esc_attr( (string) $i ); ?>][remove]" value="1" /></td>
					</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
		<?php
	}

	/** @param SettingsShape $settings */
	private static function render_delivery_section( array $settings ): void {
		$enabled = Options::delivery_enabled();
		?>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><label for="mq-webhook-url"><?php esc_html_e( 'Webhook URL', 'moving-quote' ); ?></label></th>
				<td><input type="text" id="mq-webhook-url" name="<?php echo esc_attr( Options::NAME ); ?>[webhook_url]" value="<?php echo esc_attr( $settings['webhook_url'] ); ?>" class="regular-text" /></td>
			</tr>
			<tr>
				<th scope="row"><label for="mq-webhook-secret"><?php esc_html_e( 'Webhook secret', 'moving-quote' ); ?></label></th>
				<td>
					<input type="password" id="mq-webhook-secret" name="<?php echo esc_attr( Options::NAME ); ?>[webhook_secret]" value="" autocomplete="new-password" class="regular-text" />
					<p class="description"><?php esc_html_e( 'Leave blank to keep the current secret.', 'moving-quote' ); ?></p>
				</td>
			</tr>
			<tr>
				<th scope="row"><label for="mq-team-email"><?php esc_html_e( 'Team email', 'moving-quote' ); ?></label></th>
				<td><input type="email" id="mq-team-email" name="<?php echo esc_attr( Options::NAME ); ?>[team_email]" value="<?php echo esc_attr( $settings['team_email'] ); ?>" class="regular-text" /></td>
			</tr>
		</table>
		<p>
			<?php if ( $enabled ) : ?>
				<strong><?php esc_html_e( 'Delivery is on', 'moving-quote' ); ?></strong>
			<?php else : ?>
				<strong><?php esc_html_e( 'Delivery is off until the webhook URL, secret, and team email are set.', 'moving-quote' ); ?></strong>
			<?php endif; ?>
		</p>
		<?php
	}
}
