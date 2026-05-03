import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App.jsx";
import "./index.css";

const publishableKey =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

const root = ReactDOM.createRoot(document.getElementById("root"));

if (!publishableKey) {
  root.render(
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-zinc-950 px-6 text-center text-zinc-100">
      <h1 className="mb-3 text-xl font-semibold">Clerk not configured</h1>
      <p className="max-w-md text-sm text-zinc-400">
        Add{" "}
        <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200">
          VITE_CLERK_PUBLISHABLE_KEY
        </code>{" "}
        or{" "}
        <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200">
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
        </code>{" "}
        to your <code className="text-zinc-300">.env</code> file. Create a
        free application at{" "}
        <a
          href="https://dashboard.clerk.com"
          className="text-blue-400 underline"
          target="_blank"
          rel="noreferrer"
        >
          clerk.com
        </a>{" "}
        and copy the publishable key. Also set{" "}
        <code className="rounded bg-zinc-800 px-1.5 py-0.5">CLERK_SECRET_KEY</code>{" "}
        for the Node server.
      </p>
    </div>
  );
} else {
  root.render(
    <React.StrictMode>
      <ClerkProvider
        publishableKey={publishableKey}
        appearance={{ baseTheme: "light" }}
      >
        <App />
      </ClerkProvider>
    </React.StrictMode>
  );
}
