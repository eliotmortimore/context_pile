import { NextResponse } from 'next/server';

// Documents endpoint disabled - no authentication
// This was used to fetch user-specific document history

export async function GET() {
  return NextResponse.json([]);
}
