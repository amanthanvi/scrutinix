/** Every string a card element tree draws, in order, components expanded. */
export function textOf(node: unknown): string[] {
  if (typeof node === "string" || typeof node === "number") {
    return [String(node)];
  }
  if (Array.isArray(node)) return node.flatMap(textOf);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as {
    type: unknown;
    props: { children?: unknown };
  };
  if (typeof element.type === "function") {
    return textOf((element.type as (props: unknown) => unknown)(element.props));
  }
  return textOf(element.props.children);
}
