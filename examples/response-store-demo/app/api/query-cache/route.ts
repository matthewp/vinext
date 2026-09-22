export const dynamic = "force-dynamic";

/** Cloudflare-specific explicit caching: query values must remain in the outer key. */
export function GET(request: Request): Response {
  return Response.json(
    {
      query: new URL(request.url).searchParams.get("q"),
      renderId: crypto.randomUUID(),
    },
    { headers: { "Cache-Control": "public, s-maxage=300" } },
  );
}
