
export type Eol = '\r\n' | '\n';

export function detectEol(text: string): Eol {
  const total = (text.match(/\n/g) || []).length;
  if (total === 0) { return '\n'; }
  const crlf = (text.match(/\r\n/g) || []).length;
  return crlf * 2 > total ? '\r\n' : '\n';
}

export function toLf(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export function fromLf(text: string, eol: Eol): string {
  return eol === '\n' ? text : text.replace(/\n/g, '\r\n');
}
