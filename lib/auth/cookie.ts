// The session cookie's name. Its own file, free of server-only imports, because
// next.config.ts reads it too: a visit to the landing page with this cookie goes
// straight to /home.
export const SESSION_COOKIE = "dh_session";
