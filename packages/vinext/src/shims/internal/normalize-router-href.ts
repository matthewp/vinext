/**
 * Warn about and normalize repeated path separators like Next.js `resolveHref`.
 * The protocol separator is preserved and query strings are left untouched.
 *
 * Ported from Next.js: packages/next/src/client/resolve-href.ts
 * https://github.com/vercel/next.js/blob/canary/packages/next/src/client/resolve-href.ts
 */
export function normalizeRouterHref(href: string, routePathname: string): string {
  const protocol = href.match(/^[a-z][a-z0-9+.-]*:\/\//i)?.[0] ?? "";
  const withoutProtocol = protocol ? href.slice(protocol.length) : href;
  if (!/(\/\/|\\)/.test(withoutProtocol.split("?", 1)[0] ?? "")) return href;

  console.error(
    `Invalid href '${href}' passed to next/router in page: '${routePathname}'. Repeated forward-slashes (//) or backslashes \\ are not valid in the href.`,
  );

  const [pathname, ...query] = withoutProtocol.split("?");
  const normalizedPathname = pathname.replace(/\\/g, "/").replace(/\/\/+/g, "/");
  return protocol + normalizedPathname + (query[0] ? `?${query.join("?")}` : "");
}
