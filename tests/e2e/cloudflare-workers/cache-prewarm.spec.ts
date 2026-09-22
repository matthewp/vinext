import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const backend = process.env.VINEXT_E2E_CACHE_BACKEND;

test("deployment pre-warming and force-dynamic bypass work with the configured cache", async ({
  baseURL,
  request,
}) => {
  test.skip(!baseURL?.startsWith("https://"), "requires a deployed Cloudflare Worker");
  if (!baseURL) throw new Error("deployed test requires a base URL");
  test.setTimeout(90_000);

  const testStartedAt = Date.now();
  const buildId = fs
    .readFileSync("examples/response-store-demo/dist/server/BUILD_ID", "utf-8")
    .trim();
  const rscBuildId = fs
    .readFileSync("examples/response-store-demo/dist/server/RSC_BUILD_ID", "utf-8")
    .trim();
  const deadline = Date.now() + 60_000;
  let consecutiveReady = 0;

  do {
    const readiness = await request.get(`${baseURL}/api/prewarm-version?readiness=${randomUUID()}`);
    if (readiness.ok() && readiness.headers()["x-vinext-seed-worker"] !== "1") {
      const body = (await readiness.json()) as { buildId?: string };
      consecutiveReady = body.buildId === buildId ? consecutiveReady + 1 : 0;
    } else {
      consecutiveReady = 0;
    }
    await readiness.dispose();
    if (consecutiveReady === 5) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (Date.now() < deadline);

  expect(consecutiveReady, `${backend} Worker did not finish promotion`).toBe(5);

  const warmed = await request.get(`${baseURL}/cached/intro?utm=prewarmed-first`, {
    headers: { accept: "text/html" },
  });
  const warmedHeaders = warmed.headers();
  expect(warmed.ok(), JSON.stringify(warmedHeaders)).toBe(true);
  if (backend === "workers-cache") {
    expect(["HIT", "MISS"], JSON.stringify(warmedHeaders)).toContain(
      warmedHeaders["cf-cache-status"],
    );
  } else {
    expect(warmedHeaders["x-vinext-cache"], JSON.stringify(warmedHeaders)).toBe("HIT");
  }
  const warmedBody = await warmed.text();
  const warmedDataId = /data-cache-id[^>]*>([^<]+)</.exec(warmedBody)?.[1];
  expect(warmedDataId).toBeTruthy();
  const cachedAt = Number(/data-cache-created-at[^>]*>([^<]+)</.exec(warmedBody)?.[1]);
  expect(cachedAt).toBeLessThan(testStartedAt + 1_000);

  if (backend === "workers-cache" && warmedHeaders["cf-cache-status"] === "MISS") {
    const reused = await request.get(`${baseURL}/cached/intro?utm=prewarmed-second`, {
      headers: { accept: "text/html" },
    });
    expect(reused.headers()["cf-cache-status"], JSON.stringify(reused.headers())).toBe("HIT");
    await reused.dispose();
  }

  // This route is explicitly no-store, so neither response-cache implementation
  // can satisfy it. It calls the same cached function as the page and therefore
  // proves that deployment warmup populated the configured data adapter.
  const probe = await request.get(
    `${baseURL}/api/cache-prewarm-probe/intro?cache-e2e=${randomUUID()}`,
  );
  const probeHeaders = probe.headers();
  expect(probe.ok(), JSON.stringify(probeHeaders)).toBe(true);
  expect(probeHeaders["x-vinext-build-id"]).toBe(rscBuildId);
  expect(probeHeaders["cache-control"]).toContain("no-store");
  const probeBody = (await probe.json()) as { cacheId: string; cachedAt: number; slug: string };
  expect(probeBody).toEqual({
    cacheId: warmedDataId,
    cachedAt,
    slug: "intro",
  });

  // Next.js keys a proven static App artifact by resolved pathname rather than
  // arbitrary public query parameters.
  // https://github.com/vercel/next.js/blob/canary/packages/next/src/build/templates/app-page-runtime.ts
  // KV proves the deploy-time seed; response-stage adapters use a cold path so
  // this also proves that a different query reuses the admitted response.
  const queryIndependentPath = backend === "kv" ? "/cached/intro" : `/cached/query-${randomUUID()}`;
  const firstStatic = await request.get(`${baseURL}${queryIndependentPath}?utm=first`, {
    headers: { accept: "text/html" },
  });
  const firstStaticBody = await firstStatic.text();
  const secondStatic = await request.get(`${baseURL}${queryIndependentPath}?utm=second`, {
    headers: { accept: "text/html" },
  });
  const staticStatusHeader = backend === "workers-cache" ? "cf-cache-status" : "x-vinext-cache";
  expect(firstStatic.headers()[staticStatusHeader], JSON.stringify(firstStatic.headers())).toBe(
    backend === "kv" ? "HIT" : "MISS",
  );
  expect(secondStatic.headers()[staticStatusHeader], JSON.stringify(secondStatic.headers())).toBe(
    "HIT",
  );
  expect(await secondStatic.text()).toBe(firstStaticBody);

  const rewriteSlug = `query-rewrite-${randomUUID()}`;
  const rewriteFirst = await request.get(`${baseURL}/query-rewrite/${rewriteSlug}?utm=first`);
  const rewriteFirstBody = await rewriteFirst.text();
  const rewriteSecond = await request.get(`${baseURL}/query-rewrite/${rewriteSlug}?utm=second`);
  expect(rewriteFirst.headers()[staticStatusHeader], JSON.stringify(rewriteFirst.headers())).toBe(
    "MISS",
  );
  expect(rewriteSecond.headers()[staticStatusHeader], JSON.stringify(rewriteSecond.headers())).toBe(
    "HIT",
  );
  expect(await rewriteSecond.text()).toBe(rewriteFirstBody);
  const rewriteDirect = await request.get(`${baseURL}/cached/${rewriteSlug}?utm=direct`);
  expect(rewriteDirect.headers()[staticStatusHeader], JSON.stringify(rewriteDirect.headers())).toBe(
    "MISS",
  );
  await rewriteDirect.dispose();

  // Ported from Next.js:
  // test/e2e/app-dir/searchparams-static-bailout/searchparams-static-bailout.test.ts
  const firstQueryDynamic = await request.get(`${baseURL}/query-dependent?q=alpha`);
  const repeatedQueryDynamic = await request.get(`${baseURL}/query-dependent?q=alpha`);
  const secondQueryDynamic = await request.get(`${baseURL}/query-dependent?q=beta`);
  const firstQueryDynamicBody = await firstQueryDynamic.text();
  const repeatedQueryDynamicBody = await repeatedQueryDynamic.text();
  const secondQueryDynamicBody = await secondQueryDynamic.text();
  expect(firstQueryDynamic.headers()[staticStatusHeader]).not.toBe("HIT");
  expect(repeatedQueryDynamic.headers()[staticStatusHeader]).not.toBe("HIT");
  expect(secondQueryDynamic.headers()[staticStatusHeader]).not.toBe("HIT");
  expect(firstQueryDynamicBody).toContain(
    '<output data-testid="query-dependent-value">alpha</output>',
  );
  expect(secondQueryDynamicBody).toContain(
    '<output data-testid="query-dependent-value">beta</output>',
  );
  expect(repeatedQueryDynamicBody).not.toBe(firstQueryDynamicBody);

  const staticRouteFirst = await request.get(
    `${baseURL}/api/query-independent?q=${randomUUID()}-first`,
  );
  const staticRouteBody = await staticRouteFirst.text();
  const staticRouteSecond = await request.get(
    `${baseURL}/api/query-independent?q=${randomUUID()}-second`,
  );
  expect(
    staticRouteSecond.headers()[staticStatusHeader],
    JSON.stringify(staticRouteSecond.headers()),
  ).toBe("HIT");
  expect(await staticRouteSecond.text()).toBe(staticRouteBody);
  expect(JSON.parse(staticRouteBody).query).toBeNull();

  if (backend !== "kv") {
    // `dynamic = "error"` makes request-data access fail, so sharing the
    // successfully static Route Handler by pathname matches Next.js.
    // https://github.com/vercel/next.js/blob/canary/test/e2e/app-dir/dynamic-data/dynamic-data.test.ts
    const staticErrorFirst = await request.get(
      `${baseURL}/api/query-independent-error?q=${randomUUID()}-first`,
    );
    const staticErrorBody = await staticErrorFirst.text();
    const staticErrorSecond = await request.get(
      `${baseURL}/api/query-independent-error?q=${randomUUID()}-second`,
    );
    expect(
      staticErrorSecond.headers()[staticStatusHeader],
      JSON.stringify(staticErrorSecond.headers()),
    ).toBe("HIT");
    expect(await staticErrorSecond.text()).toBe(staticErrorBody);

    // Next's inner Full Route cache uses `resolvedPathname` for successfully
    // static App pages and Route Handlers. Vinext intentionally keeps these
    // two outer-cache cases full-query keyed until it has proof before lookup;
    // that costs HITs but cannot replay query-dependent bytes across requests.
    // https://github.com/vercel/next.js/blob/canary/packages/next/src/build/templates/app-page-runtime.ts
    // https://github.com/vercel/next.js/blob/canary/packages/next/src/build/templates/app-route.ts
    for (const path of ["/api/query-independent-revalidate", "/query-independent-public"]) {
      const first = await request.get(`${baseURL}${path}?q=${randomUUID()}-first`);
      const firstBody = await first.text();
      const firstHit = await request.get(first.url());
      const second = await request.get(`${baseURL}${path}?q=${randomUUID()}-second`);
      const secondBody = await second.text();
      const secondHit = await request.get(second.url());
      expect(first.headers()[staticStatusHeader], JSON.stringify(first.headers())).toBe("MISS");
      expect(firstHit.headers()[staticStatusHeader], JSON.stringify(firstHit.headers())).toBe(
        "HIT",
      );
      expect(await firstHit.text()).toBe(firstBody);
      expect(second.headers()[staticStatusHeader], JSON.stringify(second.headers())).toBe("MISS");
      expect(secondHit.headers()[staticStatusHeader], JSON.stringify(secondHit.headers())).toBe(
        "HIT",
      );
      expect(await secondHit.text()).toBe(secondBody);
    }

    const queryA = `${randomUUID()}-a`;
    const queryB = `${randomUUID()}-b`;
    const firstA = await request.get(`${baseURL}/api/query-cache?q=${queryA}`);
    const hitA = await request.get(`${baseURL}/api/query-cache?q=${queryA}`);
    const firstB = await request.get(`${baseURL}/api/query-cache?q=${queryB}`);
    const hitB = await request.get(`${baseURL}/api/query-cache?q=${queryB}`);
    expect(firstA.headers()[staticStatusHeader], JSON.stringify(firstA.headers())).toBe("MISS");
    expect(hitA.headers()[staticStatusHeader], JSON.stringify(hitA.headers())).toBe("HIT");
    expect(firstB.headers()[staticStatusHeader], JSON.stringify(firstB.headers())).toBe("MISS");
    expect(hitB.headers()[staticStatusHeader], JSON.stringify(hitB.headers())).toBe("HIT");
    const firstAPayload = (await firstA.json()) as { query: string; renderId: string };
    const hitAPayload = (await hitA.json()) as { query: string; renderId: string };
    const firstBPayload = (await firstB.json()) as { query: string; renderId: string };
    const hitBPayload = (await hitB.json()) as { query: string; renderId: string };
    expect(firstAPayload.query).toBe(queryA);
    expect(hitAPayload).toEqual(firstAPayload);
    expect(firstBPayload.query).toBe(queryB);
    expect(hitBPayload).toEqual(firstBPayload);
    expect(firstBPayload.renderId).not.toBe(firstAPayload.renderId);

    for (const query of [`${randomUUID()}-unsafe-a`, `${randomUUID()}-unsafe-b`]) {
      const first = await request.get(`${baseURL}/api/query-dependent-revalidate?q=${query}`);
      const firstBody = await first.text();
      const hit = await request.get(`${baseURL}/api/query-dependent-revalidate?q=${query}`);
      expect(first.headers()[staticStatusHeader], JSON.stringify(first.headers())).toBe("MISS");
      expect(hit.headers()[staticStatusHeader], JSON.stringify(hit.headers())).toBe("HIT");
      expect(await hit.text()).toBe(firstBody);
      expect(JSON.parse(firstBody).query).toBe(query);
    }

    for (const query of ["page-a", "page-b"]) {
      const first = await request.get(`${baseURL}/query-dependent-public?q=${query}`);
      const firstBody = await first.text();
      const hit = await request.get(`${baseURL}/query-dependent-public?q=${query}`);
      expect(first.headers()[staticStatusHeader], JSON.stringify(first.headers())).toBe("MISS");
      expect(hit.headers()[staticStatusHeader], JSON.stringify(hit.headers())).toBe("HIT");
      expect(await hit.text()).toBe(firstBody);
      expect(firstBody).toContain(
        `<output data-testid="query-dependent-public-value">${query}</output>`,
      );
    }
  }

  const dynamicUrl = `${baseURL}/force-dynamic?cache-e2e=${randomUUID()}`;
  const firstDynamic = await request.get(dynamicUrl);
  const secondDynamic = await request.get(dynamicUrl);
  const firstDynamicHeaders = firstDynamic.headers();
  const secondDynamicHeaders = secondDynamic.headers();
  expect(firstDynamic.ok(), JSON.stringify(firstDynamicHeaders)).toBe(true);
  expect(secondDynamic.ok(), JSON.stringify(secondDynamicHeaders)).toBe(true);
  expect(firstDynamicHeaders["cache-control"]).toContain("no-store");
  expect(secondDynamicHeaders["cache-control"]).toContain("no-store");
  expect(firstDynamicHeaders["x-vinext-cache"]).not.toBe("HIT");
  expect(secondDynamicHeaders["x-vinext-cache"]).not.toBe("HIT");
  expect(firstDynamicHeaders["cf-cache-status"]).not.toBe("HIT");
  expect(secondDynamicHeaders["cf-cache-status"]).not.toBe("HIT");
  const renderId = /force-dynamic-render-id[^>]*>([^<]+)</.exec(await firstDynamic.text())?.[1];
  const nextRenderId = /force-dynamic-render-id[^>]*>([^<]+)</.exec(
    await secondDynamic.text(),
  )?.[1];
  expect(renderId).toBeTruthy();
  expect(nextRenderId).toBeTruthy();
  expect(nextRenderId).not.toBe(renderId);
});
