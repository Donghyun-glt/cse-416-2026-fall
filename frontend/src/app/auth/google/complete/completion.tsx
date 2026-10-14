"use client";

import { useEffect } from "react";
import { GOOGLE_LOGIN_CHANNEL, googleLoginError } from "@/lib/google-login";

export function GoogleLoginCompletion({ error }: { error?: string }) {
  useEffect(() => {
    const result = { type: GOOGLE_LOGIN_CHANNEL, error };
    const channel = typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(GOOGLE_LOGIN_CHANNEL)
      : null;
    channel?.postMessage(result);
    window.opener?.postMessage(result, window.location.origin);
    const timeout = window.setTimeout(() => {
      channel?.close();
      window.close();
    }, 250);
    return () => { window.clearTimeout(timeout); channel?.close(); };
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f7f4] p-6">
      <div className="max-w-md rounded-3xl bg-white p-10 text-center shadow-lg">
        <h1 className="text-2xl font-bold">{error ? "Login could not be completed" : "You’re logged in"}</h1>
        <p className="mt-4 text-sm text-[#858178]">{error ? googleLoginError(error) : "You can return to MailFlow. This window will close automatically."}</p>
        <a className="mt-6 inline-block font-bold text-[#5944d8]" href={error ? `/?error=${encodeURIComponent(error)}` : "/"}>Continue to MailFlow</a>
      </div>
    </main>
  );
}
