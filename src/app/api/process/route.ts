import { NextResponse } from 'next/server';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import DOMPurify from 'isomorphic-dompurify';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/db';
import { YoutubeTranscript } from 'youtube-transcript';

// Helper to validate YouTube URL
const isYoutubeUrl = (url: string) => {
  return url.includes('youtube.com') || url.includes('youtu.be');
};

// Helper to scrape full YouTube metadata (including full description)
async function getYouTubeMetadata(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    if (!response.ok) return null;
    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    let metadata = {
      title: doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || doc.title || 'Unknown Title',
      channel: 'YouTube',
      description: ''
    };

    // Attempt to get OEmbed if title is generic, which likely means scraping failed or returned a consent page
    if (metadata.title === 'Unknown Title' || metadata.title === 'YouTube') {
       try {
         const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
         const oembedRes = await fetch(oembedUrl);
         if (oembedRes.ok) {
            const oembedData = await oembedRes.json();
            metadata.title = oembedData.title || metadata.title;
            metadata.channel = oembedData.author_name || metadata.channel;
         }
       } catch (e) {
         // Ignore oembed failure
       }
    }

    // Channel Name
    const itempropName = doc.querySelector('link[itemprop="name"]')?.getAttribute('content');
    const ogSiteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
    if (metadata.channel === 'YouTube') {
        metadata.channel = itempropName || ogSiteName || 'YouTube';
    }

    // Description from OG (Fallback)
    metadata.description = doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';

    // Full Description from ytInitialData
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
      console.warn('Error parsing ytInitialData for description:', e);
    }

    return metadata;

  } catch (e) {
    console.error('Error fetching YouTube metadata:', e);
    return null;
  }
}

// Helper to fetch transcript with timeout
async function fetchTranscriptWithTimeout(url: string): Promise<any[] | null> {
  try {
    const transcriptPromise = YoutubeTranscript.fetchTranscript(url);
    const timeoutPromise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error("Transcript fetch timed out")), 5000)
    );
    return await Promise.race([transcriptPromise, timeoutPromise]) as any[] | null;
  } catch (e) {
    console.error("Transcript fetch failed:", e);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    // 1. Auth Check (Fail fast)
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Limit Check (20 Docs for Free Users)
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

    // 3. Parse Body safely
    let body;
    const text = await request.text();
    try {
      body = text ? JSON.parse(text) : {};
    } catch (e) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    
    const { url } = body;
    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 });

    // 4. User Sync (Upsert)
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

    if (isYoutubeUrl(url)) {
      // --- YOUTUBE MODE ---
      siteName = 'YouTube';
      
      try {
        const [transcript, metadata] = await Promise.all([
          fetchTranscriptWithTimeout(url),
          getYouTubeMetadata(url)
        ]);
        
        // Use metadata if available
        title = metadata?.title || `YouTube Transcript: ${url}`;
        siteName = metadata?.channel || 'YouTube';
        
        // Construct Rich Markdown
        markdown = `# ${title}\n`;
        markdown += `**Channel:** ${siteName} | **Source:** [YouTube](${url})\n\n`;
        
        if (metadata?.description) {
          markdown += `> ${metadata.description}\n\n`;
        }
        
        if (!transcript) {
          markdown += `**Error:** Could not fetch transcript (Captions might be disabled)\n\n`;
        } else if (Array.isArray(transcript)) {
          markdown += `## Transcript\n\n`;
          (transcript as any[]).forEach((item: any) => {
            const minutes = Math.floor(item.offset / 1000 / 60);
            const seconds = Math.floor((item.offset / 1000) % 60).toString().padStart(2, '0');
            markdown += `**${minutes}:${seconds}** - ${item.text}\n\n`;
          });
        }
        
      } catch (ytError: any) {
        console.error("YouTube Error:", ytError);
        return NextResponse.json({ error: 'Could not fetch YouTube data.' }, { status: 422 });
      }

    } else {
      // --- WEB SCRAPER MODE ---
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
        siteName,
        status: 'success'
      });

    } catch (dbError: any) {
      console.error("DB Save Error:", dbError);
      return NextResponse.json({
        id: 'temp-' + crypto.randomUUID(),
        title,
        markdown,
        siteName,
        status: 'success',
        warning: 'Could not save to history'
      });
    }

  } catch (globalError: any) {
    console.error("CRITICAL API ERROR:", globalError);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
