/**
 * Everything the browser runs only once the Public Suffix List is here,
 * loaded on demand by `hooks/use-link-anatomy.ts` as one import: tldts'
 * `parse`, and the logic that takes it as an argument (the link's anatomy
 * and look-alike check, "Expecting a particular site?"). Nothing that
 * needs these can run before `parse` exists, so they load with it, from
 * the same triggers, rather than with the page.
 */
export { parse } from "tldts";
export { compareExpectedSite } from "@/lib/domain/expected-site";
export {
  registrableDomainOf,
  splitLinkAnatomy,
} from "@/lib/domain/link-anatomy";
