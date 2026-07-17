import { isIP } from "node:net";

import type { WhoisData } from "@/lib/domain/types";
import { fetchWithTimeout } from "@/lib/server/http";
import { getErrorMessage, SignalSkipError } from "@/lib/server/signal-error";

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

export async function runWhoisSignal(url: string): Promise<WhoisData> {
  const hostname = new URL(url).hostname;

  if (isIP(hostname)) {
    throw new SignalSkipError(
      "Registration lookups are not applicable to literal IP targets.",
    );
  }

  const rdapUrl = `https://rdap.org/domain/${hostname}`;
  try {
    const response = await fetchWithTimeout(
      rdapUrl,
      {
        headers: {
          accept: "application/rdap+json, application/json",
        },
      },
      8_000,
    );

    if (!response.ok) {
      throw new Error(`RDAP lookup failed with status ${response.status}.`);
    }

    const payload = asRecord(await response.json());
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
      observations:
        registrar === null
          ? ["The RDAP response did not identify a registrar name."]
          : [],
    };
  } catch (error) {
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
        `Registration data was unavailable for this scan. ${getErrorMessage(
          error,
          "The RDAP lookup failed.",
        )}`,
      ],
    };
  }
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
