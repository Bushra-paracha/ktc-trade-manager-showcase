// Location helpers for filtering buyers. Country values in the CRM are free text
// ("UAE", "United Arab Emirates", "Saudia Arab", "Bahrain / GCC", "Manila"), so
// they are tidied here for filtering only; the stored data is not changed. When
// a buyer has no country, a likely one is inferred from their email ending (.ae, .ph…).

const ALIASES = {
  uae: 'United Arab Emirates', 'u.a.e': 'United Arab Emirates', dubai: 'United Arab Emirates', 'abu dhabi': 'United Arab Emirates', sharjah: 'United Arab Emirates',
  ksa: 'Saudi Arabia', 'saudia arab': 'Saudi Arabia', 'saudi': 'Saudi Arabia',
  usa: 'United States', 'u.s.a': 'United States', us: 'United States', 'united states of america': 'United States',
  uk: 'United Kingdom', 'u.k': 'United Kingdom', england: 'United Kingdom', britain: 'United Kingdom', 'great britain': 'United Kingdom',
  manila: 'Philippines', 'côte d’ivoire': "Côte d'Ivoire", 'cote d\'ivoire': "Côte d'Ivoire", 'ivory coast': "Côte d'Ivoire",
  'south korea': 'South Korea', korea: 'South Korea', 'czechia': 'Czech Republic', holland: 'Netherlands',
  'hong kong sar': 'Hong Kong', 'russian federation': 'Russia', 'viet nam': 'Vietnam',
};

const TLD_COUNTRY = {
  ae: 'United Arab Emirates', sa: 'Saudi Arabia', om: 'Oman', qa: 'Qatar', bh: 'Bahrain', kw: 'Kuwait', jo: 'Jordan', lb: 'Lebanon',
  iq: 'Iraq', ye: 'Yemen', eg: 'Egypt', ir: 'Iran', tr: 'Turkey', pk: 'Pakistan', in: 'India', bd: 'Bangladesh', lk: 'Sri Lanka',
  af: 'Afghanistan', ph: 'Philippines', my: 'Malaysia', sg: 'Singapore', id: 'Indonesia', th: 'Thailand', vn: 'Vietnam', kh: 'Cambodia',
  cn: 'China', hk: 'Hong Kong', kr: 'South Korea', jp: 'Japan', au: 'Australia', nz: 'New Zealand', pg: 'Papua New Guinea', fj: 'Fiji',
  ke: 'Kenya', tz: 'Tanzania', ug: 'Uganda', rw: 'Rwanda', et: 'Ethiopia', ng: 'Nigeria', gh: 'Ghana', sn: 'Senegal', ci: "Côte d'Ivoire",
  cm: 'Cameroon', za: 'South Africa', mu: 'Mauritius', ao: 'Angola', mz: 'Mozambique', sl: 'Sierra Leone', lr: 'Liberia', gm: 'Gambia',
  bj: 'Benin', dz: 'Algeria', ma: 'Morocco', tn: 'Tunisia', so: 'Somalia', dj: 'Djibouti', sd: 'Sudan',
  uk: 'United Kingdom', ie: 'Ireland', fr: 'France', de: 'Germany', nl: 'Netherlands', be: 'Belgium', it: 'Italy', es: 'Spain', pt: 'Portugal',
  gr: 'Greece', pl: 'Poland', se: 'Sweden', no: 'Norway', dk: 'Denmark', fi: 'Finland', ch: 'Switzerland', at: 'Austria', cz: 'Czech Republic',
  hu: 'Hungary', ro: 'Romania', bg: 'Bulgaria', hr: 'Croatia', rs: 'Serbia', al: 'Albania', ee: 'Estonia', lv: 'Latvia', lt: 'Lithuania',
  cy: 'Cyprus', mt: 'Malta', ru: 'Russia', ua: 'Ukraine', az: 'Azerbaijan', kz: 'Kazakhstan', kg: 'Kyrgyzstan', uz: 'Uzbekistan',
  ca: 'Canada', mx: 'Mexico', br: 'Brazil', ar: 'Argentina', cl: 'Chile', co: 'Colombia', jm: 'Jamaica', sr: 'Suriname',
};

