// Phone numbers are stored in E.164 (+<country code><number>).
// Covers KTC's main markets; unknown countries keep the number only if it
// already carries an international prefix.
const DIAL_CODES = {
  pakistan: '92',
  philippines: '63',
  bangladesh: '880',
  'saudi arabia': '966',
  'united arab emirates': '971',
  uae: '971',
  kuwait: '965',
  qatar: '974',
  bahrain: '973',
  oman: '968',
  iran: '98',
  iraq: '964',
  jordan: '962',
  egypt: '20',
  malaysia: '60',
  indonesia: '62',
  singapore: '65',
  vietnam: '84',
  thailand: '66',
  china: '86',
  'hong kong': '852',
  'sri lanka': '94',
  india: '91',
  afghanistan: '93',
  ethiopia: '251',
  ghana: '233',
  kenya: '254',
  nigeria: '234',
  tanzania: '255',
  'south africa': '27',
  mozambique: '258',
  senegal: '221',
  'united kingdom': '44',
  uk: '44',
  'united states': '1',
  usa: '1',
  canada: '1',
  australia: '61',
  germany: '49',
  netherlands: '31',
  france: '33',
  italy: '39',
  spain: '34',
  belgium: '32',
  turkey: '90',
};

const E164 = /^\+[1-9]\d{6,14}$/;

// Returns { value, valid }. value is E.164 when it could be normalised,
// otherwise the trimmed original so nothing is lost.
export function toE164(raw, country) {
  const original = String(raw || '').trim();
  if (!original) return { value: '', valid: true };

  let digits = original.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;

  if (!digits.startsWith('+')) {
    const code = DIAL_CODES[String(country || '').trim().toLowerCase()];
    if (!code) return { value: original, valid: false };
    let national = digits.replace(/^0+/, '');
    if (national.startsWith(code) && national.length > code.length + 6) national = national.slice(code.length);
    digits = `+${code}${national}`;
  }

  digits = `+${digits.slice(1).replace(/\+/g, '')}`;
  return E164.test(digits) ? { value: digits, valid: true } : { value: original, valid: false };
}

export function isE164(value) {
  return E164.test(String(value || ''));
}
