import { isIP } from "node:net";

import { PublicError } from "@/lib/domain/public-error";
import { getRegistrableDomain } from "@/lib/domain/registrable-domain";
import { isSharedPlatformHost } from "@/lib/domain/shared-platforms";
import type { WhoisData } from "@/lib/domain/types";
import { bareHostname } from "@/lib/domain/url";
import {
  fetchWithTimeout,
  SCRUTINIX_USER_AGENT,
  withTimeout,
} from "@/lib/server/http";
import { SignalSkipError } from "@/lib/server/signal-error";

/* RdapEvent interface removed — RDAP fields are now validated at runtime via asRecord(). */

interface RdapEntity {
  roles?: string[];
  vcardArray?: unknown[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export async function runWhoisSignal(
  url: string,
  signal?: AbortSignal,
): Promise<WhoisData> {
  const hostname = bareHostname(url);

  if (isIP(hostname)) {
    throw new SignalSkipError(
      "Registration lookups are not applicable to literal IP targets.",
    );
  }

  // Registries answer only for the registered domain: www.wikipedia.org is a
  // 400 and www.github.com a 404. Private-suffix tenants (safe.github.io)
  // stay distinct so they never inherit the platform's registration age.
  const domain = getRegistrableDomain(hostname);
  const rdapUrl = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  // A deeper subdomain may be a tenant the PSL does not know about; its
  // parent's registration history must not vouch for it.
  const host = hostname.replace(/\.$/, "");
  const subdomainOf =
    host !== domain && host !== `www.${domain}` ? domain : undefined;
  const sharedPlatform = isSharedPlatformHost(host);
  const response = await fetchWithTimeout(
    rdapUrl,
    {
      signal,
      headers: {
        accept: "application/rdap+json, application/json",
        "user-agent": SCRUTINIX_USER_AGENT,
      },
    },
    8_000,
  );

  // 404/422 are real answers, reported as an unavailable-but-successful
  // lookup. Network failures and server errors propagate as signal errors
  // instead of being laundered into success - otherwise a degraded result
  // gets cached and partialFailure stays false.
  if (response.status === 404 || response.status === 422) {
    // rdap.org redirects to the registry for every TLD with an RDAP
    // service. A 404 it answers itself, unredirected, means the TLD has
    // none (.be): that is not the domain lacking a record.
    if (!response.redirected && (await isMissingRdapService(response))) {
      const tld = domain.split(".").at(-1) ?? domain;
      return createUnavailableWhoisData(
        rdapUrl,
        `The .${tld} registry doesn't publish registration data over RDAP, so we couldn't look this domain up.`,
        { prefixed: false },
      );
    }
    return createUnavailableWhoisData(
      rdapUrl,
      "The registry has no RDAP record for this domain.",
    );
  }

  if (!response.ok) {
    throw new PublicError(
      "lookup_failed",
      `RDAP lookup failed with status ${response.status}.`,
    );
  }

  let payload: Record<string, unknown> | null;
  try {
    payload = asRecord(await response.json());
  } catch (error) {
    throw new PublicError(
      "lookup_failed",
      "The RDAP response could not be parsed.",
      { cause: error },
    );
  }

  const events = Array.isArray(payload?.events) ? payload.events : [];
  const entities = Array.isArray(payload?.entities) ? payload.entities : [];
  const links = Array.isArray(payload?.links) ? payload.links : [];
  const registrationDate = getEventDate(events, "registration");
  const updatedAt = getEventDate(events, "last changed");
  const expiresAt = getEventDate(events, "expiration");
  const registrarEntity = entities.find((entity) => {
    const record = asRecord(entity);
    return Array.isArray(record?.roles) && record.roles.includes("registrar");
  });
  const registrar = readVcardField(
    readEntity(registrarEntity)?.vcardArray,
    "fn",
  );
  const ageDays = registrationDate
    ? Math.round(
        (Date.now() - new Date(registrationDate).getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : null;

  return {
    subjectType: "domain",
    available: true,
    registrar,
    registeredAt: registrationDate,
    updatedAt,
    expiresAt,
    ageDays,
    country: typeof payload?.country === "string" ? payload.country : null,
    handle: typeof payload?.handle === "string" ? payload.handle : null,
    rdapUrl: readHref(links[0]) ?? rdapUrl,
    ...(subdomainOf ? { subdomainOf } : {}),
    ...(sharedPlatform ? { sharedPlatform } : {}),
    observations: [
      ...(registrar === null
        ? ["The RDAP response did not identify a registrar name."]
        : []),
      ...(sharedPlatform
        ? [
            `${host} is a shared platform; its registration describes the platform, not whoever published this content.`,
          ]
        : subdomainOf
          ? [
              `Registration data describes the parent domain ${subdomainOf}, not this subdomain.`,
            ]
          : []),
    ],
  };
}

/**
 * rdap.org's own answer for a TLD with no RDAP service. `fetchWithTimeout`
 * stops timing once headers arrive, so the body read has its own bound; a
 * body that stalls, errors, or isn't that answer leaves the 404 what its
 * status says, no record.
 */
async function isMissingRdapService(response: Response): Promise<boolean> {
  try {
    const title = asRecord(
      await withTimeout(response.json(), 2_000, "RDAP error body"),
    )?.title;
    return typeof title === "string" && /no rdap service/i.test(title);
  } catch {
    void response.body?.cancel().catch(() => {});
    return false;
  }
}

function createUnavailableWhoisData(
  rdapUrl: string,
  reason: string,
  { prefixed = true }: { prefixed?: boolean } = {},
): WhoisData {
  return {
    subjectType: "domain",
    available: false,
    registrar: null,
    registeredAt: null,
    updatedAt: null,
    expiresAt: null,
    ageDays: null,
    country: null,
    handle: null,
    rdapUrl,
    observations: [
      prefixed
        ? `Registration data was unavailable for this scan. ${reason}`
        : reason,
    ],
  };
}

function getEventDate(events: unknown[], action: string) {
  const event = events.find((item) => {
    const record = asRecord(item);
    return (
      typeof record?.eventAction === "string" &&
      record.eventAction.toLowerCase() === action
    );
  });
  const record = asRecord(event);
  return typeof record?.eventDate === "string" ? record.eventDate : null;
}

function readVcardField(vcardArray: unknown[] | undefined, name: string) {
  if (!Array.isArray(vcardArray) || !Array.isArray(vcardArray[1])) {
    return null;
  }

  const entries = vcardArray[1];
  const record = entries.find(
    (entry): entry is [string, unknown, unknown, string] =>
      Array.isArray(entry) && entry[0] === name,
  );

  return record?.[3] ?? null;
}

function readHref(value: unknown) {
  const record = asRecord(value);
  return typeof record?.href === "string" ? record.href : null;
}

function readEntity(value: unknown): RdapEntity | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    roles: Array.isArray(record.roles)
      ? record.roles.filter((role): role is string => typeof role === "string")
      : undefined,
    vcardArray: Array.isArray(record.vcardArray)
      ? record.vcardArray
      : undefined,
  };
}
