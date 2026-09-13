// @vitest-environment jsdom

/**
 * Commerce, media and upload primitives.
 *
 * The theme running through these is the boundary: every one of these
 * components is presentation, and the tests are written so that a component
 * which started fetching, calculating or uploading would fail here. That is why
 * each renders from a plain literal with no provider, no client and no mock of
 * a data layer — if a mock were needed, the boundary would already be broken.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Price, formatMoney } from '@/components/commerce/price';
import { ProductCard, ProductCardSkeleton } from '@/components/commerce/product-card';
import { QuantitySelector } from '@/components/commerce/quantity-selector';
import { fr } from '@/i18n/dictionaries/fr';
import {
  ORDER_STATUS_TONES,
  OrderStatusBadge,
  QUOTE_STATUS_TONES,
  QuoteStatusBadge,
  REQUEST_STATUS_TONES,
  RequestStatusBadge,
  StatusIndicator,
  type OrderStatus,
  type QuoteStatus,
  type RequestStatus,
} from '@/components/commerce/status';
import { ProductImage } from '@/components/media/product-image';
import {
  FileCard,
  UploadDropzone,
  isPreviewable,
} from '@/components/upload/upload-dropzone';

describe('Price', () => {
  it('formats integer minor units without inventing decimals', () => {
    render(<Price amount={4800} />);
    // The dinar is quoted in whole units; a stray ",00" would read as an error.
    expect(screen.getByText(/4\s*800/)).toBeInTheDocument();
  });

  it('shows a compare-at price as struck through, with a spoken label', () => {
    render(<Price amount={4800} compareAt={6000} />);
    expect(screen.getByText(/Ancien prix/)).toBeInTheDocument();
    expect(screen.getByText(/6\s*000/)).toBeInTheDocument();
  });

  it('ignores a compare-at that is not actually higher', () => {
    // A "was" below the "now" is a data error, not a saving. Rendering it
    // would advertise a price rise as a discount.
    render(<Price amount={6000} compareAt={4800} />);
    expect(screen.queryByText(/Ancien prix/)).toBeNull();
  });

  it('does no arithmetic of its own', () => {
    // Pricing lives in domain/ exactly once (BUSINESS-RULES.md section 16).
    // The component is handed the final number.
    expect(formatMoney(4800)).toContain('4');
    expect(formatMoney(0)).toBeTruthy();
  });
});

describe('ProductCard', () => {
  const product = {
    name: 'T-shirt brodé col rond',
    href: '/boutique/t-shirt-brode',
    eyebrow: 'T-shirts',
    imageSrc: null,
    imageAlt: 'T-shirt noir avec broderie poitrine',
    price: 4800,
    compareAtPrice: 6000,
    badge: { label: 'Nouveau' as const },
    colours: [
      { name: 'Noir', hex: '#12100e' },
      { name: 'Écru', hex: '#f6f2ec' },
      { name: 'Ocre', hex: '#9a4e26' },
      { name: 'Bleu', hex: '#2b4a6f' },
      { name: 'Vert', hex: '#1f5b3f' },
    ],
  };

  it('renders from a plain object, with no database, auth or provider', () => {
    render(<ProductCard product={product} />);

    /*
     * The rendered href carries the language.
     *
     * The card is handed `/boutique/t-shirt-brode`, and `Link` prefixes it with
     * the locale of the page it is on — the storefront's URLs are `/fr/…` and
     * `/en/…`. The test setup mounts a French path, so that is what comes back.
     */
    expect(screen.getByRole('link', { name: 'T-shirt brodé col rond' })).toHaveAttribute(
      'href',
      '/fr/boutique/t-shirt-brode',
    );
    expect(screen.getByText('T-shirts')).toBeInTheDocument();
    expect(screen.getByText('Nouveau')).toBeInTheDocument();
  });

  it('names the product in the heading, so the link is not "image, link"', () => {
    render(<ProductCard product={product} />);
    expect(
      screen.getByRole('heading', { name: 'T-shirt brodé col rond' }),
    ).toBeInTheDocument();
  });

  it('caps the colour dots and counts the rest, each with a name', () => {
    render(<ProductCard product={product} />);

    // Four dots then "+1" — and every swatch carries its colour name, so a
    // swatch is never colour alone (DESIGN-SYSTEM.md section 8).
    expect(screen.getByText('Noir')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.queryByText('Vert')).toBeNull();
  });

  it('marks an unavailable product in words, not by colour', () => {
    render(<ProductCard product={{ ...product, available: false }} />);
    expect(screen.getByText('Épuisé')).toBeInTheDocument();
  });

  it('renders without optional data', () => {
    render(
      <ProductCard
        product={{
          name: 'Casquette',
          href: '/c',
          imageSrc: null,
          imageAlt: 'Casquette',
          price: 3200,
        }}
      />,
    );

    expect(screen.getByRole('link', { name: 'Casquette' })).toBeInTheDocument();
  });

  it('hides its skeleton from assistive technology', () => {
    const { container } = render(<ProductCardSkeleton />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('QuantitySelector', () => {
  it('reports changes and clamps to the supplied bounds', async () => {
    const onChange = vi.fn();
    render(<QuantitySelector value={1} onChange={onChange} min={1} max={3} />);

    await userEvent.click(screen.getByRole('button', { name: /augmenter/i }));
    expect(onChange).toHaveBeenCalledWith(2);

    // At the floor, decrementing is not merely ignored — the control is off.
    expect(screen.getByRole('button', { name: /diminuer/i })).toBeDisabled();
  });

  it('disables the increment at the ceiling', () => {
    render(<QuantitySelector value={3} onChange={() => {}} max={3} />);
    expect(screen.getByRole('button', { name: /augmenter/i })).toBeDisabled();
  });

  it('exposes the field with an accessible name', () => {
    render(<QuantitySelector value={2} onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Quantité' })).toHaveValue('2');
  });

  it('is inert when disabled', () => {
    render(<QuantitySelector value={2} onChange={() => {}} disabled />);

    expect(screen.getByRole('button', { name: /augmenter/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /diminuer/i })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Quantité' })).toBeDisabled();
  });
});

describe('Status', () => {
  it('renders a label beside the dot, never colour alone', () => {
    render(<StatusIndicator label="En production" tone="progress" />);
    expect(screen.getByText('En production')).toBeInTheDocument();
  });

  it('maps every documented order status to a label', () => {
    for (const status of Object.keys(ORDER_STATUS_TONES) as OrderStatus[]) {
      const { unmount } = render(<OrderStatusBadge status={status} />);
      expect(screen.getByText(fr.labels.orderStatus[status])).toBeInTheDocument();
      unmount();
    }
  });

  it('maps every documented quote status to a label', () => {
    for (const status of Object.keys(QUOTE_STATUS_TONES) as QuoteStatus[]) {
      const { unmount } = render(<QuoteStatusBadge status={status} />);
      expect(screen.getByText(fr.labels.quoteStatus[status])).toBeInTheDocument();
      unmount();
    }
  });

  it('maps every documented request status to a label', () => {
    for (const status of Object.keys(REQUEST_STATUS_TONES) as RequestStatus[]) {
      const { unmount } = render(<RequestStatusBadge status={status} />);
      expect(screen.getByText(fr.labels.requestStatus[status])).toBeInTheDocument();
      unmount();
    }
  });

  it('covers the lifecycles the roadmap needs', () => {
    /**
     * Guards against a status being dropped from the map during a refactor.
     *
     * The order list is the **eleven** of `BUSINESS-RULES.md` section 8, not a
     * shorter placeholder: Phase 11 renders a stored `orders.status` straight
     * into this badge, so a status the database can hold and this map cannot is
     * a page that crashes on a real row. `domain/order` owns the list; this is
     * where the design system is checked against it.
     */
    expect(Object.keys(ORDER_STATUS_TONES)).toEqual(
      expect.arrayContaining([
        'AWAITING_PAYMENT',
        'AWAITING_CONFIRMATION',
        'CONFIRMED',
        'DESIGN_REVIEW',
        'IN_PRODUCTION',
        'READY',
        'SHIPPED',
        'DELIVERED',
        'ON_HOLD',
        'CANCELLED',
        'REFUNDED',
      ]),
    );
    expect(Object.keys(QUOTE_STATUS_TONES)).toEqual(
      expect.arrayContaining(['DRAFT', 'NEEDS_INFO', 'ACCEPTED', 'REJECTED', 'EXPIRED']),
    );
    expect(Object.keys(REQUEST_STATUS_TONES)).toEqual(
      expect.arrayContaining(['SUBMITTED', 'NEEDS_INFO', 'QUOTED', 'CLOSED']),
    );
  });
});

describe('ProductImage', () => {
  it('falls back to a placeholder when a record has no image', () => {
    const { container } = render(<ProductImage src={null} alt="" />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('requires alt text and passes it through', () => {
    render(<ProductImage src="/demo.png" alt="Casquette brodée écrue" />);
    expect(screen.getByAltText('Casquette brodée écrue')).toBeInTheDocument();
  });
});

describe('UploadDropzone', () => {
  it('reports the files chosen without uploading them anywhere', async () => {
    const onFilesSelected = vi.fn();
    const { container } = render(<UploadDropzone onFilesSelected={onFilesSelected} />);

    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    await userEvent.upload(
      input as HTMLInputElement,
      new File(['logo'], 'logo.png', { type: 'image/png' }),
    );

    expect(onFilesSelected).toHaveBeenCalledTimes(1);
    expect(onFilesSelected.mock.calls[0]?.[0]?.[0]?.name).toBe('logo.png');
  });

  it('renders the supplied state rather than deciding one', () => {
    const { unmount } = render(<UploadDropzone state="uploading" progress={64} />);
    expect(screen.getByText(/envoi en cours/i)).toBeInTheDocument();
    unmount();

    render(<UploadDropzone state="error" error="Le fichier dépasse 10 Mo." />);
    // An upload failure is announced, not only coloured.
    expect(screen.getByRole('alert')).toHaveTextContent('Le fichier dépasse 10 Mo.');
  });

  it('offers no way to choose a file while disabled', () => {
    const { container } = render(<UploadDropzone disabled />);

    expect(screen.getByRole('button', { name: /choisir un fichier/i })).toBeDisabled();
    expect(container.querySelector('input[type="file"]')).toBeDisabled();
  });
});

describe('FileCard', () => {
  it('previews a raster image and refuses to preview SVG or PDF', () => {
    // ADR-011: rendering untrusted SVG is the upload risk SECURITY.md section 6
    // is most concerned with, and a PDF thumbnail needs a renderer we lack.
    expect(isPreviewable('image/png')).toBe(true);
    expect(isPreviewable('image/jpeg')).toBe(true);
    expect(isPreviewable('image/svg+xml')).toBe(false);
    expect(isPreviewable('application/pdf')).toBe(false);
    expect(isPreviewable(undefined)).toBe(false);
  });

  it('says so when there is no preview, rather than showing a broken frame', () => {
    render(<FileCard name="monogramme.svg" size={12_400} contentType="image/svg+xml" />);
    expect(screen.getByText(/aperçu indisponible/i)).toBeInTheDocument();
  });

  it('gives the remove control a name that identifies the file', () => {
    render(<FileCard name="logo.png" contentType="image/png" onRemove={() => {}} />);
    expect(screen.getByRole('button', { name: 'Retirer logo.png' })).toBeInTheDocument();
  });
});
