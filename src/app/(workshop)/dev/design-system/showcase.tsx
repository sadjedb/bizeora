'use client';

import { Inbox, Package, Search, Settings, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Container, Grid, Inline, Section, Stack } from '@/components/layout/layout';
import { Header } from '@/components/layout/header';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { FormField } from '@/components/ui/field';
import {
  Alert,
  Badge,
  Divider,
  EmptyState,
  ProgressBar,
  Skeleton,
} from '@/components/ui/feedback';
import {
  CheckboxField,
  Input,
  RadioField,
  SelectField,
  SwitchField,
  Textarea,
} from '@/components/ui/input';
import { Link } from '@/components/ui/link';
import { Breadcrumbs, Pagination, TabSet } from '@/components/ui/navigation';
import {
  InfoTooltip,
  Menu,
  Modal,
  ModalClose,
  PopoverPanel,
  Sheet,
  TooltipProvider,
} from '@/components/ui/overlay';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { Heading, Overline, Text, type TextVariant } from '@/components/ui/typography';
import { Price } from '@/components/commerce/price';
import { ProductCard, ProductCardSkeleton } from '@/components/commerce/product-card';
import { QuantitySelector } from '@/components/commerce/quantity-selector';
import {
  ORDER_STATUS_TONES,
  OrderStatusBadge,
  QUOTE_STATUS_TONES,
  QuoteStatusBadge,
  REQUEST_STATUS_TONES,
  RequestStatusBadge,
  type OrderStatus,
  type QuoteStatus,
  type RequestStatus,
} from '@/components/commerce/status';
import { MediaSkeleton, ProductImage } from '@/components/media/product-image';
import {
  FileCard,
  UploadDropzone,
  type UploadState,
} from '@/components/upload/upload-dropzone';

/**
 * Every component in every state, on one page.
 *
 * The point is validation, not documentation: a state that is hard to reach in
 * the real application is trivial to compare here, and a regression in focus
 * treatment or spacing shows up as a visible difference across a whole column.
 *
 * Everything on this page is a literal. No fetch, no database, no auth.
 */

const NAV_ITEMS = [
  { label: 'Boutique', href: '/boutique' },
  { label: 'Broderie personnalisée', href: '/personnaliser', accent: true },
  { label: 'Galerie', href: '/galerie' },
  { label: 'À propos', href: '/a-propos' },
];

export function DesignSystemShowcase() {
  return (
    <TooltipProvider>
      <ToastProvider>
        <Header items={NAV_ITEMS} currentPath="/boutique" cartCount={3} />

        <main id="main">
          <Container>
            <Section spacing="compact">
              <Stack gap={2}>
                <Overline>Développement</Overline>
                <Heading level={1} variant="display-lg">
                  Design system
                </Heading>
                <Text variant="body-lg" tone="muted" className="max-w-prose">
                  Chaque primitive dans chaque état. Cette page n&apos;existe pas en
                  production.
                </Text>
              </Stack>
            </Section>

            <ColourSection />
            <TypographySection />
            <ButtonSection />
            <FormSection />
            <FeedbackSection />
            <SurfaceSection />
            <NavigationSection />
            <StatusSection />
            <CommerceSection />
            <MediaSection />
            <UploadSection />
          </Container>
        </main>
      </ToastProvider>
    </TooltipProvider>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Section spacing="compact">
      <Stack gap={6}>
        <div>
          <Heading level={2} variant="heading-lg">
            {title}
          </Heading>
          <Divider className="mt-3" />
        </div>
        {children}
      </Stack>
    </Section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack gap={3}>
      <Overline as="span">{label}</Overline>
      <Inline gap={3}>{children}</Inline>
    </Stack>
  );
}

/* ------------------------------------------------------------------ colour */

