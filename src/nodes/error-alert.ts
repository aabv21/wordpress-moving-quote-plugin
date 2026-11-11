import { oneLine } from './lead.ts';
import { TEAM_LOCALE_NOTE, teamLocaleOrDefault, type Locale } from './locale.ts';

export interface AlertMessages {
  subject: (workflowName: string) => string;
  failedNode: string;
  error: string;
  execution: string;
  time: string;
  unknownWorkflow: string;
  activation: string;
  unknownError: string;
  noExecution: string;
}

export const ALERT_MESSAGES: Record<Locale, AlertMessages> = {
  en: {
    subject: (name) => `[Chivabox demo] Workflow failed: ${name}`,
    failedNode: 'Failed node',
    error: 'Error',
    execution: 'Execution',
    time: 'Time',
    unknownWorkflow: 'unknown workflow',
    activation: 'activation',
    unknownError: 'unknown error',
    noExecution: 'n/a (activation error)',
  },
  es: {
    subject: (name) => `[Chivabox demo] Falló el flujo: ${name}`,
    failedNode: 'Nodo que falló',
    error: 'Error',
    execution: 'Ejecución',
    time: 'Hora',
    unknownWorkflow: 'flujo desconocido',
    activation: 'activación',
    unknownError: 'error desconocido',
    noExecution: 'no aplica (error de activación)',
  },
};

interface AlertInput {
  config: { alerts?: { error_email?: unknown }; team_locale?: unknown };
  failure: unknown;
  time: string;
}

interface Alert {
  to: string;
  subject: string;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `value[key]` when `value` is an object, else undefined. */
function field(value: unknown, key: string): unknown {
  // eslint-disable-next-line security/detect-object-injection -- key is always a fixed literal from this file
  return isRecord(value) ? value[key] : undefined;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value !== '' ? value : fallback;
}

/**
 * Reads the Error Trigger's own output: `{ execution, workflow }` for a failed run, or
 * `{ trigger, workflow }` for a trigger or activation error, which has no `execution` key. Never
 * throws, whatever the shape: a throw here would silence every alert.
 */
export function run(input: AlertInput): Alert {
  const { config, failure, time } = input;
  const teamLocale = teamLocaleOrDefault(isRecord(config) ? config : {});
  const m = ALERT_MESSAGES[teamLocale.locale];

  const execution = field(failure, 'execution');
  const trigger = field(failure, 'trigger');
  const workflowName = text(field(field(failure, 'workflow'), 'name'), m.unknownWorkflow);
  const errorMessage = text(field(field(execution, 'error'), 'message'), text(field(field(trigger, 'error'), 'message'), m.unknownError));

  const lines = [
    `${m.failedNode}: ${text(field(execution, 'lastNodeExecuted'), m.activation)}`,
    `${m.error}: ${errorMessage}`,
    `${m.execution}: ${text(field(execution, 'url'), m.noExecution)}`,
    `${m.time}: ${time} America/Bogota`,
    ...(teamLocale.valid ? [] : [TEAM_LOCALE_NOTE]),
  ];

  const to = field(field(config, 'alerts'), 'error_email');
  return {
    to: typeof to === 'string' ? to : '',
    subject: oneLine(m.subject(workflowName)),
    text: lines.join('\n'),
  };
}
