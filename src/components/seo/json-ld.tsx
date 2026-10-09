import { serialiseJsonLd, type JsonLd } from '@/domain/seo';
import { scriptNonce } from '@/lib/security/nonce';

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
export async function JsonLd({ nodes }: { nodes: readonly (JsonLd | null)[] }) {
  const present = nodes.filter((node): node is JsonLd => node !== null);

  if (present.length === 0) return null;

  /*
   * Nonced, even though this is a data block.
   *
   * A `<script type="application/ld+json">` is never executed, and browsers
   * differ on whether `script-src` governs it at all. Carrying the nonce costs
   * one attribute and removes the question — and the failure it removes is
   * silent: a blocked block does not break the page, it just stops the shop
   * appearing as a rich result.
   */
  return (
    <script
      type="application/ld+json"
      nonce={await scriptNonce()}
      dangerouslySetInnerHTML={{ __html: serialiseJsonLd(present) }}
    />
  );
}