const SEMANTIC_SWATCHES = [
  { name: 'bg', className: 'bg-bg' },
  { name: 'bg-subtle', className: 'bg-bg-subtle' },
  { name: 'surface', className: 'bg-surface' },
  { name: 'surface-sunken', className: 'bg-surface-sunken' },
  { name: 'fg', className: 'bg-fg' },
  { name: 'fg-muted', className: 'bg-fg-muted' },
  { name: 'fg-subtle', className: 'bg-fg-subtle' },
  { name: 'accent', className: 'bg-accent' },
  { name: 'accent-subtle', className: 'bg-accent-subtle' },
  { name: 'status-positive', className: 'bg-status-positive' },
  { name: 'status-attention', className: 'bg-status-attention' },
  { name: 'status-negative', className: 'bg-status-negative' },
  { name: 'status-progress', className: 'bg-status-progress' },
];

function ColourSection() {
  return (
    <Block title="Couleur">
      <Text variant="body-sm" tone="muted" className="max-w-prose">
        Rôles sémantiques uniquement. Un composant qui référence une échelle brute est un
        défaut.
      </Text>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {SEMANTIC_SWATCHES.map((swatch) => (
          <Stack key={swatch.name} gap={2}>
            <div
              className={`border-border h-16 w-full rounded-md border ${swatch.className}`}
            />
            <Text variant="mono-sm" tone="subtle">
              {swatch.name}
            </Text>
          </Stack>
        ))}
      </div>
    </Block>
  );
}

/* -------------------------------------------------------------- typography */

const TYPE_SAMPLES: { variant: TextVariant; sample: string }[] = [
  { variant: 'display-2xl', sample: 'Broderie sur mesure' },
  { variant: 'display-xl', sample: 'Broderie sur mesure' },
  { variant: 'display-lg', sample: 'Broderie sur mesure' },
  { variant: 'display-md', sample: 'Broderie sur mesure' },
  { variant: 'heading-lg', sample: 'Titre de section' },
  { variant: 'heading-md', sample: 'Titre de carte' },
  { variant: 'heading-sm', sample: 'Libellé de champ' },
  { variant: 'body-lg', sample: 'Paragraphe d’introduction.' },
  { variant: 'body', sample: 'Texte courant du site.' },
  { variant: 'body-sm', sample: 'Texte secondaire et aide.' },
  { variant: 'caption', sample: 'Métadonnée' },
  { variant: 'overline', sample: '01 — Choisir le produit' },
  { variant: 'mono', sample: 'CMD-2026-0042' },
  { variant: 'mono-sm', sample: 'SKU-TS-NOIR-M' },
];

function TypographySection() {
  return (
    <Block title="Typographie">
      <Stack gap={5}>
        {TYPE_SAMPLES.map(({ variant, sample }) => (
          <div
            key={variant}
            className="border-border flex flex-col gap-1 border-b pb-4 md:flex-row md:items-baseline md:gap-6"
          >
            <Text variant="mono-sm" tone="subtle" className="md:w-32 md:shrink-0">
              {variant}
            </Text>
            <Text variant={variant}>{sample}</Text>
          </div>
        ))}
      </Stack>
    </Block>
  );
}

/* ----------------------------------------------------------------- buttons */

