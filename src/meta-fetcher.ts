export interface PageMeta {
  title: string;
  description: string;
}

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  '169.254.169.254',
  'metadata.google.internal',
]);

const MAX_PARSE_BYTES = 512_000;

function isAllowedFetchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host)) return false;
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host)) return false;
    if (/^169\.254\./.test(host)) return false;
    if (host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.localhost'))
      return false;
    return true;
  } catch {
    return false;
  }
}

export async function fetchPageMeta(url: string): Promise<PageMeta> {
  if (!isAllowedFetchUrl(url)) {
    return { title: '', description: '' };
  }

  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Recall-Bot/1.0' },
    signal: AbortSignal.timeout(5000),
    redirect: 'follow',
  });

  if (!resp.ok) {
    return { title: '', description: '' };
  }

  if (resp.url && !isAllowedFetchUrl(resp.url)) {
    return { title: '', description: '' };
  }

  const raw = await resp.text();
  const html = raw.length > MAX_PARSE_BYTES ? raw.substring(0, MAX_PARSE_BYTES) : raw;

  const title = extractTitle(html);
  const description = extractDescription(html);

  return { title, description };
}

function extractTitle(html: string): string {
  const ogTitle = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  );
  if (ogTitle) return decodeEntities(ogTitle[1]);

  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleTag) return decodeEntities(titleTag[1].trim());

  return '';
}

function extractDescription(html: string): string {
  const ogDesc = html.match(
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
  );
  if (ogDesc) return decodeEntities(ogDesc[1]);

  const metaDesc = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
  );
  if (metaDesc) return decodeEntities(metaDesc[1]);

  return '';
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}
