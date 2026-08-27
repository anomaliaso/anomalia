// ISO 3166-1 alpha-2. Only the codes live here — names come from Intl.DisplayNames, so the list
// follows the user's language without a translated country table to maintain.
const CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR ' +
  'BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ ' +
  'EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW ' +
  'GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY ' +
  'KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV ' +
  'MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY ' +
  'QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG ' +
  'TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';

export type Country = { code: string; name: string; flag: string };

/** Regional-indicator pair — the flag emoji for a country code, no asset needed. */
export function countryFlag(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** All countries, named in `locale` and sorted by that name. */
export function countryOptions(locale = 'en'): Country[] {
  const dn = new Intl.DisplayNames([locale], { type: 'region' });
  return CODES.split(' ')
    .map((code) => ({ code, name: dn.of(code) ?? code, flag: countryFlag(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** Parse the stored "IT, US" form into codes. Mirrors the server-side parser. */
export function parseCountries(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
}
