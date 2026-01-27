import { NextResponse } from 'next/server';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import DOMPurify from 'isomorphic-dompurify';

// Force Node.js runtime (not Edge) - required for jsdom and other node-specific packages
export const runtime = 'nodejs';

// --- Extraction Helper Functions ---

function extractHeadings(doc: Document): { level: number; text: string }[] {
  const headings: { level: number; text: string }[] = [];
  const headingElements = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  headingElements.forEach((el) => {
    const level = parseInt(el.tagName.charAt(1));
    const text = el.textContent?.trim() || '';
    if (text) {
      headings.push({ level, text });
    }
  });
  return headings;
}

function extractLinks(doc: Document, baseUrl: string): { text: string; href: string }[] {
  const links: { text: string; href: string }[] = [];
  const seenHrefs = new Set<string>();
  const anchorElements = doc.querySelectorAll('a[href]');

  for (const el of anchorElements) {
    if (links.length >= 100) break;

    const href = el.getAttribute('href');
    if (!href) continue;

    // Resolve relative URLs
    let absoluteHref: string;
    try {
      absoluteHref = new URL(href, baseUrl).href;
    } catch {
      continue;
    }

    // Skip internal anchors and duplicates
    if (absoluteHref.startsWith('#') || seenHrefs.has(absoluteHref)) continue;
    seenHrefs.add(absoluteHref);

    const text = el.textContent?.trim() || '';
    if (text && absoluteHref) {
      links.push({ text, href: absoluteHref });
    }
  }

  return links;
}

function extractImages(doc: Document, baseUrl: string): { src: string; alt: string }[] {
  const images: { src: string; alt: string }[] = [];
  const imgElements = doc.querySelectorAll('img[src]');

  imgElements.forEach((el) => {
    const src = el.getAttribute('src');
    if (!src) return;

    // Resolve relative URLs
    let absoluteSrc: string;
    try {
      absoluteSrc = new URL(src, baseUrl).href;
    } catch {
      return;
    }

    const alt = el.getAttribute('alt') || '';
    images.push({ src: absoluteSrc, alt });
  });

  return images;
}

function extractWikipediaData(doc: Document): { infobox?: Record<string, string>; categories?: string[]; references?: string[] } {
  const result: { infobox?: Record<string, string>; categories?: string[]; references?: string[] } = {};

  // Extract infobox data
  const infobox = doc.querySelector('.infobox');
  if (infobox) {
    const infoboxData: Record<string, string> = {};
    const rows = infobox.querySelectorAll('tr');
    rows.forEach((row) => {
      const th = row.querySelector('th');
      const td = row.querySelector('td');
      if (th && td) {
        const key = th.textContent?.trim() || '';
        const value = td.textContent?.trim() || '';
        if (key && value) {
          infoboxData[key] = value;
        }
      }
    });
    if (Object.keys(infoboxData).length > 0) {
      result.infobox = infoboxData;
    }
  }

  // Extract categories
  const categoryLinks = doc.querySelectorAll('#mw-normal-catlinks ul li a');
  if (categoryLinks.length > 0) {
    result.categories = Array.from(categoryLinks)
      .map((el) => el.textContent?.trim() || '')
      .filter((text) => text.length > 0);
  }

  // Extract references (citation text)
  const refList = doc.querySelectorAll('.references li');
  if (refList.length > 0) {
    result.references = Array.from(refList)
      .slice(0, 50) // Limit to 50 references
      .map((el) => el.textContent?.trim() || '')
      .filter((text) => text.length > 0);
  }

  return result;
}

// Helper to validate YouTube URL
const isYoutubeUrl = (url: string) => {
  return url.includes('youtube.com') || url.includes('youtu.be');
};

// Helper to get YouTube metadata using oEmbed API (primary) with HTML scraping fallback for description
async function getYouTubeMetadata(url: string) {
  let metadata = {
    title: 'Unknown Title',
    channel: 'YouTube',
    description: ''
  };

  // Primary: Use oEmbed API (fast and reliable)
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const oembedRes = await fetch(oembedUrl, {
      signal: AbortSignal.timeout(5000)
    });

    if (oembedRes.ok) {
      const oembedData = await oembedRes.json();
      metadata.title = oembedData.title || metadata.title;
      metadata.channel = oembedData.author_name || metadata.channel;
    }
  } catch (e) {
    console.warn('oEmbed fetch failed, will try HTML scraping:', e);
  }

  // Secondary: Try to get full description from HTML (oEmbed doesn't include description)
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(8000)
    });

    if (response.ok) {
      const html = await response.text();
      const dom = new JSDOM(html);
      const doc = dom.window.document;

      // Fallback for title/channel if oEmbed failed
      if (metadata.title === 'Unknown Title') {
        metadata.title = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || doc.title || metadata.title;
      }
      if (metadata.channel === 'YouTube') {
        const itempropName = doc.querySelector('link[itemprop="name"]')?.getAttribute('content');
        metadata.channel = itempropName || metadata.channel;
      }

      // Get description from OG meta tag first
      metadata.description = doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';

      // Try to get full description from ytInitialData (more complete than OG)
      try {
        const pattern = /var ytInitialData = ({.*?});/;
        const match = html.match(pattern);
        if (match && match[1]) {
          const data = JSON.parse(match[1]);
          const contents = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents;

          if (Array.isArray(contents)) {
            const secondaryInfo = contents.find((item: any) => item.videoSecondaryInfoRenderer)?.videoSecondaryInfoRenderer;
            if (secondaryInfo) {
              if (secondaryInfo.attributedDescription?.content) {
                metadata.description = secondaryInfo.attributedDescription.content;
              } else if (secondaryInfo.description?.runs) {
                metadata.description = secondaryInfo.description.runs.map((r: any) => r.text).join('');
              }
            }
          }
        }
      } catch (e) {
        // ytInitialData parsing failed, but we may have OG description
        console.warn('ytInitialData parsing failed:', e);
      }
    }
  } catch (e) {
    console.warn('HTML scraping failed:', e);
  }

  // Return null only if we couldn't get ANY metadata
  if (metadata.title === 'Unknown Title' && metadata.channel === 'YouTube') {
    return null;
  }

  return metadata;
}

