export const revalidate = 60;

// Ported from Next.js:
// test/e2e/app-dir/searchparams-static-bailout/searchparams-static-bailout.test.ts
// https://github.com/vercel/next.js/blob/canary/test/e2e/app-dir/searchparams-static-bailout/searchparams-static-bailout.test.ts
export default async function QueryDependentPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "missing" } = await searchParams;
  return (
    <main>
      <h1>Query-dependent response cache probe</h1>
      <output data-testid="query-dependent-value">{q}</output>
      <output data-testid="query-dependent-render-id">{crypto.randomUUID()}</output>
    </main>
  );
}
