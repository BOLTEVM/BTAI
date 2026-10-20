import type { NextConfig } from "next";
import path from "node:path";

// The DarkCircle Suite deploys this app to GitHub Pages at /bai/. Its deploy workflow sets
// PAGES_BASE_PATH=/bai, which switches the build to a static export whose asset URLs are
// absolute under that base (the suite's 404 router sends the darkstarrail/starrail aliases
// here, so exactly one copy of the export is published). Unset locally and in BTAI's own CI,
// so `next dev` and the default `next build` are unchanged.
const pagesBasePath = process.env.PAGES_BASE_PATH;

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  ...(pagesBasePath
    ? {
        output: "export",
        basePath: pagesBasePath,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
