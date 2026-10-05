// Emails are written as plain text in the app and stored/sent as simple HTML.
//   textToHtml: blank line = new paragraph, single line break = <br>, URLs become links.
//   htmlToText: turns stored HTML (including older hand-written templates) back into text.
// Merge tags like {{company}} pass through both unchanged.

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&apos;': "'" };

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function linkify(escaped) {
  return escaped.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}">${url}</a>`);
}

export function textToHtml(text) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return '';
  return clean
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${linkify(escapeHtml(paragraph.trim())).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

export function htmlToText(html) {
  const source = String(html || '');
  if (!/<[a-z][\s\S]*?>/i.test(source)) return source.trim();
  return source
    .replace(/\r\n/g, '\n')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/\n/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|ul|ol|table|tr|blockquote)>/gi, '\n\n')
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (match, href, label) => {
      const text = label.replace(/<[^>]+>/g, '').trim();
      return !text || text === href ? href : `${text} (${href})`;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39|#x27);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
