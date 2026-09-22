export const dynamic = "force-static";
export const revalidate = 60;

export function GET(request: Request): Response {
  return Response.json({
    query: new URL(request.url).searchParams.get("q"),
    renderId: crypto.randomUUID(),
  });
}
