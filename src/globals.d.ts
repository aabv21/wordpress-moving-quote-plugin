import type { DateTime as LuxonDateTime } from 'luxon';

// The n8n Code-node sandbox injects Luxon's DateTime as a global (no import, no require). Node
// sources mirror that: `tests/setup.ts` provides the value at test time, and the n8n sandbox
// provides it at runtime.
declare global {
  var DateTime: typeof LuxonDateTime;
  type DateTime = LuxonDateTime;
}
