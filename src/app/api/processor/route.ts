import { NextResponse } from 'next/server';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import DOMPurify from 'isomorphic-dompurify';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/db';

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
    // 1. Auth Check
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Limit Check
    const isPro = (user.publicMetadata as any).isPro === true;
    if (!isPro) {
      const docCount = await prisma.document.count({
        where: { userId: user.id }
      });

      if (docCount >= 20) {
         return NextResponse.json({
           error: 'Free limit reached (20 docs). Upgrade to Pro for unlimited access.'
         }, { status: 403 });
      }
    }

    // 3. Parse Body
    let body;
    const text = await request.text();
    try {
      body = text ? JSON.parse(text) : {};
    } catch (e) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    
    const { url } = body;
    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 });

    // 4. User Sync
    try {
      await prisma.user.upsert({
        where: { id: user.id },
        update: { email: user.emailAddresses[0].emailAddress },
        create: { id: user.id, email: user.emailAddresses[0].emailAddress },
      });
    } catch (dbError) {
      console.error("DB Sync Error (Non-fatal):", dbError);
    }

    // 5. Processing Logic
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

    // 6. Save to DB
    try {
      const savedDoc = await prisma.document.create({
        data: {
          url,
          title: title || 'Untitled',
          siteName: siteName,
          markdown,
          userId: user.id,
        },
      });

      return NextResponse.json({
        id: savedDoc.id,
        title,
        markdown,
        content,
        textContent,
        siteName,
        status: 'success',
        needsTranscript
      });

    } catch (dbError: any) {
      console.error("DB Save Error:", dbError);
      return NextResponse.json({
        id: 'temp-' + crypto.randomUUID(),
        title,
        markdown,
        content,
        textContent,
        siteName,
        status: 'success',
        warning: 'Could not save to history',
        needsTranscript
      });
    }

  } catch (globalError: any) {
    console.error("CRITICAL API ERROR:", globalError);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
