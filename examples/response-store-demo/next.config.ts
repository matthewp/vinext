import type { NextConfig } from "vinext";

const personalizedPaths = ["/prewarm-target", "/pages-prewarm"] as const;
const personalizedVisitors = ["config-a", "config-b"] as const;

export default {
  headers: async () => [
    ...personalizedPaths.flatMap((source) =>
      personalizedVisitors.map((visitor) => ({
        source,
        has: [{ type: "header" as const, key: "x-test-config-visitor", value: visitor }],
        headers: [{ key: "X-Workers-Config-Visitor", value: visitor }],
      })),
    ),
    {
      source: "/api/query-cache",
      headers: [{ key: "Cache-Control", value: "public, s-maxage=300" }],
    },
    {
      source: "/query-dependent-public",
      headers: [{ key: "Cache-Control", value: "public, s-maxage=300" }],
    },
  ],
  rewrites: async () => [
    { source: "/query-rewrite/:slug", destination: "/cached/:slug" },
  ],
} satisfies NextConfig;
