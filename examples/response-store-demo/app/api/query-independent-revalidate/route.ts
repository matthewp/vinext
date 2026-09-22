export const revalidate = 60;

export function GET(): Response {
  return Response.json({ renderId: crypto.randomUUID() });
}
