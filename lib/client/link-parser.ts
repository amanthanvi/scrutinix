/**
 * Everything the browser runs only once the Public Suffix List is here,
 * in one chunk that `hooks/use-link-anatomy.ts` loads on demand: tldts'
 * `parse`, and the logic that takes it as an argument (the link's anatomy
 * and look-alike check, "Expecting a particular site?"). Nothing that
 * needs these can run before `parse` exists, so loading them with it
 * changes no timing.
 */
export { parse } from "tldts";
export { compareExpectedSite } from "@/lib/domain/expected-site";
export {
  registrableDomainOf,
  splitLinkAnatomy,
} from "@/lib/domain/link-anatomy";
