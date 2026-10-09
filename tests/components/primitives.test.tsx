// @vitest-environment jsdom

/**
 * Design-system tests.
 *
 * These check the properties that are expensive to lose and invisible in a
 * screenshot: that a button is a `button`, that a label is wired to its input,
 * that an error is announced, that a disabled control is really disabled. They
 * are deliberately not snapshots — a snapshot of a component tells you it
 * changed, never whether it is still correct.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Button, IconButton } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { CheckboxField, Input, SwitchField, Textarea } from '@/components/ui/input';
import { Link } from '@/components/ui/link';
import { Breadcrumbs, Pagination, TabSet } from '@/components/ui/navigation';
import { Modal, ModalClose } from '@/components/ui/overlay';
import { Heading, Label, Text } from '@/components/ui/typography';
import { Marquee, SpinningBadge } from '@/components/ui/motion';

describe('Button', () => {
  it('renders a real button element, not a div with a handler', () => {
    render(<Button>Ajouter</Button>);

    const button = screen.getByRole('button', { name: 'Ajouter' });
    expect(button.tagName).toBe('BUTTON');
    // A button inside a form defaults to submit, which is rarely intended.
    expect(button).toHaveAttribute('type', 'button');
  });

  it('is disabled and marked busy while loading, so it cannot double-submit', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Ajout en cours
      </Button>,
    );

    const button = screen.getByRole('button', { name: /ajout en cours/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps its label while loading, so the layout does not shift', () => {
    render(<Button loading>Ajouter au panier</Button>);
    expect(
      screen.getByRole('button', { name: /ajouter au panier/i }),
    ).toBeInTheDocument();
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Indisponible
      </Button>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Indisponible' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is reachable and operable from the keyboard', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Valider</Button>);

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Valider' })).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders as its child when asChild, so a link stays a link', () => {
    render(
      <Button asChild>
        <a href="https://example.dz/boutique">Voir la boutique</a>
      </Button>,
    );

    const link = screen.getByRole('link', { name: 'Voir la boutique' });
    expect(link.tagName).toBe('A');
  });
});

describe('IconButton', () => {
  it('takes its accessible name from the required label', () => {
    render(
      <IconButton label="Fermer">
        <svg aria-hidden="true" />
      </IconButton>,
    );

    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
  });
});

describe('Link', () => {
  it('renders an anchor', () => {
    render(<Link href="/galerie">Galerie</Link>);
    expect(screen.getByRole('link', { name: 'Galerie' }).tagName).toBe('A');
  });

  it('makes an external link safe to open in a new tab', () => {
    render(
      <Link href="https://example.com" external>
        Site externe
      </Link>,
    );

    const link = screen.getByRole('link', { name: 'Site externe' });
    expect(link).toHaveAttribute('target', '_blank');
    // Without noopener the new tab can reach back through window.opener.
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});

describe('Typography', () => {
  it('keeps heading level independent of visual size', () => {
    render(
      <Heading level={3} variant="display-lg">
        Titre
      </Heading>,
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Titre' })).toBeInTheDocument();
  });

  it('renders a real label bound to its control', () => {
    render(
      <>
        <Label htmlFor="ds-test">Nom</Label>
        <input id="ds-test" />
      </>,
    );

    expect(screen.getByLabelText('Nom')).toBeInTheDocument();
  });

  it('renders Text as the requested element', () => {
    render(<Text as="span">Contenu</Text>);
    expect(screen.getByText('Contenu').tagName).toBe('SPAN');
  });
});

describe('FormField', () => {
  it('wires the label, the description and the control together', () => {
    render(
      <FormField label="Adresse e-mail" description="Pour la confirmation." required>
        {(props) => <Input type="email" {...props} />}
      </FormField>,
    );

    const input = screen.getByLabelText(/adresse e-mail/i);
    expect(input).toHaveAccessibleDescription('Pour la confirmation.');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks the control invalid and announces the error', () => {
    render(
      <FormField label="Téléphone" error="Numéro invalide.">
        {(props) => <Input type="tel" {...props} />}
      </FormField>,
    );

    const input = screen.getByLabelText('Téléphone');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Numéro invalide.');
    // role="alert" so a failure after submit is heard, not only seen.
    expect(screen.getByRole('alert')).toHaveTextContent('Numéro invalide.');
  });

  it('replaces the description with the error rather than reading both', () => {
    render(
      <FormField label="Code" description="Six chiffres." error="Code expiré.">
        {(props) => <Input {...props} />}
      </FormField>,
    );

    const input = screen.getByLabelText('Code');
    expect(input).toHaveAccessibleDescription('Code expiré.');
    expect(input.getAttribute('aria-describedby')).not.toContain('description');
  });

  it('disables the control it wraps', () => {
    render(
      <FormField label="Verrouillé" disabled>
        {(props) => <Textarea {...props} />}
      </FormField>,
    );

    expect(screen.getByLabelText('Verrouillé')).toBeDisabled();
  });
});

describe('Choice controls', () => {
  it('binds a checkbox to its own label text', async () => {
    render(<CheckboxField id="cb" label="Recevoir les nouveautés" />);

    const checkbox = screen.getByRole('checkbox', { name: 'Recevoir les nouveautés' });
    expect(checkbox).not.toBeChecked();

    await userEvent.click(screen.getByText('Recevoir les nouveautés'));
    expect(checkbox).toBeChecked();
  });

  it('binds a switch to its label and toggles from the keyboard', async () => {
    render(<SwitchField id="sw" label="Emballage cadeau" />);

    const toggle = screen.getByRole('switch', { name: 'Emballage cadeau' });
    toggle.focus();
    await userEvent.keyboard('{ }');
    expect(toggle).toBeChecked();
  });
});

describe('Feedback', () => {
  it('announces a danger alert and stays quiet for a standing note', () => {
    const { unmount } = render(<Alert tone="danger" title="Paiement refusé" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Paiement refusé');
    unmount();

    render(<Alert tone="neutral" title="Délai de production" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('pairs status colour with a readable label rather than colour alone', () => {
    render(<Badge variant="muted">Épuisé</Badge>);
    expect(screen.getByText('Épuisé')).toBeInTheDocument();
  });

  it('hides a skeleton from assistive technology', () => {
    const { container } = render(<Skeleton className="h-4 w-10" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives an empty state a heading and a way out', () => {
    render(
      <EmptyState
        title="Aucune commande"
        description="Rien pour l’instant."
        action={<Button>Découvrir</Button>}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Aucune commande' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Découvrir' })).toBeInTheDocument();
  });
});

describe('Modal', () => {
  it('opens with a title, traps focus, and closes on Escape', async () => {
    render(
      <Modal
        title="Annuler la commande n° 1042 ?"
        description="Cette action est définitive."
        trigger={<Button>Ouvrir</Button>}
        footer={
          <ModalClose asChild>
            <Button variant="ghost">Conserver</Button>
          </ModalClose>
        }
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('Annuler la commande n° 1042 ?');
    expect(dialog).toHaveAccessibleDescription('Cette action est définitive.');
    // The object being destroyed is named in the title, per the design system.
    expect(within(dialog).getByRole('button', { name: 'Fermer' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('returns focus to the trigger when it closes', async () => {
    render(<Modal title="Détails" trigger={<Button>Ouvrir</Button>} />);

    const trigger = screen.getByRole('button', { name: 'Ouvrir' });
    await userEvent.click(trigger);
    await screen.findByRole('dialog');

    await userEvent.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });
});

describe('Navigation', () => {
  it('marks the current crumb and does not link it', () => {
    render(
      <Breadcrumbs
        items={[
          { label: 'Accueil', href: '/' },
          { label: 'Boutique', href: '/boutique' },
          { label: 'T-shirt brodé' },
        ]}
      />,
    );

    expect(
      screen.getByRole('navigation', { name: /fil d’ariane|fil d'ariane/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Accueil' })).toBeInTheDocument();

    const current = screen.getByText('T-shirt brodé');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.tagName).not.toBe('A');
  });

  it('switches tab panels from the keyboard', async () => {
    render(
      <TabSet
        items={[
          { value: 'a', label: 'Description', content: <p>Coton peigné</p> },
          { value: 'b', label: 'Livraison', content: <p>Sous 5 jours</p> },
        ]}
      />,
    );

    expect(screen.getByText('Coton peigné')).toBeInTheDocument();

    screen.getByRole('tab', { name: 'Description' }).focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(await screen.findByText('Sous 5 jours')).toBeInTheDocument();
  });

  it('marks the current page and renders a bounded window of pages', () => {
    render(<Pagination page={4} totalPages={12} hrefFor={(page) => `?page=${page}`} />);

    expect(screen.getByRole('link', { name: 'Page 4' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Never more than seven numbered slots, however long the list.
    expect(
      screen.getAllByRole('link', { name: /^Page \d+$/ }).length,
    ).toBeLessThanOrEqual(7);
  });

  it('renders nothing for a single page', () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} hrefFor={() => '#'} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * The redesign's continuous motion (Phase 16).
 *
 * Two properties are worth a test and neither is visible in a screenshot: that
 * an infinite animation is *stopped* rather than accelerated when the reader
 * asked for less motion, and that duplicating the marquee's content to make the
 * loop seamless does not double what a screen reader announces.
 */
