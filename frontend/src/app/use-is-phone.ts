"use client";

import { useSyncExternalStore } from "react";

// Same width as Tailwind's `sm` breakpoint: below it the app uses its phone layout.
const PHONE = "(max-width: 639px)";

/** True on phone-width screens; follows rotation and window resizing. False while rendering on the server. */
export function useIsPhone() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(PHONE);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}
