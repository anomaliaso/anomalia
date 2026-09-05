import { describe, expect, it } from 'vitest';
import { clampVideoDuration, DEFAULT_VIDEO_DURATION, videoDurationOptions } from './video';

/**
 * IL MINIMO VIENE DAL MODELLO, NON DA UNA COSTANTE NOSTRA.
 *
 * Andrea ha chiesto 5 secondi e ne ha pagati 10: `MIN_DURATION = 10` alzava il pavimento ignorando
 * il minimo che il modello dichiara. I video si fatturano al secondo, quindi era il doppio, e in
 * silenzio.
 *
 * La distinzione che resta valida: un DEFAULT si puo' scavalcare, un PAVIMENTO no. Chi non chiede
 * niente riceve `DEFAULT_VIDEO_DURATION`; chi chiede una durata la ottiene, se il modello la sa
 * fare. Il catalogo di OpenRouter pubblica `supported_durations` e per `wan-3.0` parte da 2.
 */
describe('la durata chiesta', () => {
  it('5 secondi restano 5 su un modello che li sa fare', () => {
    // grok-imagine dichiara minDuration 1: cinque secondi sono nella sua finestra.
    expect(clampVideoDuration(5, 'grok-imagine/text-to-video')).toBe(5);
  });

  it('2 secondi restano 2 dove il modello arriva a 2', () => {
    expect(clampVideoDuration(2, 'grok-imagine/text-to-video')).toBe(2);
  });

  it('sotto il minimo DEL MODELLO si sale al minimo del modello, non al nostro', () => {
    // seedance-2.5 parte da 4: chiedere 1 da' 4, non 10.
    expect(clampVideoDuration(1, 'bytedance/seedance-2-5')).toBe(4);
  });

  it('sopra il tetto del modello si scende al tetto', () => {
    expect(clampVideoDuration(999, 'grok-imagine/text-to-video')).toBe(15);
  });

  it('chi non chiede niente riceve il default, che non e stato toccato', () => {
    expect(clampVideoDuration(undefined, 'bytedance/seedance-2-5')).toBe(DEFAULT_VIDEO_DURATION);
    expect(clampVideoDuration('non un numero', 'bytedance/seedance-2-5')).toBe(DEFAULT_VIDEO_DURATION);
  });

  it('i gradini di Settings restano quelli, che e un altra cosa', () => {
    // La tendina offre 10/13/15/…: e' una scelta di interfaccia, non un pavimento. Chi passa dalla
    // API puo' chiedere 5; chi sceglie da un menu sceglie fra i gradini.
    expect(videoDurationOptions('grok-imagine/text-to-video')).toContain(10);
  });
});
