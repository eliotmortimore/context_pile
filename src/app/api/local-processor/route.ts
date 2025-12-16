import { NextResponse } from 'next/server';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import DOMPurify from 'isomorphic-dompurify';
import { YoutubeTranscript } from '@danielxceron/youtube-transcript';

// LOCAL VERSION - No authentication required
// Force Node.js runtime (not Edge) - required for jsdom and other node-specific packages
export const runtime = 'nodejs';

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

// Helper to fetch transcript with timeout
async function fetchTranscriptWithTimeout(url: string): Promise<any[] | null> {
  try {
    const transcriptPromise = YoutubeTranscript.fetchTranscript(url);
    const timeoutPromise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error("Transcript fetch timed out")), 30000) // 30s timeout for local
    );
    return await Promise.race([transcriptPromise, timeoutPromise]) as any[] | null;
  } catch (e) {
    console.error("Transcript fetch failed:", e);
    return null;
  }
}

// GET Handler to test route availability
export async function GET() {
    return NextResponse.json({ status: 'Local Processor API is ready (no auth required)' });
}

// Main POST Handler - NO AUTH REQUIRED FOR LOCAL USE
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

    if (isYoutubeUrl(url)) {
      // --- YOUTUBE MODE (with transcript) ---
      siteName = 'YouTube';

      try {
        // Fetch metadata and transcript in parallel
        const [metadata, transcript] = await Promise.all([
          getYouTubeMetadata(url),
          fetchTranscriptWithTimeout(url)
        ]);

        title = metadata?.title || `YouTube Video: ${url}`;
        siteName = metadata?.channel || 'YouTube';

        // Construct Markdown
        markdown = `# ${title}\n`;
        markdown += `**Channel:** ${siteName} | **Source:** [YouTube](${url})\n\n`;

        if (metadata?.description) {
          markdown += `> ${metadata.description}\n\n`;
        }

        // Add transcript
        if (transcript && Array.isArray(transcript) && transcript.length > 0) {
          markdown += `## Transcript\n\n`;
          transcript.forEach((item: any) => {
            const minutes = Math.floor(item.offset / 1000 / 60);
            const seconds = Math.floor((item.offset / 1000) % 60).toString().padStart(2, '0');
            markdown += `**${minutes}:${seconds}** - ${item.text}\n\n`;
          });
        } else {
          markdown += `\n\n**Note:** No transcript available (captions may be disabled for this video)\n`;
        }

        // Construct HTML/Text
        content = `<h1>${title}</h1><p><strong>Channel:</strong> ${siteName}</p>`;
        if (metadata?.description) content += `<blockquote>${metadata.description}</blockquote>`;

        textContent = `${title}\nChannel: ${siteName}\n\n${metadata?.description || ''}`;

      } catch (ytError: any) {
        console.error("YouTube Processing Error:", ytError);
        return NextResponse.json({ error: 'Could not fetch YouTube data: ' + ytError.message }, { status: 422 });
      }

    } else {
      // --- WEB SCRAPER MODE (STANDARD) ---
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
        const doc = new JSDOM(cleanHtml, { url });
        const reader = new Readability(doc.window.document);
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
    }

    // Return result (no DB save in local version)
    return NextResponse.json({
      id: 'local-' + crypto.randomUUID(),
      title,
      markdown,
      content,
      textContent,
      siteName,
      status: 'success'
    });

  } catch (globalError: any) {
    console.error("CRITICAL API ERROR:", globalError);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
