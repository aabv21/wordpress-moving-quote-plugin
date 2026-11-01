/** Every field the three-step form can hold, as the browser collects it: all strings, or booleans
 * for checkboxes, before `estimateRequest` narrows the subset the REST API needs. */
export interface FormValues {
  move_type?: string;
  rooms?: string;
  origin?: string;
  destination?: string;
  move_date?: string;
  extras?: string[];
  name?: string;
  phone?: string;
  email?: string;
  consent?: boolean;
}

/** The body `POST /moving-quote/v1/estimate` accepts. */
export interface EstimateRequest {
  move_type: string;
  rooms: number;
  origin: string;
  destination: string;
  extras: string[];
}

/** The fields that belong to each step, in display order. Step 1 (extras) has no required field: a move can have none. */
export const STEP_FIELDS: Record<0 | 1 | 2, (keyof FormValues)[]> = {
  0: ['move_type', 'rooms', 'origin', 'destination', 'move_date'],
  1: [],
  2: ['name', 'phone', 'email', 'consent'],
};

/** Maps a field name to the step that collects it, for `firstStepWithError`. */
const FIELD_STEP: Partial<Record<string, 0 | 1 | 2>> = {
  move_type: 0,
  rooms: 0,
  origin: 0,
  destination: 0,
  move_date: 0,
  extras: 1,
  name: 2,
  phone: 2,
  email: 2,
  consent: 2,
};

/**
 * The estimate request once move type, rooms, and both cities are set — everything the pricing
 * endpoint needs, regardless of which step the visitor is currently on. `null` while any of those
 * four is still blank, so the caller knows not to call the estimate endpoint yet.
 */
export function estimateRequest(values: FormValues): EstimateRequest | null {
  const { move_type, rooms, origin, destination } = values;
  if (!move_type || !rooms || !origin || !destination) return null;

  const roomsNumber = Number(rooms);
  if (!Number.isFinite(roomsNumber)) return null;

  return { move_type, rooms: roomsNumber, origin, destination, extras: values.extras ?? [] };
}

/** True when a field's current value counts as "filled in" for `missingRequired`. */
function isFilled(values: FormValues, field: keyof FormValues): boolean {
  if (field === 'consent') return values.consent === true;
  const value = values[field];
  return typeof value === 'string' && '' !== value;
}

/** The required fields of `step` that are still blank, in that step's field order. */
export function missingRequired(step: 0 | 1 | 2, values: FormValues): string[] {
  return STEP_FIELDS[step].filter((field) => !isFilled(values, field));
}

/** The earliest step (lowest index) that owns one of `errors`' field keys, defaulting to the last step when none of the keys are recognized. */
export function firstStepWithError(errors: Record<string, string>): 0 | 1 | 2 {
  let earliest: 0 | 1 | 2 = 2;
  for (const field of Object.keys(errors)) {
    const step = FIELD_STEP[field];
    if (step !== undefined && step < earliest) earliest = step;
  }
  return earliest;
}
