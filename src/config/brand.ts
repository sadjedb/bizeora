/**
 * Brand configuration.
 *
 * **Bizeora**, since Phase 14.8. It replaces STITCH, which was a placeholder
 * from the first line of the project (`DESIGN-SYSTEM.md` section 2) precisely
 * so that this day would cost one file. Changing the brand again means editing
 * this file and `src/styles/tokens.css` — nothing else. No component may
 * contain the brand name as a literal.
 *
 * From Phase 12, `brand.logoKey` in the settings table overrides `logo.src` at
 * runtime so the owner can change the logo without a deployment; the asset
 * named here remains the fallback when that setting is unset.
 */

export const brand = {
  /** Displayed name. Read from settings at runtime once Phase 12 exists. */
  name: 'Bizeora',

  /** Legal entity name, used in policy pages and invoices. */
  legalName: 'Bizeora',

  /**
   * One line, used as the default meta description and in the footer.
   *
   * French, because the shop's own language is (`PRODUCT.md`); the English
   * storefront takes its tagline from the dictionary instead. This string is
   * the site's `<title>` and its meta description, which is the first thing a
   * search result shows.
   */
  tagline: 'Vos idées, brodées.',

  description:
    'Broderie personnalisée sur le vêtement de votre choix, et une collection de pièces déjà brodées. Envoyez un logo, un prénom ou un dessin : nous le brodons dans notre atelier, à partir d’une seule pièce.',

  /**
   * What the workshop calls itself in English, under the mark.
   *
   * Not translated in the dictionaries: it is part of the logo the owner
   * supplied, and a strapline that changes language is a different brand.
   */
  strapline: 'Luxury Embroidery & Custom Designs',

  logo: {
    /**
     * The mark, as supplied.
     *
     * A 150 × 150 raster on a solid white ground, which is why it is shown on
     * a light chip rather than bare: on the dark palette a white square would
     * read as a missing image. A transparent SVG would let it sit directly on
     * the page, and is worth asking for before launch.
     */
    src: '/assets/brand/logo.png' as string | null,
    width: 150,
    height: 150,
    alt: 'Bizeora',
  },
} as const;

export type Brand = typeof brand;