function ButtonSection() {
  return (
    <Block title="Boutons">
      <Row label="Variantes">
        <Button variant="primary">Ajouter au panier</Button>
        <Button variant="secondary">Continuer</Button>
        <Button variant="accent">Personnaliser</Button>
        <Button variant="ghost">Annuler</Button>
        <Button variant="link">En savoir plus</Button>
        <Button variant="danger">Supprimer</Button>
      </Row>

      <Row label="Tailles">
        <Button size="sm">Petit</Button>
        <Button size="md">Moyen</Button>
        <Button size="lg">Grand</Button>
        <Button size="xl">Très grand</Button>
      </Row>

      <Row label="États">
        <Button>Défaut</Button>
        <Button loading>Ajout en cours</Button>
        <Button disabled>Désactivé</Button>
        <Button variant="secondary" disabled>
          Désactivé
        </Button>
        <Button leadingIcon={<Package className="size-4" aria-hidden="true" />}>
          Avec icône
        </Button>
      </Row>

      <Row label="Boutons d’icône">
        <IconButton label="Rechercher" variant="ghost">
          <Search className="size-5" aria-hidden="true" />
        </IconButton>
        <IconButton label="Paramètres" variant="secondary">
          <Settings className="size-5" aria-hidden="true" />
        </IconButton>
        <IconButton label="Supprimer" variant="danger">
          <Trash2 className="size-5" aria-hidden="true" />
        </IconButton>
      </Row>

      <Row label="Pleine largeur (mobile)">
        <Button size="lg" fullWidth className="max-w-sm">
          Passer commande
        </Button>
      </Row>

      <Row label="Liens">
        <Link href="#buttons">Lien en ligne</Link>
        <Link href="#buttons" variant="subtle">
          Lien discret
        </Link>
        <Link href="https://example.com" external>
          Lien externe
        </Link>
      </Row>
    </Block>
  );
}

/* ------------------------------------------------------------------- forms */

const WILAYA_OPTIONS = [
  { value: '16', label: 'Alger' },
  { value: '31', label: 'Oran' },
  { value: '25', label: 'Constantine' },
  { value: '09', label: 'Blida', disabled: true },
];

function FormSection() {
  const [quantity, setQuantity] = useState(1);

  return (
    <Block title="Formulaires">
      <Grid preset="halves" gap={8}>
        <Stack gap={5}>
          <FormField label="Nom complet" required>
            {(props) => <Input placeholder="Amina Bensalem" {...props} />}
          </FormField>

          <FormField
            label="Adresse e-mail"
            description="Nous y enverrons la confirmation de commande."
            required
          >
            {(props) => <Input type="email" placeholder="nom@exemple.dz" {...props} />}
          </FormField>

          <FormField label="Téléphone" error="Numéro de téléphone invalide." required>
            {(props) => <Input type="tel" defaultValue="06 12" {...props} />}
          </FormField>

          <FormField label="Wilaya" required>
            {(props) => (
              <SelectField options={WILAYA_OPTIONS} placeholder="Choisir…" {...props} />
            )}
          </FormField>

          <FormField label="Instructions" optional>
            {(props) => (
              <Textarea placeholder="Précisions sur le placement…" {...props} />
            )}
          </FormField>

          <FormField label="Champ désactivé" disabled>
            {(props) => <Input defaultValue="Non modifiable" {...props} />}
          </FormField>
        </Stack>

        <Stack gap={5}>
          <Stack gap={2}>
            <Overline as="span">Cases à cocher</Overline>
            <CheckboxField
              id="ds-newsletter"
              label="Recevoir les nouveautés"
              description="Un e-mail par mois, jamais plus."
            />
            <CheckboxField
              id="ds-terms"
              defaultChecked
              label="J’accepte les conditions"
            />
            <CheckboxField id="ds-disabled" disabled label="Option indisponible" />
          </Stack>

          <Stack gap={2}>
            <Overline as="span">Boutons radio</Overline>
            <RadioField
              name="ds-delivery"
              defaultValue="home"
              options={[
                { value: 'home', label: 'Livraison à domicile', description: '600 DA' },
                { value: 'desk', label: 'Point de retrait', description: '400 DA' },
                { value: 'none', label: 'Indisponible', disabled: true },
              ]}
            />
          </Stack>

          <Stack gap={2}>
            <Overline as="span">Interrupteurs</Overline>
            <SwitchField id="ds-gift" label="Emballage cadeau" />
            <SwitchField
              id="ds-invoice"
              defaultChecked
              label="Facture entreprise"
              description="Ajoute le NIF sur le document."
            />
          </Stack>

          <Stack gap={2}>
            <Overline as="span">Sélecteur de quantité</Overline>
            <Inline gap={4}>
              <QuantitySelector value={quantity} onChange={setQuantity} max={10} />
              <QuantitySelector value={5} onChange={() => {}} size="sm" />
              <QuantitySelector value={1} onChange={() => {}} disabled />
            </Inline>
          </Stack>
        </Stack>
      </Grid>
    </Block>
  );
}

