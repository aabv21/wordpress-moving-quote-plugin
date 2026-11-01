import { DateTime } from 'luxon';

// Node sources use the ambient `DateTime` global (see src/globals.d.ts) instead of importing
// Luxon, matching the real Code-node sandbox. Vitest needs it provided the same way.
globalThis.DateTime = DateTime;
