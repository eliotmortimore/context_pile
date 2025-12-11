import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { YoutubeTranscript } from '@danielxceron/youtube-transcript';

// Force Node.js runtime
export const runtime = 'nodejs';

// Simpler transcript endpoint that doesn't require DB
// Just fetches and returns the transcript directly

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'Missing url' }, { status: 400 });
    }

    // Fetch Transcript
    let transcriptMarkdown = '';
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(url);

      if (!transcript || transcript.length === 0) {
        transcriptMarkdown = `\n\n**Note:** No transcript available (captions may be disabled for this video)\n`;
      } else {
        transcriptMarkdown = `\n\n## Transcript\n\n`;
        transcript.forEach((item: any) => {
          const minutes = Math.floor(item.offset / 1000 / 60);
          const seconds = Math.floor((item.offset / 1000) % 60).toString().padStart(2, '0');
          transcriptMarkdown += `**${minutes}:${seconds}** - ${item.text}\n\n`;
        });
      }
    } catch (e: any) {
      console.error('Transcript fetch error:', e);
      transcriptMarkdown = `\n\n**Error:** Could not fetch transcript - ${e.message || 'Unknown error'}\n`;
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
