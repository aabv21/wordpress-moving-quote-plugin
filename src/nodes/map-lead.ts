import type { Lead } from './lead.ts';
import { buildCustomerEmail, buildTeamEmail, type Config } from './emails.ts';
import { TEAM_LOCALE_NOTE } from './locale.ts';
import { buildSheetRow, type SheetRow } from './sheet-row.ts';

export { formatPhoneDisplay } from './emails.ts';
export { MESSAGES } from './messages.ts';
export { SHEET_HEADERS } from './sheet-row.ts';
export { TEAM_LOCALE_NOTE };

interface MapLeadOutput {
  row: SheetRow;
  team: { to: string; subject: string; text: string };
  customer: { to: string; reply_to: string; subject: string; html: string };
}

/**
 * Neither language can fail a lead: an invalid `team_locale` gives an English team alert with a
 * note, and a lead with no usable locale gets the default language.
 */
export function run(input: { lead: Lead; config: Config }): MapLeadOutput {
  const { lead, config } = input;

  return { row: buildSheetRow(lead), team: buildTeamEmail(lead, config), customer: buildCustomerEmail(lead) };
}
