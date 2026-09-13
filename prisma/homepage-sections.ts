import { HomepageSectionType, type Prisma } from '../src/generated/prisma/client';

/**
 * The bands the front page is made of.
 *
 * In their own module rather than inside `seed.ts` because the seed's entry
 * point runs on import: anything that wants to read this list — a migration
 * script, a test, a content tool — would otherwise re-seed the whole database
 * by asking.
 *
 * ## Two languages, in one row
 *
 * The homepage is data (ADR-027) and its rows have one column per field, not
 * one per language. Each band therefore carries its English copy inside its own
 * `config`, under an `en` key, and `domain/content`'s `localiseSection` merges
 * that over the French when the page is rendered in English. A band that says
 * nothing in English keeps the French, which reads better than a gap.
 */

export type SeedSection = {
  type: HomepageSectionType;
  position: number;
  isEnabled: boolean;
  title?: string;
  subtitle?: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
  config?: Prisma.InputJsonValue;
};

export const HOMEPAGE_SECTIONS: readonly SeedSection[] = [
  {
    type: HomepageSectionType.BANNER,
    position: 1,
    isEnabled: true,
  },
  {
    type: HomepageSectionType.HERO,
    position: 2,
    isEnabled: true,
    title: 'Vos idées, brodées.',
    body: 'Envoyez un logo, un prénom ou un dessin : nous le brodons sur le vêtement de votre choix. Ou choisissez une pièce déjà brodée dans la boutique.',
    ctaLabel: 'Créer ma broderie',
    ctaHref: '/custom',
    config: {
      eyebrow: 'Atelier de broderie · Algérie',
      note: 'Devis sous 6 heures ouvrées · à partir d’une seule pièce',
      secondaryCtaLabel: 'Voir la boutique',
      secondaryCtaHref: '/shop',
      // A storage key, resolved by `lib/media` — never a URL. Replacing the
      // hero is replacing the file this key names; see public/assets/README.md.
      imageKey: 'site/hero.jpg',
      // Decorative: the headline beside it carries the meaning, so announcing
      // the picture would only repeat it (DESIGN-SYSTEM.md section 14).
      imageAlt: '',
      en: {
        title: 'Your idea, embroidered.',
        body: 'Send us a logo, a name or a drawing: we embroider it on the garment you choose. Or pick a piece we have already embroidered from the shop.',
        ctaLabel: 'Start my embroidery',
        eyebrow: 'Embroidery workshop · Algeria',
        note: 'Quoted within 6 working hours · from a single piece',
        secondaryCtaLabel: 'See the shop',
      },
    },
  },
  {
    type: HomepageSectionType.HOW_IT_WORKS,
    position: 3,
    isEnabled: true,
    title: 'Quatre étapes, et vous savez ce que ça coûte.',
    body: 'Pas de « contactez-nous pour un prix ». Le montant s’affiche pendant que vous configurez, et vous partez avec un chiffre.',
    config: {
      eyebrow: 'Sur mesure',
      points: [
        {
          icon: 'shirt',
          title: 'Choisissez le vêtement',
          body: 'T-shirt, sweat, polo, casquette ou tote bag. Le même catalogue sert la boutique et le sur-mesure.',
        },
        {
          icon: 'ruler',
          title: 'Choisissez l’emplacement',
          body: 'Poitrine, dos, manche ou revers. Chaque emplacement a ses limites de taille, indiquées à l’écran.',
        },
        {
          icon: 'upload',
          title: 'Envoyez votre design',
          body: 'Un logo, une photo, un prénom ou une idée écrite. Les formats vectoriels donnent le meilleur rendu.',
        },
        {
          icon: 'sparkles',
          title: 'Recevez le prix',
          body: 'Prix immédiat pour les configurations simples, devis chiffré sous 6 heures ouvrées pour les autres.',
        },
      ],
      en: {
        title: 'Four steps, and you know what it costs.',
        body: 'No "contact us for a price". The amount appears while you configure, and you leave with a figure.',
        eyebrow: 'Made to order',
        points: [
          {
            icon: 'shirt',
            title: 'Choose the garment',
            body: 'T-shirt, sweatshirt, polo, cap or tote bag. One catalogue serves both the shop and the made-to-order side.',
          },
          {
            icon: 'ruler',
            title: 'Choose the placement',
            body: 'Chest, back, sleeve or lapel. Each placement has its own size limits, shown on screen.',
          },
          {
            icon: 'upload',
            title: 'Send your design',
            body: 'A logo, a photo, a name or an idea in writing. Vector files give the best result.',
          },
          {
            icon: 'sparkles',
            title: 'Get the price',
            body: 'An immediate price for simple configurations, a priced quote within 6 working hours for the rest.',
          },
        ],
      },
    },
  },
  {
    // Seeded **disabled**, and deliberately: a category card leads to
    // `/shop/c/[category]`, which is Phase 6's unfinished category route. The
    // band is implemented and tested; it is switched on the day its
    // destination exists, which is an UPDATE rather than a deploy. A link to a
    // page that does not exist is a 404 dressed up as an affordance.
    type: HomepageSectionType.CATEGORY_GRID,
    position: 4,
    isEnabled: false,
    title: 'Par type de pièce',
    ctaLabel: 'Tout voir',
    ctaHref: '/shop',
    config: {
      eyebrow: 'Le catalogue',
      limit: 4,
      en: {
        title: 'By kind of piece',
        ctaLabel: 'See everything',
        eyebrow: 'The catalogue',
      },
    },
  },
  {
    type: HomepageSectionType.FEATURED_PRODUCTS,
    position: 5,
    isEnabled: true,
    title: 'Pièces prêtes à porter',
    ctaLabel: 'Tout voir',
    ctaHref: '/shop',
    config: {
      eyebrow: 'La boutique',
      limit: 4,
      en: {
        title: 'Ready-to-wear pieces',
        ctaLabel: 'See everything',
        eyebrow: 'The shop',
      },
    },
  },
  {
    type: HomepageSectionType.GALLERY,
    position: 6,
    isEnabled: true,
    title: 'Ce que nous avons brodé',
    body: 'Des pièces réalisées à l’atelier, pour des entreprises, des clubs et des familles.',
    ctaLabel: 'Voir tout notre travail',
    ctaHref: '/gallery',
    config: {
      eyebrow: 'Notre travail',
      limit: 4,
      en: {
        title: 'What we have embroidered',
        body: 'Pieces made in the workshop, for companies, clubs and families.',
        ctaLabel: 'See all our work',
        eyebrow: 'Our work',
      },
    },
  },
  {
    type: HomepageSectionType.WHY_US,
    position: 7,
    isEnabled: true,
    title: 'Le fil fait la différence.',
    body: 'Chaque pièce est brodée sur machine industrielle après numérisation du motif — une étape que nous faisons nous-mêmes, parce qu’un fichier mal numérisé se voit sur le vêtement fini.',
    config: {
      eyebrow: 'L’atelier',
      showDelivery: true,
      points: [
        {
          title: 'Brodé, pas imprimé',
          body: 'Le fil traverse le tissu. Une broderie ne s’écaille pas au lavage et ne se fissure pas au repassage, contrairement au flocage.',
        },
        {
          title: 'À partir d’une pièce',
          body: 'Une seule casquette pour vous, ou cinquante polos pour une équipe. Le tarif dégressif s’applique automatiquement.',
        },
        {
          title: 'Vous voyez le prix avant',
          body: 'Le configurateur affiche une estimation à chaque étape. Aucune commande ne part sans que le montant soit accepté.',
        },
      ],
      en: {
        title: 'The thread is the difference.',
        body: 'Every piece is embroidered on an industrial machine after the design has been digitised — a step we do ourselves, because a badly digitised file shows on the finished garment.',
        eyebrow: 'The workshop',
        points: [
          {
            title: 'Embroidered, not printed',
            body: 'The thread goes through the fabric. Embroidery does not flake in the wash or crack under an iron, the way a print does.',
          },
          {
            title: 'From a single piece',
            body: 'One cap for yourself, or fifty polos for a team. The quantity discount applies on its own.',
          },
          {
            title: 'You see the price first',
            body: 'The builder shows an estimate at every step. No order leaves without the amount being accepted.',
          },
        ],
      },
    },
  },
  {
    type: HomepageSectionType.REVIEWS,
    position: 8,
    isEnabled: true,
    title: 'Ce qu’en disent nos clients',
    config: {
      eyebrow: 'Avis vérifiés',
      limit: 3,
      en: { title: 'What our customers say', eyebrow: 'Verified reviews' },
    },
  },
  {
    type: HomepageSectionType.CUSTOM_CTA,
    position: 9,
    isEnabled: true,
    title: 'Une commande pour votre équipe ?',
    body: 'Envoyez-nous votre logo et le nombre de pièces. Vous recevez un devis chiffré, ligne par ligne, sous 6 heures ouvrées.',
    ctaLabel: 'Demander un devis',
    ctaHref: '/custom',
    config: {
      eyebrow: 'Entreprises et clubs',
      en: {
        title: 'An order for your team?',
        body: 'Send us your logo and the number of pieces. You get a quote, priced line by line, within 6 working hours.',
        ctaLabel: 'Ask for a quote',
        eyebrow: 'Companies and clubs',
      },
    },
  },
  {
    type: HomepageSectionType.SOCIAL,
    position: 10,
    isEnabled: true,
    title: 'Nous suivre',
    config: {
      eyebrow: 'L’atelier au quotidien',
      en: { title: 'Follow us', eyebrow: 'The workshop, day to day' },
    },
  },
  {
    type: HomepageSectionType.FINAL_CTA,
    position: 11,
    isEnabled: true,
    title: 'Envoyez-nous votre idée.',
    body: 'Un logo d’entreprise, le prénom d’un enfant, un dessin fait à la main. Si cela tient sur du tissu, cela se brode.',
    ctaLabel: 'Créer ma broderie',
    ctaHref: '/custom',
    config: {
      eyebrow: 'Prêt à commencer ?',
      en: {
        title: 'Send us your idea.',
        body: 'A company logo, a child’s name, a drawing made by hand. If it fits on fabric, it can be embroidered.',
        ctaLabel: 'Start my embroidery',
        eyebrow: 'Ready to start?',
      },
    },
  },
];
