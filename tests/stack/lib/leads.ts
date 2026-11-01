/** Brief case 1's move date: today plus 30 days, formatted `YYYY-MM-DD`. */
function moveDateIn30Days(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

/**
 * A valid lead submission body: brief case 1 (apartment, 2 rooms, Barranquilla → Cartagena, no
 * extras), with a move date 30 days out, a fresh `submission_id`, and an empty honeypot. Every
 * call gets its own `submission_id`, so tests never collide with each other's rows unless they
 * deliberately reuse one via `overrides`.
 */
export function validLead(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    submission_id: crypto.randomUUID(),
    move_type: 'apartment',
    rooms: 2,
    origin: 'Barranquilla',
    destination: 'Cartagena',
    extras: [],
    move_date: moveDateIn30Days(),
    name: 'Test Customer',
    phone: '570000000001',
    email: 'customer@example.com',
    consent: true,
    website: '',
    ...overrides,
  };
}
