import { serialiseJsonLd, type JsonLd } from '@/domain/seo';

/**
 * A JSON-LD block.
 *
 * `dangerouslySetInnerHTML` is unavoidable here — a `<script type="application/
 * ld+json">` must contain raw JSON, and React would otherwise escape it into
 * something no parser accepts. What makes it safe is that the string comes from
 * `serialiseJsonLd`, which is `JSON.stringify` with `<` escaped, so a product
 * name containing `</script>` cannot close the element. The node itself is
 * built by `domain/seo` from values the page already renders; nothing a request
 * supplies reaches it.
 *
 * One element per page rather than one per node: search engines read every
 * block, and a single array keeps the markup readable.
 */
export function JsonLd({ nodes }: { nodes: readonly (JsonLd | null)[] }) {
  const present = nodes.filter((node): node is JsonLd => node !== null);

  if (present.length === 0) return null;

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serialiseJsonLd(present) }}
    />
  );
}
