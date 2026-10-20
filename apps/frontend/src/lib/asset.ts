/**
 * Public-asset URLs must carry the Pages base path: next/image does NOT apply
 * basePath to src automatically, so a bare "/logo.png" would resolve at the
 * domain root and 404 when the app is served under /bai/. NEXT_PUBLIC_BASE_PATH
 * is inlined from PAGES_BASE_PATH by next.config.ts — "" in dev, "/bai" in the
 * DarkCircle Suite deploy.
 */
export const ASSET_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function assetPath(path: string): string {
  return `${ASSET_BASE}${path}`;
}
