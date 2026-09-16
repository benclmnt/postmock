import { apiError } from "../../errors.ts";
import type { State } from "../../state/store.ts";
import type { Domain } from "../../state/types.ts";
import {
  authenticationJson,
  isHostname,
  isSubdomainOf,
  newAuthentication,
} from "./authentication.ts";
import { pathId } from "./paging.ts";

// Domains API (docs/06 §4.3; refs/api_domains-api.md).

/** A new domain; Name and Return-Path are checked by the caller. */
export const newDomain = (id: number, name: string, returnPath: string, now: Date): Domain => ({
  ID: id,
  Name: name,
  ...newAuthentication(name, returnPath, now),
});

/** 510 for an unknown or non-numeric ID. */
export function findDomain(state: State, id: string): Domain {
  const domain = state.domains.get(pathId(id) ?? -1);
  if (domain === undefined) throw apiError(510);
  return domain;
}

/** Name checks in the order of the ErrorCodes 514, 515, 516, 512 (refs/api_overview.md:172-176). */
export function checkDomainName(state: State, name: string | undefined): string {
  if (name === undefined) throw apiError(514);
  if (name.length > 255) throw apiError(515);
  if (!isHostname(name)) throw apiError(516);
  const taken = [...state.domains.values()].some(
    (d) => d.Name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) throw apiError(512);
  return name;
}

/** ErrorCode 522; the message is INFERRED (a summary row). */
export function checkReturnPath(returnPath: string, domain: string): string {
  if (returnPath !== "" && !isSubdomainOf(returnPath, domain)) {
    throw apiError(522, {
      message: `The 'ReturnPathDomain' must be a subdomain of '${domain}'.`,
    });
  }
  return returnPath;
}

// refs/api_domains-api.md:107-124.
export const domainJson = (d: Domain) => ({ Name: d.Name, ...authenticationJson(d), ID: d.ID });

// refs/api_domains-api.md:43-48.
export const domainListItemJson = (d: Domain) => ({
  Name: d.Name,
  SPFVerified: d.SPFVerified,
  DKIMVerified: d.DKIMVerified,
  WeakDKIM: d.WeakDKIM,
  ReturnPathDomainVerified: d.ReturnPathDomainVerified,
  ID: d.ID,
});

// refs/api_domains-api.md:611-622.
export const domainDkimJson = (d: Domain) => ({
  Name: d.Name,
  DKIMVerified: d.DKIMVerified,
  WeakDKIM: d.WeakDKIM,
  DKIMHost: d.DKIMHost,
  DKIMTextValue: d.DKIMTextValue,
  DKIMPendingHost: d.DKIMPendingHost,
  DKIMPendingTextValue: d.DKIMPendingTextValue,
  DKIMRevokedHost: d.DKIMRevokedHost,
  DKIMRevokedTextValue: d.DKIMRevokedTextValue,
  SafeToRemoveRevokedKeyFromDNS: d.SafeToRemoveRevokedKeyFromDNS,
  DKIMUpdateStatus: d.DKIMUpdateStatus,
  ID: d.ID,
});

// refs/api_domains-api.md:564-566.
export const domainSpfJson = (d: Domain) => ({
  SPFHost: d.SPFHost,
  SPFVerified: d.SPFVerified,
  SPFTextValue: d.SPFTextValue,
});