/* ---------------------------------------------------------------- feedback */

function FeedbackSection() {
  const toast = useToast();

  return (
    <Block title="Retour d’information">
      <Stack gap={3}>
        <Alert tone="neutral" title="Information">
          La broderie personnalisée demande 5 à 7 jours ouvrables.
        </Alert>
        <Alert tone="success" title="Devis accepté">
          Votre panier a été préparé au prix convenu.
        </Alert>
        <Alert tone="warning" title="Devis bientôt expiré">
          Ce devis expire dans 2 jours.
        </Alert>
        <Alert
          tone="danger"
          title="Le paiement n’a pas abouti"
          action={
            <Button size="sm" variant="secondary">
              Réessayer
            </Button>
          }
        >
          Aucun montant n’a été débité.
        </Alert>
      </Stack>

      <Row label="Badges">
        <Badge variant="solid">Nouveau</Badge>
        <Badge variant="accentOutline">Promo</Badge>
        <Badge variant="muted">Épuisé</Badge>
        <Badge variant="accentSubtle">Personnalisable</Badge>
        <Badge variant="outline">Sur commande</Badge>
      </Row>

      <Row label="Toasts">
        <Button
          variant="secondary"
          onClick={() => toast({ title: 'Ajouté au panier', tone: 'success' })}
        >
          Succès
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast({
              title: 'Article retiré',
              tone: 'neutral',
              action: { label: 'Annuler', onClick: () => {} },
            })
          }
        >
          Avec action
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast({
              title: 'Échec de l’envoi',
              description: 'Vérifiez votre connexion.',
              tone: 'danger',
            })
          }
        >
          Erreur
        </Button>
      </Row>

      <Grid preset="halves" gap={8}>
        <Stack gap={4}>
          <Overline as="span">Progression</Overline>
          <ProgressBar label="Envoi du fichier" value={64} showValue />
          <ProgressBar label="Chargement" />
        </Stack>

        <Stack gap={4}>
          <Overline as="span">Squelettes</Overline>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </Stack>
      </Grid>

      <EmptyState
        icon={<Inbox />}
        title="Aucune commande pour l’instant"
        description="Vos commandes apparaîtront ici dès votre premier achat."
        action={<Button variant="secondary">Découvrir la boutique</Button>}
      />
    </Block>
  );
}

/* ---------------------------------------------------------------- surfaces */

function SurfaceSection() {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <Block title="Surfaces">
      <Grid preset="thirds" gap={6}>
        <Card>
          <CardHeader
            title="Carte simple"
            description="Un rectangle bordé sur du papier chaud."
            action={<Badge variant="outline">Info</Badge>}
          />
        </Card>

        <Card>
          <Stack gap={4}>
            <CardHeader title="Avec pied de carte" />
            <CardBody>
              <Text variant="body-sm" tone="muted">
                Le contenu se place ici, avec un rythme de 4.
              </Text>
            </CardBody>
            <CardFooter>
              <Button size="sm">Confirmer</Button>
              <Button size="sm" variant="ghost">
                Annuler
              </Button>
            </CardFooter>
          </Stack>
        </Card>

        <Card interactive>
          <CardHeader title="Interactive" description="Bordure renforcée au survol." />
        </Card>
      </Grid>

      <Row label="Superpositions">
        <Modal
          title="Annuler la commande n° 1042 ?"
          description="Cette action est définitive. Les articles seront remis en stock."
          trigger={<Button variant="secondary">Ouvrir un dialogue</Button>}
          footer={
            <>
              <ModalClose asChild>
                <Button variant="ghost">Conserver</Button>
              </ModalClose>
              <ModalClose asChild>
                <Button variant="dangerSolid">Annuler la commande</Button>
              </ModalClose>
            </>
          }
        />

        <Button variant="secondary" onClick={() => setSheetOpen(true)}>
          Ouvrir un panneau
        </Button>
        <Sheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title="Panier"
          description="3 articles"
        >
          <Text variant="body-sm" tone="muted">
            Le contenu du panneau défile ici.
          </Text>
        </Sheet>

        <Menu
          trigger={<Button variant="secondary">Menu</Button>}
          items={[
            { label: 'Modifier', onSelect: () => {} },
            { label: 'Dupliquer', onSelect: () => {} },
            'separator',
            { label: 'Supprimer', destructive: true, onSelect: () => {} },
          ]}
        />

        <PopoverPanel trigger={<Button variant="secondary">Popover</Button>}>
          <Text variant="body-sm">
            Un popover contient du contenu interactif, contrairement à une infobulle.
          </Text>
        </PopoverPanel>

        <InfoTooltip
          trigger={
            <Button variant="ghost" size="sm">
              Infobulle
            </Button>
          }
          content="Texte complémentaire uniquement."
        />
      </Row>
    </Block>
  );
}

