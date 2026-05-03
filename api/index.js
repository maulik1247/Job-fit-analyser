/**
 * Vercel serverless entry: all `/api/*` requests are rewritten here (see vercel.json).
 * Local dev still uses `node server.js` + Vite proxy.
 */
import app from "../server.js";

export default app;
