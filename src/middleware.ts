import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Define routes that should be protected
// We allow the home page ('/') to be public so visitors can see what the app is
// But we might want to protect the API or dashboard features later
const isProtectedRoute = createRouteMatcher(['/dashboard(.*)', '/api(.*)'])

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) await auth.protect()
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
