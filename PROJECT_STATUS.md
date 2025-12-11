# ContextPile Project Status

**Date:** December 10, 2025
**Current Version:** 0.2.0 (SaaS MVP)

## 1. Project Overview
ContextPile is a SaaS application that turns any URL into clean, AI-ready context (Markdown). It is built to bridge the gap between human-readable web content and LLM context windows.

## 2. Technical Stack
*   **Framework:** Next.js 15 (App Router, TypeScript)
*   **Styling:** Tailwind CSS + Typography
*   **Database:** PostgreSQL (Supabase) via Prisma ORM
*   **Authentication:** Clerk
*   **Hosting:** Vercel (Ready for deployment)

## 3. Implemented Features

### Core Parsing
*   **Web Scraper:** Fetches HTML, sanitizes it (DOMPurify), and converts it to Markdown (Turndown).
*   **YouTube Support:** Detects YouTube URLs and extracts video captions/transcripts with timestamps automatically using `youtube-transcript`.
*   **Markdown Cleaning:** Removes scripts, styles, and ads. Preserves images with alt text.

### SaaS Infrastructure
*   **Authentication:** User Sign Up/Login via Clerk.
*   **Database Integration:**
    *   Users are synced to the `User` table in Postgres.
    *   Processed documents are saved to the `Document` table.
*   **History Dashboard:** Users can view their previously compiled documents in the sidebar.
*   **Usage Limits:**
    *   **Free Tier:** Limited to 20 documents.
    *   **Pro Tier:** Unlimited (Stripe logic prepared in DB, pending webhook integration).
    *   *Implementation:* API checks `prisma.document.count()` before processing.

## 4. Recent Changes (To Pick Up On)
We recently added the **YouTube Transcript** feature and the **20-Doc Limit**.

### YouTube Logic
In `src/app/api/process/route.ts`:
```typescript
if (isYoutubeUrl(url)) {
  const transcript = await YoutubeTranscript.fetchTranscript(url);
  // Formats as: **00:15** - text...
}
```

### Usage Limit Logic
In `src/app/api/process/route.ts`:
```typescript
const isPro = user.publicMetadata.isPro === true;
if (!isPro && docCount >= 20) {
  return error(403, 'Upgrade to Pro');
}
```

## 5. Troubleshooting Guide

### 🔴 "EPERM: operation not permitted, uv_cwd"
If you see this error in your terminal, it means the terminal's reference to the current folder is broken (usually after moving/renaming folders).

**Fix:**
1.  **Close** the terminal completely.
2.  Open a new terminal.
3.  Navigate to the project:
    ```bash
    cd Desktop/EBM-WS/Projects/context-pile
    ```
4.  **Install Dependencies** (Required for YouTube feature):
    ```bash
    npm install youtube-transcript
    ```
5.  Restart server: `npm run dev`

### Database Connection Issues
If `npx prisma db push` fails:
1.  Check `.env` for the correct `DATABASE_URL`.
2.  Ensure you are using the **Transaction Pooler** port (`6543`) if deploying to Vercel, or `5432` for direct connection.
3.  Check Supabase "Project Settings" -> "Database" for the string.

## 6. Next Steps (Roadmap)

1.  **Stripe Integration**:
    *   Create a Stripe Product ($9/mo).
    *   Create a Webhook (`/api/webhooks/stripe`) to update Clerk Metadata (`isPro: true`) upon payment.
    *   Add an "Upgrade" button in the UI when the limit is reached.
2.  **Deploy**:
    *   Push to GitHub.
    *   Import to Vercel.
    *   Add Environment Variables in Vercel.

---
*Reference `DEPLOYMENT.md` for the git workflow.*

See [[ContextPile Ideas]] for upcoming ideas for the workflow
