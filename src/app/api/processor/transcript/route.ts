import { NextResponse } from 'next/server';
import { YoutubeTranscript } from '@danielxceron/youtube-transcript';

// Force Node.js runtime
export const runtime = 'nodejs';

// Helper to fetch transcript with timeout
async function fetchTranscriptWithTimeout(url: string): Promise<any[] | null> {
  try {
    const transcriptPromise = YoutubeTranscript.fetchTranscript(url);
    const timeoutPromise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error("Transcript fetch timed out")), 25000)
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
      return NextResponse.json({ error: 'Missing url' }, { status: 400 });
    }

    // Fetch Transcript
    let transcriptMarkdown = '';
    try {
        const transcript = await fetchTranscriptWithTimeout(url);

        if (!transcript) {
            transcriptMarkdown = `\n\n**Error:** Could not fetch transcript (Captions might be disabled)\n`;
        } else if (Array.isArray(transcript)) {
            transcriptMarkdown = `\n\n## Transcript\n\n`;
            (transcript as any[]).forEach((item: any) => {
                const minutes = Math.floor(item.offset / 1000 / 60);
                const seconds = Math.floor((item.offset / 1000) % 60).toString().padStart(2, '0');
                transcriptMarkdown += `**${minutes}:${seconds}** - ${item.text}\n\n`;
            });
        }
    } catch (e) {
        transcriptMarkdown = `\n\n**Error:** Failed to load transcript.\n`;
    }

    return NextResponse.json({
        success: true,
        transcript: transcriptMarkdown
    });

  } catch (error: any) {
    console.error("Transcript API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
