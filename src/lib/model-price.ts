/**
 * Il prezzo di un modello come lo legge una persona.
 *
 * Il gateway lo pubblica in dollari per TOKEN (`0.0000002`) e diventa per milione con una
 * moltiplicazione — che in binario non fa 0.2 ma 0.19999999999999998. Nel menu si leggeva
 * «$0.19999999999999998/$1.2 per 1M»: diciassette cifre di errore di arrotondamento presentate
 * come un prezzo.
 *
 * Tre decimali sotto il dollaro (un modello economico costa $0.075 e la terza cifra è il prezzo),
 * due sopra: più in là è rumore.
 */
const CHEAP = 1;
const CHEAP_DECIMALS = 3;
const DEAR_DECIMALS = 2;

export function usdPerMillion(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return 'free';
  const rounded = Number(usd.toFixed(usd < CHEAP ? CHEAP_DECIMALS : DEAR_DECIMALS));
  return `$${rounded}`;
}
