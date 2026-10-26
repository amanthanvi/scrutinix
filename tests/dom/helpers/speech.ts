/**
 * What assistive technology gets from a subtree, approximated from the DOM:
 * text outside `aria-hidden` and `hidden` subtrees. WebKit ignores
 * aria-hidden on a `display: contents` element (Tailwind's `contents`), so
 * Safari read what such a wrapper meant to hide: it hides nothing here.
 */
function isHidden(node: Element): boolean {
  return (
    (node.getAttribute("aria-hidden") === "true" &&
      !node.classList.contains("contents")) ||
    node.hasAttribute("hidden")
  );
}

/** The subtree's spoken text, as one string. */
export function spokenText(node: Node): string {
  if (node instanceof Element && isHidden(node)) return "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return Array.from(node.childNodes).map(spokenText).join("");
}

/**
 * The spoken text nodes of a subtree, each one string. Text split across
 * elements can become separate reading stops (an inline-block domain inside
 * a sentence did, in TalkBack and VoiceOver); a sentence in one text node
 * is always one.
 */
export function spokenTextNodes(node: Node): string[] {
  if (node instanceof Element && isHidden(node)) return [];
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.trim() ? [node.textContent] : [];
  }
  return Array.from(node.childNodes).flatMap(spokenTextNodes);
}

/** What a sighted reader sees: text outside `.sr-only` and `hidden`. */
export function visibleText(node: Node): string {
  if (
    node instanceof Element &&
    (node.classList.contains("sr-only") || node.hasAttribute("hidden"))
  ) {
    return "";
  }
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return Array.from(node.childNodes).map(visibleText).join("");
}
