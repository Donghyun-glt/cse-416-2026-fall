"use client";

import { type MouseEvent, useEffect, useRef, useState } from "react";
import { GOOGLE_LOGIN_CHANNEL, googleLoginError } from "@/lib/google-login";

export function GoogleLoginButton({ initialError }: { initialError?: string }) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState(initialError ? googleLoginError(initialError) : "");
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  function login(event: MouseEvent<HTMLAnchorElement>) {
    // Preserve ordinary link behavior before hydration and for modified clicks.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (waiting) { event.preventDefault(); return; }
    cleanupRef.current?.();
    setError("");
    const url = "/api/google/connect?popup=1";
    const popup = window.open(url, "mailflow-google-login", "popup,width=520,height=680");
    if (!popup) {
      // Let the link navigate normally when the browser blocks popups.
      return;
    }
    event.preventDefault();

    setWaiting(true);
    const channel = typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(GOOGLE_LOGIN_CHANNEL)
      : null;
    let finished = false;

    function finish(data: unknown) {
      if (finished || !data || typeof data !== "object") return;
      const result = data as { type?: string; error?: string };
      if (result.type !== GOOGLE_LOGIN_CHANNEL) return;
      finished = true;
      cleanupRef.current?.();
      setWaiting(false);
      if (result.error) {
        setError(googleLoginError(result.error));
      } else {
        // Reload so the server validates the HttpOnly session cookie.
        window.location.assign(new URL("/", window.location.origin));
      }
    }

    function receive(event: MessageEvent) {
      if (event.origin === window.location.origin && event.source === popup) finish(event.data);
    }
    window.addEventListener("message", receive);
    if (channel) channel.onmessage = (event) => finish(event.data);
    // Google can sever window.opener, so BroadcastChannel also delivers the result.
    // Do not use popup.closed as proof of cancellation across Google's origins.
    const timeout = window.setTimeout(() => {
      cleanupRef.current?.();
      setWaiting(false);
      setError("Login timed out. Please try again.");
    }, 10 * 60 * 1000);
    cleanupRef.current = () => {
      finished = true;
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      channel?.close();
      popup.close();
      cleanupRef.current = null;
    };
  }

  return (
    <div>
      <a href="/api/google/connect" onClick={login} aria-disabled={waiting} className="mt-7 inline-flex items-center gap-3 rounded-xl bg-[#5944d8] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#4936c2] aria-disabled:opacity-60">
        {waiting ? "Waiting for Google…" : "Log in with Google"}
      </a>
      {waiting && <div className="mt-3 text-sm text-[#858178]">Complete login in the Google window. <button type="button" className="underline" onClick={() => { cleanupRef.current?.(); setWaiting(false); }}>Cancel</button></div>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