// 1. ADD GET Handler to test route availability
export async function GET() {
    return NextResponse.json({ status: 'Processor API is ready' });
}

// 2. Main POST Handler
export async function POST(request: Request) {
  try {
    // Parse Body
    let body;
    const text = await request.text();
    try {
      body = text ? JSON.parse(text) : {};
    } catch (e) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { url } = body;
    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 });

    // Processing Logic
    let title = '';
    let markdown = '';
    let siteName = '';
    let content = '';
    let textContent = '';
    let needsTranscript = false;

    if (isYoutubeUrl(url)) {
      // --- YOUTUBE METADATA MODE (FAST) ---
      siteName = 'YouTube';

      try {
        // Fetch ONLY metadata, skip transcript for now
        const metadata = await getYouTubeMetadata(url);

        title = metadata?.title || `YouTube Transcript: ${url}`;
        siteName = metadata?.channel || 'YouTube';

        // Construct Initial Markdown
        markdown = `# ${title}\n`;
        markdown += `**Channel:** ${siteName} | **Source:** [YouTube](${url})\n\n`;

        if (metadata?.description) {
          markdown += `> ${metadata.description}\n\n`;
        }

        // Placeholder for transcript
        markdown += `_Fetching transcript..._`;

        // Construct HTML/Text
        content = `<h1>${title}</h1><p><strong>Channel:</strong> ${siteName}</p>`;
        if (metadata?.description) content += `<blockquote>${metadata.description}</blockquote>`;
        content += `<p><em>Fetching transcript...</em></p>`;

        textContent = `${title}\nChannel: ${siteName}\n\n${metadata?.description || ''}\n\nFetching transcript...`;

        needsTranscript = true;

      } catch (ytError: any) {
        console.error("YouTube Metadata Error:", ytError);
        return NextResponse.json({ error: 'Could not fetch YouTube data.' }, { status: 422 });
      }

    } else {
      // --- WEB SCRAPER MODE (STANDARD) ---
      let headings: { level: number; text: string }[] = [];
      let links: { text: string; href: string }[] = [];
      let images: { src: string; alt: string }[] = [];
      let language = '';
      let wikipedia: { infobox?: Record<string, string>; categories?: string[]; references?: string[] } | undefined;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Failed to fetch page: ${response.status} ${response.statusText}`);
        }

        const html = await response.text();
        const cleanHtml = DOMPurify.sanitize(html);
        const dom = new JSDOM(cleanHtml, { url });
        const doc = dom.window.document;

        // Extract language from HTML
        language = doc.documentElement.getAttribute('lang') || '';

        // Extract structured data before Readability modifies the DOM
        headings = extractHeadings(doc);
        links = extractLinks(doc, url);
        images = extractImages(doc, url);

        // Extract Wikipedia-specific data if applicable
        if (url.includes('wikipedia.org')) {
          // Re-parse original HTML for Wikipedia extraction (without sanitization to preserve Wikipedia classes)
          const wikiDom = new JSDOM(html, { url });
          wikipedia = extractWikipediaData(wikiDom.window.document);
        }

        const reader = new Readability(doc);
        const article = reader.parse();

        if (!article || !article.content) {
          throw new Error('Readability could not parse content');
        }

        title = article.title || 'Untitled';
        siteName = article.siteName || new URL(url).hostname;
        content = article.content || '';
        textContent = article.textContent || '';

        const turndownService = new TurndownService({
          headingStyle: 'atx',
          codeBlockStyle: 'fenced',
          bulletListMarker: '-',
          emDelimiter: '*'
        });

        turndownService.remove(['script', 'style', 'noscript', 'iframe']);

        markdown = turndownService.turndown(article.content);

      } catch (scrapeError: any) {
        console.error("Scraping Error:", scrapeError);
        return NextResponse.json({ error: scrapeError.message || 'Failed to scrape URL' }, { status: 422 });
      }

      // Calculate word count
      const wordCount = textContent.split(/\s+/).filter(word => word.length > 0).length;

      // Return the processed content with enhanced metadata
      return NextResponse.json({
        id: 'doc-' + crypto.randomUUID(),
        title,
        markdown,
        content,
        textContent,
        siteName,
        status: 'success',
        needsTranscript,
        // New enhanced fields
        sourceUrl: url,
        scrapedAt: new Date().toISOString(),
        wordCount,
        language,
        headings,
        links,
        images,
        ...(wikipedia && Object.keys(wikipedia).length > 0 ? { wikipedia } : {})
      });
    }

    // Return for YouTube (no enhanced extraction for YouTube)
    return NextResponse.json({
      id: 'doc-' + crypto.randomUUID(),
      title,
      markdown,
      content,
      textContent,
      siteName,
      status: 'success',
      needsTranscript,
      sourceUrl: url,
      scrapedAt: new Date().toISOString(),
      wordCount: textContent.split(/\s+/).filter(word => word.length > 0).length
    });

  } catch (globalError: any) {
    console.error("CRITICAL API ERROR:", globalError);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