/* -------------------------------------------------------------- navigation */

function NavigationSection() {
  return (
    <Block title="Navigation">
      <Stack gap={6}>
        <Breadcrumbs
          items={[
            { label: 'Accueil', href: '/' },
            { label: 'Boutique', href: '/boutique' },
            { label: 'T-shirts', href: '/boutique/t-shirts' },
            { label: 'T-shirt brodé' },
          ]}
        />

        <TabSet
          items={[
            {
              value: 'description',
              label: 'Description',
              content: (
                <Text variant="body" tone="muted" className="max-w-prose">
                  Coton peigné 180 g/m², broderie fil polyester haute ténacité.
                </Text>
              ),
            },
            {
              value: 'livraison',
              label: 'Livraison',
              content: (
                <Text variant="body" tone="muted">
                  Expédition sous 5 à 7 jours ouvrables.
                </Text>
              ),
            },
            {
              value: 'entretien',
              label: 'Entretien',
              content: (
                <Text variant="body" tone="muted">
                  Lavage à 30°, sur l’envers, sans sèche-linge.
                </Text>
              ),
            },
          ]}
        />

        <Pagination page={4} totalPages={12} hrefFor={(page) => `?page=${page}`} />
      </Stack>
    </Block>
  );
}

/* ------------------------------------------------------------------ status */

function StatusSection() {
  return (
    <Block title="Statuts">
      <Grid preset="thirds" gap={8}>
        <Stack gap={3}>
          <Overline as="span">Commandes</Overline>
          {(Object.keys(ORDER_STATUS_TONES) as OrderStatus[]).map((status) => (
            <OrderStatusBadge key={status} status={status} />
          ))}
        </Stack>

        <Stack gap={3}>
          <Overline as="span">Devis</Overline>
          {(Object.keys(QUOTE_STATUS_TONES) as QuoteStatus[]).map((status) => (
            <QuoteStatusBadge key={status} status={status} />
          ))}
        </Stack>

        <Stack gap={3}>
          <Overline as="span">Demandes</Overline>
          {(Object.keys(REQUEST_STATUS_TONES) as RequestStatus[]).map((status) => (
            <RequestStatusBadge key={status} status={status} />
          ))}
        </Stack>
      </Grid>
    </Block>
  );
}

/* ---------------------------------------------------------------- commerce */

