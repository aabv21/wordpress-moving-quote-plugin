const HEX = Array.from({ length: 256 }, (_, n) => n.toString(16).padStart(2, '0'));

/**
 * 16 random bytes from the Web Crypto API. The cast only satisfies the DOM typing, which accepts a
 * view over a non-shared `ArrayBuffer`; a plain `new Uint8Array(16)` is one.
 */
function randomBytes(bytes: Uint8Array): Uint8Array {
  return crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
}

/**
 * A UUID v4, lowercased. `fill` supplies the 16 random-ish bytes (defaulting to
 * `crypto.getRandomValues`, which works outside secure contexts too, unlike `crypto.randomUUID`)
 * and only the version and variant bits are then forced to the UUID v4 pattern.
 */
export function uuidV4(fill: (bytes: Uint8Array) => Uint8Array = randomBytes): string {
  const bytes = fill(new Uint8Array(16));

  // Force the version (4) and variant (10xxxxxx) bits per RFC 4122.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => HEX[byte]);
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}
