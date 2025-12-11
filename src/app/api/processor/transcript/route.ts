import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/db';
import { YoutubeTranscript } from '@danielxceron/youtube-transcript';

// Force Node.js runtime
export const runtime = 'nodejs';

// Helper to fetch transcript with timeout
async function fetchTranscriptWithTimeout(url: string): Promise<any[] | null> {
  try {
    const transcriptPromise = YoutubeTranscript.fetchTranscript(url);
    const timeoutPromise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error("Transcript fetch timed out")), 25000) // 25s timeout (Vercel hobby is 10s, pro is 60s. Let's aim high but handle failure)
    );
    return await Promise.race([transcriptPromise, timeoutPromise]) as any[] | null;
  } catch (e) {
    console.error("Transcript fetch failed:", e);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { docId, url } = await request.json();

    if (!docId || !url) {
      return NextResponse.json({ error: 'Missing docId or url' }, { status: 400 });
    }

    // Verify ownership
    const doc = await prisma.document.findUnique({
      where: { id: docId }
    });

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    if (doc.userId !== user.id) {
        return NextResponse.json({ error: 'Unauthorized access to document' }, { status: 403 });
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

    // Update Document
    // We replace the "_Fetching transcript..._" placeholder if it exists, otherwise append
    const currentMarkdown = doc.markdown || '';
    let newMarkdown = currentMarkdown.replace('_Fetching transcript..._', '') + transcriptMarkdown;

    const updatedDoc = await prisma.document.update({
        where: { id: docId },
        data: {
            markdown: newMarkdown
        }
    });

    return NextResponse.json({
        success: true,
        markdown: updatedDoc.markdown
    });

  } catch (error: any) {
    console.error("Transcript API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
