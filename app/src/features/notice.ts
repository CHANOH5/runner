/** 공지 본문의 http(s) 주소를 링크로 나눈다 (PRD 8.6: 일반 텍스트, URL 자동 링크) */
export function splitLinks(body: string): { text: string; url: string | null }[] {
  const parts: { text: string; url: string | null }[] = [];
  const re = /https?:\/\/[^\s<>"')\]]+/g;
  let last = 0;
  for (const m of body.matchAll(re)) {
    const start = m.index;
    if (start > last) parts.push({ text: body.slice(last, start), url: null });
    // 문장 끝 마침표·쉼표는 주소에서 뺀다
    const url = m[0].replace(/[.,!?]+$/, '');
    parts.push({ text: url, url });
    last = start + url.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), url: null });
  return parts;
}
