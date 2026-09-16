import { randomBytes } from "node:crypto";
import { apiError } from "../../errors.ts";
import type { Domain } from "../../state/types.ts";

/** The SPF, DKIM and Return-Path fields that domains and sender signatures share. */
export type Authentication = Omit<Domain, "ID" | "Name">;

// refs/api_domains-api.md:226-246: a new domain has only a pending DKIM key.
export function newAuthentication(domain: string, returnPath: string, now: Date): Authentication {
  return {
    SPFVerified: false,
    SPFHost: domain,
    SPFTextValue: "v=spf1 a mx include:spf.mtasv.net ~all",
    DKIMVerified: false,
    WeakDKIM: false,
    DKIMHost: "",
    DKIMTextValue: "",
    ...pendingKey(domain, now),
    DKIMRevokedHost: "",
    DKIMRevokedTextValue: "",
    SafeToRemoveRevokedKeyFromDNS: false,
    ReturnPathDomain: returnPath,
    ReturnPathDomainVerified: false,
    ReturnPathDomainCNAMEValue: "pm.mtasv.net",
  };
}

// Host shape `20131031155228pm._domainkey.<domain>` (refs/api_domains-api.md:235); the key is random.
const pendingKey = (domain: string, now: Date) => ({
  DKIMPendingHost: `${now.toISOString().replace(/\D/g, "").slice(0, 14)}pm._domainkey.${domain}`,
  DKIMPendingTextValue: `k=rsa; p=${randomBytes(162).toString("base64")}`,
  DKIMUpdateStatus: "Pending" as const,
});

/**
 * A key still pending answers 505: the gem live test renews the key of a new domain and a new
 * signature and expects it (sdk/postmark-gem/spec/integration/account_api_client_spec.rb:39-41, :76-78).
 */
export function refuseWhileRenewing(auth: Authentication): void {
  if (auth.DKIMUpdateStatus === "Pending") throw apiError(505);
}

/** Starts a new DKIM key. */
export function rotateDkim(auth: Authentication, domain: string, now: Date): void {
  refuseWhileRenewing(auth);
  Object.assign(auth, pendingKey(domain, now));
}

/** Postmark found the pending DKIM key in DNS: it becomes the active key. */
export function confirmDkim(auth: Authentication): void {
  if (auth.DKIMUpdateStatus !== "Pending") throw new Error("no pending DKIM key");
  if (auth.DKIMHost !== "") {
    auth.DKIMRevokedHost = auth.DKIMHost;
    auth.DKIMRevokedTextValue = auth.DKIMTextValue;
    auth.SafeToRemoveRevokedKeyFromDNS = true;
  }
  auth.DKIMHost = auth.DKIMPendingHost;
  auth.DKIMTextValue = auth.DKIMPendingTextValue;
  auth.DKIMPendingHost = "";
  auth.DKIMPendingTextValue = "";
  auth.DKIMVerified = true;
  auth.DKIMUpdateStatus = "Verified";
}

/** A new Return-Path needs its CNAME verified again; `""` clears it. */
export function setReturnPath(auth: Authentication, returnPath: string): void {
  if (returnPath === auth.ReturnPathDomain) return;
  auth.ReturnPathDomain = returnPath;
  auth.ReturnPathDomainVerified = false;
}

// SPF is no longer required (refs/api_domains-api.md:536). The gem live test expects `SPFVerified`
// true from a new domain and signature with no DNS (account_api_client_spec.rb:33, :73).
export function verifySpf(auth: Authentication): void {
  auth.SPFVerified = true;
}

/** The wire fields after the entity's own leading fields, in doc order (refs/api_domains-api.md:107-124). */
export const authenticationJson = (auth: Authentication) => ({
  SPFVerified: auth.SPFVerified,
  SPFHost: auth.SPFHost,
  SPFTextValue: auth.SPFTextValue,
  DKIMVerified: auth.DKIMVerified,
  WeakDKIM: auth.WeakDKIM,
  DKIMHost: auth.DKIMHost,
  DKIMTextValue: auth.DKIMTextValue,
  DKIMPendingHost: auth.DKIMPendingHost,
  DKIMPendingTextValue: auth.DKIMPendingTextValue,
  DKIMRevokedHost: auth.DKIMRevokedHost,
  DKIMRevokedTextValue: auth.DKIMRevokedTextValue,
  SafeToRemoveRevokedKeyFromDNS: auth.SafeToRemoveRevokedKeyFromDNS,
  DKIMUpdateStatus: auth.DKIMUpdateStatus,
  ReturnPathDomain: auth.ReturnPathDomain,
  ReturnPathDomainVerified: auth.ReturnPathDomainVerified,
  ReturnPathDomainCNAMEValue: auth.ReturnPathDomainCNAMEValue,
});

// A hostname with at least two labels (INFERRED; `thisisntadomain` is rejected by
// sdk/postmark-dotnet/src/Postmark.Tests/AdminClientDomainsTests.cs:67-82).
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/i;
export const isHostname = (value: string): boolean => HOSTNAME.test(value);

export const isEmail = (value: string): boolean => {
  const at = value.lastIndexOf("@");
  return at > 0 && !/\s/.test(value) && isHostname(value.slice(at + 1));
};

/** A Return-Path must be a subdomain of the domain (refs/api_domains-api.md:186). */
export const isSubdomainOf = (child: string, parent: string): boolean =>
  child.toLowerCase().endsWith(`.${parent.toLowerCase()}`) && isHostname(child);
