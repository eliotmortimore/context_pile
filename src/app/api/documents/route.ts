import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const user = await currentUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const docs = await prisma.document.findMany({
      where: {
        userId: user.id
      },
      orderBy: {
        createdAt: 'desc'
      },
      select: {
        id: true,
        url: true,
        title: true,
        siteName: true,
        createdAt: true,
        // We don't fetch full markdown content for the list to save bandwidth
        // We'll fetch it individually if needed, or include it? 
        // For simplicity let's include it for now since the app loads everything into memory anyway.
        markdown: true 
      }
    });

    return NextResponse.json(docs);
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