const DEMO_PRODUCTS = [
  {
    name: 'T-shirt brodé col rond',
    href: '#',
    eyebrow: 'T-shirts',
    imageSrc: null,
    imageAlt: 'T-shirt noir avec broderie poitrine',
    price: 4800,
    compareAtPrice: 6000,
    badge: { label: 'Nouveau' as const },
    colours: [
      { name: 'Noir', hex: '#100f0e' },
      { name: 'Écru', hex: '#f4f2ed' },
      { name: 'Garance', hex: '#8a3623' },
      { name: 'Bleu nuit', hex: '#2b4a6f' },
      { name: 'Vert', hex: '#1f5b3f' },
    ],
  },
  {
    name: 'Casquette brodée',
    href: '#',
    eyebrow: 'Accessoires',
    imageSrc: null,
    imageAlt: 'Casquette écrue avec logo brodé',
    price: 3200,
    badge: { label: 'Personnalisable', variant: 'accentSubtle' as const },
  },
  {
    name: 'Tote bag toile épaisse',
    href: '#',
    eyebrow: 'Accessoires',
    imageSrc: null,
    imageAlt: 'Tote bag en toile avec monogramme',
    price: 2500,
    available: false,
  },
];

function CommerceSection() {
  return (
    <Block title="Commerce">
      <Row label="Prix">
        <Price amount={4800} />
        <Price amount={4800} compareAt={6000} />
        <Price amount={128000} size="lg" />
        <Price amount={950} size="sm" />
      </Row>

      <Stack gap={3}>
        <Overline as="span">Grille produits</Overline>
        <Grid preset="products">
          {DEMO_PRODUCTS.map((product) => (
            <ProductCard key={product.name} product={product} />
          ))}
          <ProductCardSkeleton />
        </Grid>
      </Stack>
    </Block>
  );
}

/* ------------------------------------------------------------------- media */

function MediaSection() {
  return (
    <Block title="Médias">
      <Grid preset="categories" gap={6}>
        <Stack gap={2}>
          <ProductImage src={null} alt="" ratio="product" />
          <Text variant="caption" tone="subtle">
            4:5 — carte produit, sans image
          </Text>
        </Stack>
        <Stack gap={2}>
          <ProductImage src={null} alt="" ratio="category" />
          <Text variant="caption" tone="subtle">
            3:2 — carte catégorie
          </Text>
        </Stack>
        <Stack gap={2}>
          <MediaSkeleton ratio="product" />
          <Text variant="caption" tone="subtle">
            Squelette au bon ratio
          </Text>
        </Stack>
      </Grid>
    </Block>
  );
}

/* ------------------------------------------------------------------ upload */

const UPLOAD_STATES: UploadState[] = ['idle', 'uploading', 'success', 'error'];

function UploadSection() {
  return (
    <Block title="Envoi de fichiers">
      <Grid preset="halves" gap={6}>
        {UPLOAD_STATES.map((state) => (
          <Stack key={state} gap={2}>
            <Overline as="span">{state}</Overline>
            <UploadDropzone
              state={state}
              progress={state === 'uploading' ? 64 : undefined}
              error={state === 'error' ? 'Le fichier dépasse 10 Mo.' : undefined}
              hint="PNG, JPG, SVG ou PDF — 10 Mo maximum"
            />
          </Stack>
        ))}

        <Stack gap={2}>
          <Overline as="span">Désactivé</Overline>
          <UploadDropzone disabled hint="Terminez l’étape précédente." />
        </Stack>
      </Grid>

      <Stack gap={3}>
        <Overline as="span">Fichiers déposés</Overline>
        <Text variant="body-sm" tone="muted" className="max-w-prose">
          Les fichiers matriciels ont un aperçu&nbsp;; SVG et PDF n’en ont pas (ADR-011).
        </Text>
        <Grid preset="halves" gap={4}>
          <FileCard
            name="logo-entreprise.png"
            size={248_000}
            contentType="image/png"
            onRemove={() => {}}
          />
          <FileCard
            name="monogramme.svg"
            size={12_400}
            contentType="image/svg+xml"
            onRemove={() => {}}
          />
          <FileCard
            name="charte-graphique.pdf"
            size={1_820_000}
            contentType="application/pdf"
          />
          <FileCard name="photo-atelier.jpg" size={3_100_000} contentType="image/jpeg" />
        </Grid>
      </Stack>
    </Block>
  );
}
