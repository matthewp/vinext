export const dynamic = "force-dynamic";

/** Cloudflare-specific explicit caching keeps query-dependent responses isolated by full URL. */
export default async function QueryDependentPublicPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "missing" } = await searchParams;
  return (
    <main>
      <h1>Explicitly public query-dependent response cache probe</h1>
      <output data-testid="query-dependent-public-value">{q}</output>
      <output data-testid="query-dependent-public-render-id">{crypto.randomUUID()}</output>
    </main>
  );
}