const REGIONS = {
  'Middle East & GCC': ['United Arab Emirates', 'Saudi Arabia', 'Oman', 'Qatar', 'Bahrain', 'Kuwait', 'Jordan', 'Lebanon', 'Iraq', 'Yemen', 'Iran', 'Turkey', 'Syria', 'Palestine', 'Israel'],
  'South Asia': ['Pakistan', 'India', 'Bangladesh', 'Sri Lanka', 'Afghanistan', 'Nepal', 'Maldives'],
  'Southeast Asia': ['Philippines', 'Malaysia', 'Singapore', 'Indonesia', 'Thailand', 'Vietnam', 'Cambodia', 'Brunei', 'Myanmar', 'Laos'],
  'East Asia': ['China', 'Hong Kong', 'South Korea', 'Japan', 'Taiwan'],
  Africa: ['Egypt', 'Kenya', 'Tanzania', 'Uganda', 'Rwanda', 'Ethiopia', 'Nigeria', 'Ghana', 'Senegal', "Côte d'Ivoire", 'Cameroon', 'South Africa', 'Mauritius', 'Angola', 'Mozambique', 'Sierra Leone', 'Liberia', 'Gambia', 'Benin', 'Algeria', 'Morocco', 'Tunisia', 'Somalia', 'Djibouti', 'Sudan', 'Togo', 'Guinea', 'Mali', 'Madagascar', 'Zambia', 'Zimbabwe', 'Malawi', 'Libya'],
  Europe: ['United Kingdom', 'Ireland', 'France', 'Germany', 'Netherlands', 'Belgium', 'Italy', 'Spain', 'Portugal', 'Greece', 'Poland', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Switzerland', 'Austria', 'Czech Republic', 'Hungary', 'Romania', 'Bulgaria', 'Croatia', 'Serbia', 'Albania', 'Estonia', 'Latvia', 'Lithuania', 'Cyprus', 'Malta', 'Slovakia', 'Andorra', 'Russia', 'Ukraine', 'Luxembourg', 'Slovenia'],
  'Central Asia & Caucasus': ['Azerbaijan', 'Kazakhstan', 'Kyrgyzstan', 'Uzbekistan', 'Tajikistan', 'Turkmenistan', 'Georgia', 'Armenia'],
  'North America': ['United States', 'Canada', 'Mexico'],
  'Latin America & Caribbean': ['Brazil', 'Argentina', 'Chile', 'Colombia', 'Peru', 'Jamaica', 'Suriname', 'Antigua & Barbuda', 'Sint Maarten', 'U.S. Virgin Islands', 'Trinidad and Tobago', 'Guyana', 'Dominican Republic', 'Haiti', 'Panama'],
  Oceania: ['Australia', 'New Zealand', 'Papua New Guinea', 'Fiji'],
};
const REGION_OF = Object.fromEntries(Object.entries(REGIONS).flatMap(([region, list]) => list.map((c) => [c, region])));

export const REGION_NAMES = Object.keys(REGIONS);
export const UNKNOWN = 'Unknown';

// "Bahrain / GCC" -> "Bahrain"; "UAE" -> "United Arab Emirates"; "Test" -> null.
export function canonicalCountry(raw) {
  let value = String(raw || '').split(/\s*\/\s*/)[0].replace(/\s+/g, ' ').trim();
  if (!value) return null;
  const alias = ALIASES[value.toLowerCase().replace(/\.$/, '')];
  if (alias) return alias;
  if (REGION_OF[value]) return value;
  const match = Object.keys(REGION_OF).find((c) => c.toLowerCase() === value.toLowerCase());
  if (match) return match;
  value = value.replace(/\b\w/g, (ch) => ch.toUpperCase());
  return value.length > 2 && value.toLowerCase() !== 'test' ? value : null;
}

// Country-specific free mail providers on generic endings.
const DOMAIN_COUNTRY = {
  'qq.com': 'China', '163.com': 'China', '126.com': 'China', 'sina.com': 'China', 'yeah.net': 'China', 'aliyun.com': 'China',
  'naver.com': 'South Korea', 'rediffmail.com': 'India',
};

function countryFromEmail(email) {
  const domain = String(email || '').toLowerCase().split(/[\s,;]+/)[0].split('@')[1];
  if (!domain) return null;
  return DOMAIN_COUNTRY[domain] || TLD_COUNTRY[domain.split('.').pop()] || null;
}

// { country, region, inferred } for a client; inferred = guessed from the email ending.
export function clientLocation(client) {
  const stated = canonicalCountry(client?.country);
  const country = stated || countryFromEmail(client?.email);
  return {
    country: country || UNKNOWN,
    region: country ? REGION_OF[country] || 'Other' : UNKNOWN,
    inferred: !stated && Boolean(country),
    city: String(client?.city || '').trim(),
  };
}
