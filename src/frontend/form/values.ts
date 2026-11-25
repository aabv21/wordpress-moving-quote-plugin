import type { FormValues } from '../lib/form-state.ts';
import type { QuoteFormConfig } from './types.ts';

export function readConfig(form: HTMLFormElement): QuoteFormConfig {
  const raw = form.dataset['config'];
  if (raw === undefined) throw new Error('moving-quote: missing data-config');
  return JSON.parse(raw) as QuoteFormConfig;
}

/** '' when the field is missing (or a file input, which this form never uses). */
function fieldValue(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

export function readValues(form: HTMLFormElement): FormValues {
  const data = new FormData(form);
  const extras = data.getAll('extras').filter((value): value is string => typeof value === 'string');
  return {
    move_type: fieldValue(data, 'move_type'),
    rooms: fieldValue(data, 'rooms'),
    origin: fieldValue(data, 'origin'),
    destination: fieldValue(data, 'destination'),
    move_date: fieldValue(data, 'move_date'),
    extras,
    name: fieldValue(data, 'name'),
    phone: fieldValue(data, 'phone'),
    email: fieldValue(data, 'email'),
    consent: null !== data.get('consent'),
  };
}
