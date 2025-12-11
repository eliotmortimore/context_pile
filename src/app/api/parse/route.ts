import { NextResponse } from 'next/server';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import DOMPurify from 'isomorphic-dompurify';
import { YoutubeTranscript } from 'youtube-transcript';

// Helper to validate YouTube URL
const isYoutubeUrl = (url: string) => {
  return url.includes('youtube.com') || url.includes('youtu.be');
};

// Helper to scrape full YouTube metadata (including full description)
async function getYouTubeMetadata(url: string) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;
    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    let metadata = {
      title: doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || doc.title || 'Unknown Title',
      channel: 'YouTube',
      description: ''
    };

    // Attempt to get OEmbed if title is generic
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
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // validate URL format
    try {
      new URL(url);
    } catch (e) {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    if (isYoutubeUrl(url)) {
      // --- YOUTUBE MODE (NATIVE NODE.JS) ---
      try {
        const [transcript, metadata] = await Promise.all([
             fetchTranscriptWithTimeout(url),
             getYouTubeMetadata(url)
        ]);

        const title = metadata?.title || `YouTube Transcript: ${url}`;
        const channel = metadata?.channel || 'YouTube';
        const description = metadata?.description || '';
        
        // Generate Markdown
        let markdown = `# ${title}\n`;
        markdown += `**Channel:** ${channel} | **Source:** [YouTube](${url})\n\n`;
        
        if (description) {
           markdown += `> ${description}\n\n`;
        }
        
        const transcriptError = !transcript ? "Could not fetch transcript (Captions might be disabled)" : null;
        
        if (transcriptError) {
             markdown += `**Error:** ${transcriptError}\n`;
        } else {
             markdown += `## Transcript\n\n`;
        }

        // Generate Text & HTML Content
        let textContent = `${title}\nChannel: ${channel}\n\n${description}\n\nTranscript:\n`;
        let htmlContent = `<h1>${title}</h1><p><strong>Channel:</strong> ${channel}</p><blockquote>${description}</blockquote><h2>Transcript</h2>`;
        
        if (transcript && Array.isArray(transcript)) {
             htmlContent += `<ul>`;
             (transcript as any[]).forEach((item: any) => {
                const minutes = Math.floor(item.offset / 1000 / 60);
                const seconds = Math.floor((item.offset / 1000) % 60).toString().padStart(2, '0');
                const timestamp = `${minutes}:${seconds}`;
                
                markdown += `**${timestamp}** - ${item.text}\n\n`;
                textContent += `[${timestamp}] ${item.text}\n`;
                htmlContent += `<li><strong>${timestamp}</strong>: ${item.text}</li>`;
              });
              htmlContent += `</ul>`;
        }

        return NextResponse.json({
          title,
          content: htmlContent,
          textContent: textContent,
          markdown,
          siteName: channel,
          byline: channel,
          excerpt: description ? (description.slice(0, 200) + '...') : ''
        });

      } catch (ytError: any) {
        console.error("YouTube Error:", ytError);
        return NextResponse.json({ error: 'Failed to process YouTube video. ' + ytError.message }, { status: 422 });
      }
    }

    // --- STANDARD WEB MODE ---
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Failed to fetch URL: ${response.statusText}` }, { status: response.status });
    }

    const html = await response.text();
    const cleanHtml = DOMPurify.sanitize(html);
    const doc = new JSDOM(cleanHtml, { url });
    const reader = new Readability(doc.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      return NextResponse.json({ error: 'Failed to parse content from this URL' }, { status: 422 });
    }

    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*'
    });
    
    turndownService.addRule('img', {
      filter: 'img',
      replacement: function (content, node) {
        const alt = (node as HTMLElement).getAttribute('alt') || '';
        const src = (node as HTMLElement).getAttribute('src') || '';
        return src ? `![${alt}](${src})` : '';
      }
    });

    turndownService.remove('script');
    turndownService.remove('style');
    turndownService.remove('noscript');

    const markdown = turndownService.turndown(article.content);

    return NextResponse.json({
      title: article.title,
      content: article.content,
      textContent: article.textContent,
      markdown: markdown,
      siteName: article.siteName,
      byline: article.byline,
      excerpt: article.excerpt
    });

  } catch (error: any) {
    console.error('Error processing URL:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