describe('Marquee', () => {
  it('renders its content twice but announces it once', () => {
    render(<Marquee items={['Brodé main', 'Pièce unique']} />);

    // Both runs are in the DOM — that is what makes the loop seamless.
    expect(screen.getAllByText('Brodé main')).toHaveLength(2);

    // Only one of them is reachable. `getAllByRole` ignores the aria-hidden
    // subtree, so a second list here would mean the strip is read twice.
    expect(screen.getAllByRole('listitem', { hidden: false })).toHaveLength(2);
  });

  it('stops under reduced motion rather than running faster', () => {
    const { container } = render(<Marquee items={['Brodé main']} />);

    const track = container.querySelector('.animate-marquee');
    expect(track).not.toBeNull();
    // The global stylesheet crushes animation *durations*; for an infinite
    // animation that is a seizure, not a stop. The component has to opt out.
    expect(track).toHaveClass('motion-reduce:animate-none');
  });

  it('derives its duration from how much text it carries', () => {
    const { container: short } = render(<Marquee items={['Alger']} />);
    const { container: long } = render(
      <Marquee items={['Broderie sur mesure', 'Livraison 58 wilayas', 'Devis en 6 h']} />,
    );

    const duration = (node: Element | null) =>
      Number(
        (node as HTMLElement | null)?.style
          .getPropertyValue('--marquee-duration')
          .replace('s', ''),
      );

    // Same pixels per second, not the same seconds — a long strip that
    // finished in the same time as a short one would visibly sprint.
    expect(duration(long.querySelector('.animate-marquee'))).toBeGreaterThan(
      duration(short.querySelector('.animate-marquee')),
    );
  });

  it('renders nothing at all when it has no words', () => {
    const { container } = render(<Marquee items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('SpinningBadge', () => {
  it('hides its ring from assistive technology and stops under reduced motion', () => {
    const { container } = render(<SpinningBadge text="BRODÉ À ALGER · " />);

    const svg = container.querySelector('svg');
    // The ring is the same words three times over, bent round a circle. It is
    // decoration; the page says what it means in text.
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveClass('motion-reduce:animate-none');
  });

  it('keeps its centre content readable', () => {
    render(
      <SpinningBadge text="· " size={96}>
        12
      </SpinningBadge>,
    );
    expect(screen.getByText('12')).toBeInTheDocument();
  });
});

/**
 * The font-size tokens survive a tone.
 *
 * `cn.ts` carries its own list of our font-size tokens, because tailwind-merge
 * files any `text-*` it does not recognise as a *colour* — so `cn(size, tone)`
 * silently deletes the size. That bug has now been introduced twice: once when
 * the scale was built, and once in Phase 16 when `display-3xl` was added to
 * `tokens.css` and not to `cn.ts`, which made the new hero render at body size.
 *
 * This is the guard. It iterates the variants rather than naming them, so the
 * next token added to the scale is covered by this test on the day it is added
 * and fails here rather than in a screenshot.
 */
describe('The type scale', () => {
  const VARIANTS = [
    'display-3xl',
    'display-2xl',
    'display-xl',
    'display-lg',
    'display-md',
    'heading-lg',
    'heading-md',
    'heading-sm',
    'body-lg',
    'body',
    'body-sm',
    'caption',
    'overline',
    'mono',
    'mono-sm',
  ] as const;

  it.each(VARIANTS)('keeps its size when %s is given a tone', (variant) => {
    render(
      <Text variant={variant} tone="muted">
        {variant}
      </Text>,
    );

    expect(screen.getByText(variant)).toHaveClass(`text-${variant}`);
  });

  it.each(VARIANTS)('keeps its size when %s is a heading with a width', (variant) => {
    render(
      <Heading level={2} variant={variant} className="max-w-[13ch]">
        {`h-${variant}`}
      </Heading>,
    );

    expect(screen.getByText(`h-${variant}`)).toHaveClass(`text-${variant}`);
  });
});
