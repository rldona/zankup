/** Where to go after signing in: only paths inside the app, never an absolute URL (open redirect). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
