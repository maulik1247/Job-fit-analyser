/**
 * Vercel: single serverless entry for all `/api/*` after `vercel.json` rewrite → `__vp` query.
 * Local dev: `node server.js` + Vite proxy to :8787.
 */
import app from "../server.js";

export default app;
