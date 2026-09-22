type ResponseStageCacheIdentity = {
  props: unknown;
  queryRestore?: ResponseStageQueryRestore;
  requestUrl: string;
};

export type ResponseStageQueryRestore = {
  propsRequestSearch?: string;
  renderOptionsOriginalSearch?: string;
  requestSearch: string;
  resolvedSearch?: string;
};

function getUrlSearch(value: string): string {
  try {
    return new URL(value, "http://vinext.invalid").search;
  } catch {
    return "";
  }
}

function restoreUrlSearch(value: string, search: string): string {
  try {
    const absolute = new URL(value);
    absolute.search = search;
    return absolute.toString();
  } catch {
    try {
      const relative = new URL(value, "http://vinext.invalid");
      relative.search = search;
      return relative.pathname + relative.search + relative.hash;
    } catch {
      return value;
    }
  }
}

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
    (record.kind === "app-route-handler" &&
      record.queryIndependent === true &&
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
  const requestSearch = getUrlSearch(requestUrl);
  const resolvedSearch = getUrlSearch(record.resolvedUrl as string);
  return {
    props: canonicalProps,
    queryRestore: {
      ...(record.kind === "hybrid-pages" && typeof record.requestUrl === "string"
        ? {
            propsRequestSearch:
              getUrlSearch(record.requestUrl) === requestSearch
                ? undefined
                : getUrlSearch(record.requestUrl),
          }
        : {}),
      ...(record.kind === "pages-page" &&
      record.renderOptions &&
      typeof record.renderOptions === "object" &&
      typeof Reflect.get(record.renderOptions, "originalUrl") === "string"
        ? {
            renderOptionsOriginalSearch:
              getUrlSearch(Reflect.get(record.renderOptions, "originalUrl") as string) ===
              requestSearch
                ? undefined
                : getUrlSearch(Reflect.get(record.renderOptions, "originalUrl") as string),
          }
        : {}),
      requestSearch,
      ...(resolvedSearch === requestSearch ? {} : { resolvedSearch }),
    },
    requestUrl: stripUrlQuery(requestUrl),
  };
}

/** Restore the original query-bearing render inputs on a Workers Cache miss. */
export function restoreResponseStageCacheQuery(
  requestUrl: string,
  props: unknown,
  value: unknown,
): ResponseStageCacheIdentity | null {
  if (!value || typeof value !== "object") return null;
  const requestSearch = Reflect.get(value, "requestSearch");
  const resolvedSearch = Reflect.get(value, "resolvedSearch");
  const propsRequestSearch = Reflect.get(value, "propsRequestSearch");
  const renderOptionsOriginalSearch = Reflect.get(value, "renderOptionsOriginalSearch");
  if (
    typeof requestSearch !== "string" ||
    (resolvedSearch !== undefined && typeof resolvedSearch !== "string") ||
    (propsRequestSearch !== undefined && typeof propsRequestSearch !== "string") ||
    (renderOptionsOriginalSearch !== undefined &&
      typeof renderOptionsOriginalSearch !== "string") ||
    !props ||
    typeof props !== "object"
  ) {
    return null;
  }

  const record = props as Record<string, unknown>;
  if (typeof record.resolvedUrl !== "string") return null;
  const restoredProps: Record<string, unknown> = {
    ...record,
    resolvedUrl: restoreUrlSearch(record.resolvedUrl, resolvedSearch ?? requestSearch),
  };
  if (record.kind === "hybrid-pages" && typeof record.requestUrl === "string") {
    restoredProps.requestUrl = restoreUrlSearch(
      record.requestUrl,
      propsRequestSearch ?? requestSearch,
    );
  }
  if (
    record.kind === "pages-page" &&
    record.renderOptions &&
    typeof record.renderOptions === "object" &&
    typeof Reflect.get(record.renderOptions, "originalUrl") === "string"
  ) {
    restoredProps.renderOptions = {
      ...(record.renderOptions as Record<string, unknown>),
      originalUrl: restoreUrlSearch(
        Reflect.get(record.renderOptions, "originalUrl") as string,
        renderOptionsOriginalSearch ?? requestSearch,
      ),
    };
  }
  return { props: restoredProps, requestUrl: restoreUrlSearch(requestUrl, requestSearch) };
}
