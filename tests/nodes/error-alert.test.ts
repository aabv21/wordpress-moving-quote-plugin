import { describe, expect, it } from 'vitest';
import { ALERT_MESSAGES, run } from '../../src/nodes/error-alert.ts';
import { LOCALES, TEAM_LOCALE_NOTE } from '../../src/nodes/locale.ts';
import { runCodeNode } from '../lib/code-node.ts';

const time = '2026-11-11 09:15';
const executionFailure = {
  execution: {
    id: '42',
    url: 'http://localhost:5678/workflow/cvbProcessLead01/executions/42',
    error: { message: 'Sheet "Moving leads" not found' },
    lastNodeExecuted: 'Append lead row',
    mode: 'integrated',
  },
  workflow: { id: 'cvbProcessLead01', name: 'Process lead' },
};
const triggerFailure = {
  trigger: { error: { message: 'Credentials could not be decrypted' }, mode: 'trigger' },
  workflow: { id: 'cvbLeadIntake001', name: 'Lead intake' },
};
const config = { alerts: { error_email: 'ops@example.com' }, team_locale: 'en' };
const spanishConfig = { ...config, team_locale: 'es' };

describe('error-alert', () => {
  it('builds the English alert from an execution failure', () => {
    const alert = run({ config, failure: executionFailure, time });
    expect(alert.subject).toBe('[Chivabox demo] Workflow failed: Process lead');
    expect(alert.text.split('\n')).toEqual([
      'Failed node: Append lead row',
      'Error: Sheet "Moving leads" not found',
      'Execution: http://localhost:5678/workflow/cvbProcessLead01/executions/42',
      'Time: 2026-11-11 09:15 America/Bogota',
    ]);
  });

  it('falls back for a trigger failure with no execution key', () => {
    const alert = run({ config, failure: triggerFailure, time });
    expect(alert.subject).toBe('[Chivabox demo] Workflow failed: Lead intake');
    expect(alert.text.split('\n')).toEqual([
      'Failed node: activation',
      'Error: Credentials could not be decrypted',
      'Execution: n/a (activation error)',
      'Time: 2026-11-11 09:15 America/Bogota',
    ]);
  });

  it('falls back when the payload carries nothing', () => {
    const alert = run({ config, failure: {}, time });
    expect(alert.subject).toBe('[Chivabox demo] Workflow failed: unknown workflow');
    expect(alert.text.split('\n')).toEqual([
      'Failed node: activation',
      'Error: unknown error',
      'Execution: n/a (activation error)',
      'Time: 2026-11-11 09:15 America/Bogota',
    ]);
  });

  it('writes the alert in Spanish when team_locale is es', () => {
    const alert = run({ config: spanishConfig, failure: executionFailure, time });
    expect(alert.subject).toBe('[Chivabox demo] Falló el flujo: Process lead');
    expect(alert.text.split('\n')).toEqual([
      'Nodo que falló: Append lead row',
      'Error: Sheet "Moving leads" not found',
      'Ejecución: http://localhost:5678/workflow/cvbProcessLead01/executions/42',
      'Hora: 2026-11-11 09:15 America/Bogota',
    ]);
  });

  it('a trigger failure with no execution key uses the Spanish fallbacks when team_locale is es', () => {
    const alert = run({ config: spanishConfig, failure: { trigger: {} }, time });
    expect(alert.subject).toBe('[Chivabox demo] Falló el flujo: flujo desconocido');
    expect(alert.text.split('\n')).toEqual([
      'Nodo que falló: activación',
      'Error: error desconocido',
      'Ejecución: no aplica (error de activación)',
      'Hora: 2026-11-11 09:15 America/Bogota',
    ]);
    expect(`${alert.subject}\n${alert.text}`).not.toContain('undefined');
  });

  it('an invalid team_locale gives an English alert ending with the team_locale note', () => {
    const alert = run({ config: { ...config, team_locale: 'ES' }, failure: executionFailure, time });
    expect(alert.subject).toBe('[Chivabox demo] Workflow failed: Process lead');
    const lines = alert.text.split('\n');
    expect(lines.slice(0, 4)).toEqual([
      'Failed node: Append lead row',
      'Error: Sheet "Moving leads" not found',
      'Execution: http://localhost:5678/workflow/cvbProcessLead01/executions/42',
      'Time: 2026-11-11 09:15 America/Bogota',
    ]);
    expect(lines).toHaveLength(5);
    expect(lines.at(-1)).toBe(TEAM_LOCALE_NOTE);
  });

  it('a line break in the workflow name never reaches the subject', () => {
    const failure = { ...executionFailure, workflow: { id: 'x', name: 'Process lead\nBcc: someone@example.com x' } };
    const alert = run({ config, failure, time });
    expect(alert.subject).toBe('[Chivabox demo] Workflow failed: Process lead Bcc: someone@example.com x');
  });

  it('sends to config.alerts.error_email', () => {
    expect(run({ config, failure: executionFailure, time }).to).toBe('ops@example.com');
  });

  it('never throws on a payload of the wrong shape', () => {
    const odd = { execution: 'x', workflow: { name: 7 }, trigger: null };
    expect(() => run({ config: {}, failure: odd, time })).not.toThrow();
    expect(run({ config: {}, failure: null, time }).subject).toBe('[Chivabox demo] Workflow failed: unknown workflow');
  });

  it('has every alert message in both languages, none empty', () => {
    expect(Object.keys(ALERT_MESSAGES).sort()).toEqual([...LOCALES].sort());
    for (const [locale, m] of Object.entries(ALERT_MESSAGES)) {
      for (const [key, value] of Object.entries(m) as [string, string | ((name: string) => string)][]) {
        const text = typeof value === 'function' ? value('Process lead') : value;
        expect(text, `${locale}.${key}`).toMatch(/\S/);
      }
    }
  });

  it('the committed Compose alert jsCode gives the same alert in the Code-node sandbox', () => {
    for (const input of [
      { config, failure: executionFailure, time },
      { config: spanishConfig, failure: triggerFailure, time },
      { config: { ...config, team_locale: 'ES' }, failure: {}, time },
    ]) {
      expect(runCodeNode('error-handler.json', 'Compose alert', input)).toEqual([{ json: run(input) }]);
    }
  });
});
