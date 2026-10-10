/** Only generated formatting tags may reach v-html; all external text is escaped. */
export function formatSummary(text) {
  if (typeof text !== 'string' || !text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\*(.*?)\*/g, '<b>$1</b>')
    .replace(/_(.*?)_/g, '<i>$1</i>')
    .replace(/\r?\n/g, '<br/>');
}
