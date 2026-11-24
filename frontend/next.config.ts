import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.14"],
  // The development-only "N" indicator sits in a screen corner, and on phone layouts every
  // corner holds a control (Briefing and More tabs, Back, account), so it blocked taps.
  // Compile and runtime errors still show without it.
  devIndicators: false,
};

export default nextConfig;
