export interface PageMeta {
  title: string;
  description: string;
}

export async function fetchPageMeta(url: string): Promise<PageMeta> {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Recall-Bot/1.0' },
    signal: AbortSignal.timeout(5000),
  });

  if (!resp.ok) {
    return { title: '', description: '' };
  }

  const html = await resp.text();
  const title = extractTitle(html);
  const description = extractDescription(html);

  return { title, description };
}

function extractTitle(html: string): string {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (ogTitle) return decodeEntities(ogTitle[1]);

  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleTag) return decodeEntities(titleTag[1].trim());

  return '';
}

function extractDescription(html: string): string {
  const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  if (ogDesc) return decodeEntities(ogDesc[1]);

  const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
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
