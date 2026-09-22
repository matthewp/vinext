type ResponseStageCacheIdentity = {
  props: unknown;
  requestUrl: string;
};

function stripUrlQuery(value: string): string {
  try {
    const absolute = new URL(value);
    absolute.search = "";
    return absolute.toString();
  } catch {
    try {
      const relative = new URL(value, "http://vinext.invalid");
      relative.search = "";
      return relative.pathname + relative.hash;
    } catch {
      return value;
    }
  }
}

/**
 * Collapse query strings only for framework page artifacts protected by
 * completed-response cache admission. App pages that observe `searchParams`
 * are made private before storage; Pages static data cannot observe arbitrary
 * request queries in the first place.
 */
export function responseStageCacheIdentity(
  requestUrl: string,
  props: unknown,
): ResponseStageCacheIdentity {
  if (!props || typeof props !== "object") return { props, requestUrl };
  const record = props as Record<string, unknown>;
  const cacheability = record.cacheability;
  const policyHeaders =
    cacheability && typeof cacheability === "object"
      ? Reflect.get(cacheability, "policyHeaders")
      : undefined;
  const ignoresQuery =
    (record.kind === "app-page" &&
      record.forceDynamic !== true &&
      policyHeaders === null &&
      typeof record.resolvedUrl === "string") ||
    (record.kind === "pages-page" &&
      record.stagedHeaders === null &&
      typeof record.resolvedUrl === "string") ||
    (record.kind === "hybrid-pages" &&
      record.resourceKind === "page" &&
      record.preHandlerHeaders === null &&
      typeof record.requestUrl === "string" &&
      typeof record.resolvedUrl === "string");
  if (!ignoresQuery) return { props, requestUrl };

  const canonicalProps: Record<string, unknown> = { ...record };
  if (typeof record.resolvedUrl === "string") {
    canonicalProps.resolvedUrl = stripUrlQuery(record.resolvedUrl);
  }
  if (record.kind === "hybrid-pages" && typeof record.requestUrl === "string") {
    canonicalProps.requestUrl = stripUrlQuery(record.requestUrl);
  }
  if (
    record.kind === "pages-page" &&
    record.renderOptions &&
    typeof record.renderOptions === "object" &&
    typeof Reflect.get(record.renderOptions, "originalUrl") === "string"
  ) {
    canonicalProps.renderOptions = {
      ...(record.renderOptions as Record<string, unknown>),
      originalUrl: stripUrlQuery(Reflect.get(record.renderOptions, "originalUrl") as string),
    };
  }
  return { props: canonicalProps, requestUrl: stripUrlQuery(requestUrl) };
}
