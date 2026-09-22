export const revalidate = 60;

export default function QueryIndependentPublicPage() {
  return (
    <main>
      <h1>Explicitly public query-independent response cache probe</h1>
      <output data-testid="query-independent-public-render-id">{crypto.randomUUID()}</output>
    </main>
  );
}
