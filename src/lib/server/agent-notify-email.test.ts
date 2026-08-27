import { describe, expect, it } from 'vitest';
import { agentNotifyEmailHtml, agentNotifyEmailSubject, agentNotifyEmailText } from './email';

/**
 * Il corpo di questa email lo scrive un modello che ha appena letto pagine web, documenti caricati
 * e risposte di API. Che sia "l'AI a scriverlo" non lo rende fidato: qui si verifica che venga
 * trattato come testo, mai come markup.
 */
const base = { brandName: 'Acme', heading: 'Week 3 is ready' };

describe('agent notification email', () => {
  it('prefixes the subject with the brand', () => {
    expect(agentNotifyEmailSubject('en', 'Acme', 'Week 3 is ready')).toBe('Acme: Week 3 is ready');
  });

  it('escapes markup coming from the model', () => {
    const html = agentNotifyEmailHtml('en', {
      ...base,
      body: 'Careful: <script>alert(1)</script> & "quotes"'
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('escapes the heading too', () => {
    const html = agentNotifyEmailHtml('en', { ...base, heading: '<b>boom</b>', body: 'ok' });
    expect(html).toContain('&lt;b&gt;boom&lt;/b&gt;');
  });

  it('turns blank-line blocks into paragraphs and "- " lines into a list', () => {
    const html = agentNotifyEmailHtml('en', {
      ...base,
      body: 'First paragraph.\n\n- one\n- two\n\nLast word.'
    });
    expect(html).toContain('<ul');
    expect((html.match(/<li/g) ?? []).length).toBe(2);
    expect(html).toContain('First paragraph.');
    expect(html).toContain('Last word.');
  });

  it('renders **bold** and makes bare links clickable', () => {
    const html = agentNotifyEmailHtml('en', {
      ...base,
      body: '**Nine posts** are live: https://www.anomalia.so/app/acme/calendar'
    });
    expect(html).toContain('<strong>Nine posts</strong>');
    expect(html).toContain('href="https://www.anomalia.so/app/acme/calendar"');
  });

  it('adds the CTA only when there is a link, with the agent’s own label', () => {
    const withCta = agentNotifyEmailHtml('en', {
      ...base,
      body: 'x',
      ctaUrl: 'https://www.anomalia.so/app/acme',
      ctaLabel: 'Review the posts →'
    });
    expect(withCta).toContain('href="https://www.anomalia.so/app/acme"');
    expect(withCta).toContain('Review the posts');

    const without = agentNotifyEmailHtml('en', { ...base, body: 'x' });
    expect(without).not.toContain('href="https://www.anomalia.so/app/acme"');
  });

  it('writes the frame in the recipient’s language', () => {
    const it_ = agentNotifyEmailHtml('it', { ...base, body: 'x' });
    expect(it_).toContain('Dal tuo agente AI di Acme');
    const fr = agentNotifyEmailHtml('fr', { ...base, body: 'x' });
    expect(fr).toContain('agent IA Acme');
  });

  it('always ships a plain-text alternative carrying the same words', () => {
    const text = agentNotifyEmailText('en', {
      ...base,
      body: 'Nine posts are waiting.',
      ctaUrl: 'https://www.anomalia.so/app/acme'
    });
    expect(text).toContain('Week 3 is ready');
    expect(text).toContain('Nine posts are waiting.');
    expect(text).toContain('https://www.anomalia.so/app/acme');
    expect(text).not.toContain('<');
  });

  it('caps a runaway body instead of mailing a novel', () => {
    const html = agentNotifyEmailHtml('en', { ...base, body: 'a'.repeat(9000) });
    expect(html.length).toBeLessThan(6000);
  });
});
