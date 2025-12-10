import { NextResponse } from 'next/server';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import DOMPurify from 'isomorphic-dompurify';

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

    // Fetch the HTML content
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Failed to fetch URL: ${response.statusText}` }, { status: response.status });
    }

    const html = await response.text();

    // Sanitize HTML before parsing (optional but safer)
    const cleanHtml = DOMPurify.sanitize(html);

    // Parse with JSDOM
    const doc = new JSDOM(cleanHtml, { url });
    const reader = new Readability(doc.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      return NextResponse.json({ error: 'Failed to parse content from this URL' }, { status: 422 });
    }

    // Configure turndown
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*'
    });
    
    // Ensure alt text is preserved for images
    turndownService.addRule('img', {
      filter: 'img',
      replacement: function (content, node) {
        const alt = (node as HTMLElement).getAttribute('alt') || '';
        const src = (node as HTMLElement).getAttribute('src') || '';
        // If no src, skip. If no alt, just use empty.
        // We render it as an image with alt text.
        return src ? `![${alt}](${src})` : '';
      }
    });

    turndownService.remove('script');
    turndownService.remove('style');
    turndownService.remove('noscript');

    const markdown = turndownService.turndown(article.content);

    return NextResponse.json({
      title: article.title,
      content: article.content, // HTML content
      textContent: article.textContent, // Plain text
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
