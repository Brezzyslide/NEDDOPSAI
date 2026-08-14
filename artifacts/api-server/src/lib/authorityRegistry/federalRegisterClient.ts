import { lookupAuthorityById } from "./index.js";

export interface FederalRegisterTitle {
  id: string;
  name: string;
  collection: string;
  status: string;
  isInForce: boolean;
  makingDate: string | null;
  asMadeRegisteredAt: string | null;
  sourceUrl: string;
  currentness: "CURRENT" | "HISTORICAL" | "UNKNOWN";
}

interface FederalRegisterTitleResponse {
  value?: Array<{
    id?: string;
    name?: string;
    collection?: string;
    status?: string;
    isInForce?: boolean;
    makingDate?: string | null;
    asMadeRegisteredAt?: string | null;
  }>;
}

export interface FederalRegisterSearchOptions {
  search: string;
  pageSize?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Minimal verified integration for the public Federal Register API.
 *
 * Verified live during Sprint 33I against:
 *   https://api.prod.legislation.gov.au/v1/titles?search=privacy&pageSize=1
 *
 * This intentionally supports title search metadata only. It does not pretend
 * to retrieve full legislation text or historical compilations until those
 * endpoints are separately verified.
 */
export async function searchFederalRegisterTitles(
  options: FederalRegisterSearchOptions,
): Promise<FederalRegisterTitle[]> {
  const authority = lookupAuthorityById("ar-au-001");
  const baseUrl = authority?.apiBaseUrl;
  if (!baseUrl) {
    throw new Error("FEDERAL_REGISTER_API_NOT_CONFIGURED");
  }

  const pageSize = Math.max(1, Math.min(options.pageSize ?? 5, 20));
  const url = new URL(`${baseUrl}/titles`);
  url.searchParams.set("search", options.search);
  url.searchParams.set("pageSize", String(pageSize));

  const fetcher = options.fetchImpl ?? fetch;
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`FEDERAL_REGISTER_API_UNAVAILABLE:${response.status}`);
  }

  const body = await response.json() as FederalRegisterTitleResponse;
  return (body.value ?? []).flatMap(item => {
    if (!item.id || !item.name) return [];
    return [{
      id:                 item.id,
      name:               item.name,
      collection:         item.collection ?? "unknown",
      status:             item.status ?? "unknown",
      isInForce:          item.isInForce === true,
      makingDate:         item.makingDate ?? null,
      asMadeRegisteredAt: item.asMadeRegisteredAt ?? null,
      sourceUrl:          `https://www.legislation.gov.au/${item.id}`,
      currentness:        item.isInForce === true ? "CURRENT" : item.status ? "HISTORICAL" : "UNKNOWN",
    }];
  });
}
