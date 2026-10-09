/**
 * French — the source of truth.
 *
 * The shape of this object **is** the type every other dictionary must satisfy
 * (`type Dictionary = typeof fr`), so a key added here and forgotten in English
 * is a compile error rather than a French word on an English page. That is the
 * whole reason the dictionaries are hand-written TypeScript rather than JSON.
 *
 * ## What belongs here, and what does not
 *
 * **Interface chrome** belongs here: navigation, buttons, labels, headings,
 * validation messages, status names — everything the application says in its
 * own voice.
 *
 * **Catalogue and editorial content does not.** Product names, descriptions,
 * homepage band copy, gallery captions and category names live in the database
 * in one language, and no amount of dictionary work translates them; that needs
 * translation columns on those tables, which is a schema decision nobody has
 * taken. The consequence is visible and deliberate: an English visitor sees an
 * English interface around French product copy, which is the honest state and
 * is recorded in `tasks/CURRENT.md`.
 */

export const fr = {
  /* ------------------------------------------------------------- the shell */
  common: {
    brandTagline: 'Vos idées, brodées.',
    loading: 'Chargement…',
    cancel: 'Annuler',
    save: 'Enregistrer',
    continue: 'Continuer',
    back: 'Retour',
    close: 'Fermer',
    search: 'Rechercher',
    optional: '(optionnel)',
    required: 'obligatoire',
    yes: 'Oui',
    no: 'Non',
    from: 'À partir de',
    none: 'Aucun',
  },

  a11y: {
    pagination: 'Pagination',
    previousPage: 'Page précédente',
    nextPage: 'Page suivante',
    pageNumber: (page: number) => `Page ${page}`,
    skipToContent: 'Aller au contenu principal',
    mainNavigation: 'Navigation principale',
    openMenu: 'Ouvrir le menu',
    theme: 'Thème',
    language: 'Langue',
    account: 'Mon compte',
    cart: 'Panier',
    breadcrumb: 'Fil d’Ariane',
  },

  /**
   * The names of the statuses and kinds a customer reads.
   *
   * `domain/` holds the same maps for e-mail and for the workshop, which is
   * written in French only; these are the storefront's, in both languages. The
   * unit test in `tests/unit/i18n.test.ts` fails if a domain map ever gains a
   * key that is missing here, so the two cannot drift apart silently.
   */
  labels: {
    orderStatus: {
      AWAITING_PAYMENT: 'Acompte attendu',
      AWAITING_CONFIRMATION: 'En attente de confirmation',
      CONFIRMED: 'Confirmée',
      DESIGN_REVIEW: 'Validation du design',
      IN_PRODUCTION: 'En production',
      READY: 'Prête',
      SHIPPED: 'Expédiée',
      DELIVERED: 'Livrée',
      ON_HOLD: 'En pause',
      CANCELLED: 'Annulée',
      REFUNDED: 'Remboursée',
    },
    quoteStatus: {
      DRAFT: 'Brouillon',
      SENT: 'Envoyé',
      VIEWED: 'Consulté',
      NEEDS_INFO: 'Infos requises',
      ACCEPTED: 'Accepté',
      REJECTED: 'Refusé',
      EXPIRED: 'Expiré',
      CANCELLED: 'Annulé',
      SUPERSEDED: 'Remplacé',
      CONVERTED: 'Commandé',
    },
    requestStatus: {
      DRAFT: 'Brouillon',
      SUBMITTED: 'Envoyée',
      IN_REVIEW: 'En étude',
      NEEDS_INFO: 'Infos requises',
      QUOTED: 'Devis envoyé',
      ACCEPTED: 'Acceptée',
      REJECTED: 'Refusée',
      EXPIRED: 'Expirée',
      CONVERTED: 'Commandée',
      CANCELLED: 'Annulée',
      CLOSED: 'Clôturée',
    },
    paymentStatus: {
      UNPAID: 'Non réglée',
      DEPOSIT_PAID: 'Acompte reçu',
      PAID: 'Réglée',
    },
    paymentMethod: {
      COD: 'Paiement à la livraison',
      BANK_TRANSFER: 'Virement bancaire',
      CCP: 'CCP',
      ONLINE: 'Paiement en ligne',
    },
    reviewStatus: {
      PENDING: 'En attente',
      APPROVED: 'Publié',
      REJECTED: 'Refusé',
    },
    quoteLineKind: {
      PRODUCT: 'Article',
      EMBROIDERY: 'Broderie',
      SETUP_FEE: 'Frais de préparation',
      DIGITIZING: 'Numérisation',
      RUSH_FEE: 'Supplément urgence',
      SHIPPING: 'Livraison',
      DISCOUNT: 'Remise',
      OTHER: 'Autre',
    },
    quoteReason: {
      FREEFORM_PRODUCT: 'un produit hors catalogue',
      CUSTOM_PLACEMENT: 'un emplacement sur mesure',
      CUSTOM_DIMENSIONS: 'des dimensions sur mesure',
      THREAD_COLORS: 'le nombre de couleurs de fil',
      QUANTITY: 'la quantité demandée',
      INSTRUCTIONS: 'des instructions détaillées',
      ARTWORK_REVIEW: 'la vérification de votre fichier',
    },
  },
  theme: {
    light: 'Clair',
    dark: 'Sombre',
    system: 'Système',
    current: (choice: string) => `Thème : ${choice}`,
  },
  nav: {
    home: 'Accueil',
    shop: 'Boutique',
    gallery: 'Notre travail',
    custom: 'Broderie personnalisée',
    allProducts: 'Tous les produits',
    theAtelier: 'L’atelier',
    madeToOrder: 'Sur mesure',
    /** The filled pill in the header. A verb, and short enough for a pill. */
    startOrder: 'Commander',
  },

  footer: {
    deliveryNote: 'Livraison dans les 58 wilayas',
    currencyNote: 'Prix en dinar algérien (DA)',
    madeIn: 'Fabriqué et brodé en Algérie',
  },

  /* ----------------------------------------------------------------- shop */
  shop: {
    deliveryInWilayas: (count: number) => `Livraison dans ${count} wilayas`,
    daysRange: (min: number, max: number) =>
      min === max ? `${min} jours` : `${min} à ${max} jours`,
    wilayaCount: (count: number) => `${count} wilayas`,
    eyebrow: 'Boutique',
    title: 'Pièces prêtes à porter',
    lead: 'Des vêtements brodés dans notre atelier, disponibles à l’unité. Presque toutes ces pièces peuvent aussi recevoir votre propre broderie.',
    count: (n: number) => `${n} ${n === 1 ? 'pièce' : 'pièces'}`,
    // Annotated, so the type is `string` rather than a union of the two
    // French words — otherwise English cannot satisfy it.
    pieceWord: (n: number): string => (n > 1 ? 'pièces' : 'pièce'),
    emptyTitle: 'Aucune pièce pour le moment',
    emptyBody: 'Le catalogue est en cours de préparation. Revenez bientôt.',
    metaTitle: 'Boutique',
    metaDescription:
      'Pièces brodées prêtes à porter : t-shirts, sweats, polos et accessoires. Chaque pièce peut aussi être personnalisée.',

    /* --- narrowing the catalogue (Phase 14.13) --- */

    searchLabel: 'Rechercher une pièce',
    searchPlaceholder: 'T-shirt, tote, brodé…',
    searchAction: 'Rechercher',

    filtersLabel: 'Filtrer le catalogue',
    categoriesLabel: 'Filtrer par catégorie',
    allCategories: 'Tout',
    filterCustomisable: 'Personnalisable',
    filterInStock: 'Disponible',
    clearFilters: 'Tout effacer',
    activeFilters: (n: number) => (n === 1 ? '1 filtre actif' : `${n} filtres actifs`),

    sortLabel: 'Trier par',
    sortNewest: 'Nouveautés',
    sortPriceAsc: 'Prix croissant',
    sortPriceDesc: 'Prix décroissant',
    sortName: 'Nom (A–Z)',

    countOf: (shown: number, total: number) =>
      `${shown} ${shown === 1 ? 'pièce' : 'pièces'} sur ${total}`,

    noMatchTitle: 'Aucune pièce ne correspond',
    noMatchBody:
      'Essayez moins de mots, ou retirez un filtre. Tout le catalogue est à un clic.',
    noMatchAction: 'Voir tout le catalogue',

    pagination: 'Pagination',
    previousPage: 'Page précédente',
    nextPage: 'Page suivante',
    goToPage: (n: number) => `Page ${n}`,
    pageOf: (page: number, total: number) => `Page ${page} sur ${total}`,

    categoryEyebrow: 'Catégorie',
    categoryMetaTitle: (name: string) => `${name} brodés`,
    categoryNotFound: 'Catégorie introuvable',
    backToShop: 'Toute la boutique',
  },

  /* --- the 3D viewer (Phase 14.15) --- */
  model: {
    label: 'Vue 3D du vêtement, orientable',
    hint: 'Faites glisser pour tourner',
    loading: 'Chargement du modèle…',
    failed:
      'La vue 3D ne s’affiche pas sur cet appareil. Les photos ci-dessus montrent la même pièce.',
    missingMaterial: (material: string) =>
      `Le modèle ne contient pas de matière « ${material} ». Corrigez-la dans l’atelier.`,
    tabPhotos: 'Photos',
    tab3d: 'Vue 360°',
  },

  product: {
    notFoundTitle: 'Pièce introuvable',
    relatedTitle: 'Dans la même catégorie',
    description: 'Description',
    details: 'Détails',
    badgeNew: 'Nouveau',
    badgeBestSeller: 'Meilleure vente',
    badgeCustomisable: 'Personnalisable',
    soldOut: 'Épuisé',
    customisable: 'Personnalisable',
    addToCart: 'Ajouter au panier',
    addedToCart: 'Ajouté à votre panier.',
    unavailable: 'Indisponible',
    seeCart: 'Voir le panier',
    combinationUnavailable: 'Cette combinaison n’est pas disponible actuellement.',
    quantity: 'Quantité',
    ownEmbroideryTitle: 'Vous préférez votre propre broderie ?',
    ownEmbroideryBody: 'Cette pièce peut recevoir votre logo, un prénom ou un dessin.',
    ownEmbroideryLink: 'Découvrir la broderie personnalisée',
    reviewsAnchor: 'Avis',
    reviewsTitle: 'Avis clients',
    reviewsOnlyDelivered:
      'Seuls les clients dont la commande a été livrée peuvent en écrire un, ce qui rend chaque avis vérifiable.',
    reviewsVerifiedCount: (n: number): string =>
      `${n} ${n > 1 ? 'avis vérifiés' : 'avis vérifié'}. Seuls les clients livrés peuvent en écrire un.`,
    reviewsPrompt: 'Vous avez reçu cette pièce ?',
    reviewsPromptLink: 'Donnez votre avis depuis votre compte',
    noReviews: 'Cette pièce n’a pas encore d’avis.',
    verifiedPurchase: 'Achat vérifié',
  },

  /* ----------------------------------------------------------------- cart */
  cart: {
    customEmbroidery: 'Broderie personnalisée',
    quantityLabel: (quantity: number) => `Quantité : ${quantity}`,
    title: 'Votre panier',
    empty: 'Votre panier est vide',
    emptyBody: 'Parcourez la boutique ou composez une broderie sur mesure.',
    seeShop: 'Voir la boutique',
    metaDescription: 'Les articles que vous avez sélectionnés.',
    startCustom: 'Créer une broderie',
    freeDelivery: 'Offerte',
    issueProductUnavailable: 'Cet article n’est plus disponible.',
    issueVariantInactive: 'Cette déclinaison n’est plus disponible.',
    issueInsufficientStock: 'Le stock ne couvre plus cette quantité.',
    issueNeedsQuote: 'Cette personnalisation nécessite un devis.',
    issuePriceUnresolvable: 'Le prix de cet article ne peut pas être calculé.',
    remove: 'Retirer',
    increase: 'Augmenter la quantité',
    decrease: 'Diminuer la quantité',
    needsFixTitle: 'Votre panier a besoin d’une correction',
    needsFixBody:
      'Un article ne peut pas être commandé tel quel. Ajustez-le pour continuer.',
    fixToContinue: 'Corrigez les articles signalés pour continuer.',
    depositNotice:
      'Votre commande contient une pièce brodée : un acompte sera demandé à l’étape suivante, et la commande part une fois tout prêt.',
    updateFailedTitle: 'Votre panier n’a pas été mis à jour',
    genericError: 'Une erreur est survenue.',
    quantityFor: (name: string) => `Quantité pour ${name}`,
    quantityDiscount: (units: number, percent: number) =>
      `Remise quantité — ${units} pièces, −${percent}%`,
    deliveryNextStep: 'Calculée à l’étape suivante',
    dueNow: 'À payer maintenant (acompte)',
    dueOnDelivery: 'À payer à la livraison',
    subtotal: 'Sous-total',
    delivery: 'Livraison',
    total: 'Total',
    checkout: 'Passer la commande',
    serverPriced: 'Le total est calculé par nos serveurs au moment de la commande.',
  },

  /* ------------------------------------------------------------- checkout */
  checkout: {
    quoteTitle: 'Commande sur devis',
    quoteHeading: (number: string) => `Commande — devis ${number}`,
    quoteLead: (number: string) =>
      `Cette commande correspond au devis ${number}. Pour changer quoi que ce soit, demandez-nous un devis actualisé.`,
    quoteAcceptedTitle: 'Devis accepté',
    quoteFinaliseBefore: (date: string) => `À finaliser avant le ${date}.`,
    quoteLapsedTitle: 'Le délai de commande est écoulé',
    quoteLapsedAlert: 'Ce devis accepté n’est plus commandable',
    quoteLapsedBody:
      'La fenêtre de commande ouverte par votre acceptation est passée. Le devis reste consultable dans vos devis ; écrivez-nous pour un devis actualisé.',
    backToQuotes: 'Revenir à mes devis',
    quoteAccepted: 'Ce que vous avez accepté',
    lineFee: 'Frais',
    lineItem: 'Article',
    quoteFailed: 'Commande impossible',
    quoteShippingFixed:
      'Les frais de livraison sont ceux du devis et ne changent pas selon la wilaya.',
    emailConfirmationHelp: 'Nous y envoyons la confirmation de commande.',
    quoteTerms: 'J’accepte les conditions de vente et confirme le montant du devis.',
    quoteConfirm: 'Confirmer ma commande',
    payCcpHint: 'Les coordonnées vous sont données après la commande.',
    daysAfterConfirmation: 'jours après confirmation',
    pageTitle: 'Votre commande',
    guestNote: 'Pas besoin de compte. Nous vous enverrons la confirmation par e-mail.',
    metaDescription: 'Vos coordonnées, la livraison et le paiement.',
    step1: '1. Vos coordonnées',
    step2: '2. Livraison',
    step3: '3. Paiement',
    failedTitle: 'Votre commande n’a pas été enregistrée',
    emailHelp: 'Nous y envoyons la confirmation de votre commande.',
    phoneHelp: 'Le livreur vous appellera sur ce numéro.',
    wilayaPlaceholder: 'Choisir votre wilaya',
    addressHelp: 'Rue, numéro, points de repère.',
    atHome: 'À domicile',
    atDesk: 'Au bureau de livraison',
    free: 'Offerte',
    customOrderTitle: 'Commande personnalisée',
    customOrderBody:
      'Une pièce brodée est fabriquée pour vous. Un acompte est demandé à la commande, et le paiement à la livraison n’est pas proposé.',
    termsLabel: 'Conditions',
    shipsTogether:
      'Votre commande part en une seule fois, quand tout est prêt. Si vous souhaitez recevoir l’article en stock plus tôt, commandez-le séparément.',
    chooseWilayaFirst: 'Choisissez votre wilaya pour voir le total et confirmer.',
    errName: 'Indiquez votre nom complet.',
    errEmail: 'Indiquez une adresse e-mail valide.',
    errPhone: 'Indiquez un numéro de téléphone algérien.',
    errWilaya: 'Choisissez votre wilaya.',
    errCommune: 'Indiquez votre commune.',
    errAddress: 'Indiquez votre adresse.',
    errTerms: 'Vous devez accepter les conditions.',
    payCod: 'Paiement à la livraison',
    payCodHint: 'Vous réglez au livreur, en espèces.',
    payTransfer: 'Virement bancaire',
    payDetailsAfter: 'Les coordonnées vous sont données après la commande.',
    title: 'Commande',
    contact: 'Vos coordonnées',
    fullName: 'Nom complet',
    email: 'Adresse e-mail',
    phone: 'Téléphone',
    wilaya: 'Wilaya',
    commune: 'Commune',
    address: 'Adresse de livraison',
    deliveryMode: 'Mode de livraison',
    paymentMode: 'Mode de paiement',
    note: 'Note pour l’atelier',
    terms: 'J’accepte les conditions de vente et la politique de retour.',
    confirm: 'Confirmer la commande',
    summary: 'Récapitulatif',
    thanks: 'Merci, votre commande est enregistrée.',
    orderNumberIs: (number: string) => `Votre numéro de commande est ${number}.`,
    continueShopping: 'Continuer mes achats',
    yourOrder: 'Votre commande',
    shipping: 'Livraison',
  },

  /* -------------------------------------------------------------- account */
  account: {
    noOrdersInFlight: 'Aucune commande en cours.',
    changeDetailsNote:
      'Pour changer votre nom, votre mot de passe ou vos adresses de livraison, écrivez-nous : ces écrans arrivent prochainement et nous faisons la modification pour vous en attendant.',
    quoteAnswerBy: (date: string) => `À répondre avant le ${date}`,
    seeAllOrders: 'Toutes mes commandes',
    profileLead: 'Les informations que nous utilisons pour vous joindre.',
    profileVerifyBody: (email: string) =>
      `Nous vous avons envoyé un code à ${email}. Une adresse confirmée est nécessaire pour accepter un devis.`,
    fieldName: 'Nom',
    fieldEmail: 'Adresse e-mail',
    fieldEmailConfirmed: 'Adresse confirmée',
    fieldAccountStatus: 'Statut du compte',
    fieldCustomerSince: 'Client depuis',
    verifyBody: (email: string) =>
      `Nous avons envoyé un code à ${email}. Tant qu’elle n’est pas confirmée, vous ne pouvez pas accepter un devis.`,
    quotesAwaiting: 'Devis en attente de votre réponse',
    quotesAwaitingHint: 'Le plus proche de son échéance en premier.',
    ordersEmptyTitle: 'Aucune commande',
    ordersEmptyBody:
      'Vos commandes apparaissent ici. Une commande passée sans compte reste accessible par le lien reçu par e-mail.',
    quotesMetaDescription: 'Vos devis personnalisés.',
    quotesEmptyTitle: 'Aucun devis pour le moment',
    quotesEmptyBody: 'Dès qu’une de vos demandes est chiffrée, le devis apparaît ici.',
    requestsEmptyTitle: 'Aucune demande',
    requestsEmptyBody:
      'Vos demandes de broderie personnalisée apparaissent ici. Une demande envoyée avant la création de votre compte s’y rattache dès que nous la chiffrons.',
    reviewsEmptyTitle: 'Rien à évaluer pour le moment',
    reviewsEmptyBody:
      'Dès qu’une commande vous est livrée, les pièces qu’elle contient apparaissent ici.',
    reviewPending: ' · en attente de relecture',
    profileUnverifiedTitle: 'Adresse e-mail non confirmée',
    profileInformation: 'Informations',
    profileNotGiven: 'Non renseigné',
    profileConfirmed: 'Confirmée',
    profileToConfirm: 'À confirmer',
    sessionTitle: 'Session',
    sessionBody:
      'Se déconnecter met fin à cette session immédiatement, sur cet appareil.',
    statusActive: 'Actif',
    statusSuspended: 'Suspendu',
    statusDeleted: 'Supprimé',
    needFrom: 'Nous avons besoin de :',
    title: 'Mon compte',
    overview: 'Aperçu',
    requests: 'Mes demandes',
    quotes: 'Mes devis',
    orders: 'Mes commandes',
    reviews: 'Mes avis',
    profile: 'Mon profil',
    greeting: (name: string | null) => (name ? `Bonjour, ${name}` : 'Bonjour'),
    lead: 'Ce qui attend une action de votre part, en premier.',
    nothingTitle: 'Rien en cours',
    nothingBody:
      'Vos demandes, devis et commandes apparaissent ici dès que vous en avez.',
    startCustom: 'Créer ma broderie',
    signOut: 'Se déconnecter',
    verifyTitle: 'Confirmez votre adresse e-mail',
    ordersInFlight: 'Commandes en cours',
    recentOrders: 'Commandes récentes',
    requestsInReview: 'Demandes en cours d’étude',
    noRequests: 'Aucune demande en cours.',
  },

  /* ----------------------------------------------------------------- auth */
  quote: {
    linesCaption: 'Détail des lignes du devis',
    columnLine: 'Ligne',
    columnQuantity: 'Qté',
    columnUnitPrice: 'P.U.',
    columnAmount: 'Montant',
    depositDue: 'Acompte à verser',
    title: 'Devis',
    numbered: (number: string) => `Devis ${number}`,
    listLead: 'Chaque devis reprend le détail de ce qui a été chiffré, ligne par ligne.',
    acceptBefore: (date: string) => `À accepter avant le ${date}`,
    fromRequest: (number: string) => `Demande ${number}`,
    versionLine: (version: number, request: string) =>
      `Version ${version} · demande ${request}`,
    awaitingTitle: 'Devis en attente de votre réponse',
    validUntil: (date: string) => `Ce devis est valable jusqu’au ${date}.`,
    expiredTitle: 'Ce devis a expiré',
    expiredBody:
      'Il reste consultable. Pour un nouveau prix, envoyez-nous une nouvelle demande.',
    lapsedTitle: 'Le délai de commande est écoulé',
    lapsedBody:
      'Vous aviez accepté ce devis, mais la fenêtre de commande est passée. Le devis reste consultable ; demandez-nous un devis actualisé.',
    workshopMessage: 'Message de l’atelier',
    detail: 'Détail du devis',
    whatWasQuoted: 'Ce qui a été chiffré',
    acceptedTitle: 'Devis accepté',
    finaliseBefore: (date: string) =>
      `Vous pouvez finaliser cette commande jusqu’au ${date}.`,
    finalise: 'Vous pouvez finaliser cette commande.',
    finaliseCta: 'Finaliser ma commande',
    rejectedTitle: 'Devis refusé',
    rejectedBody: 'Vous avez refusé ce devis.',
    accept: 'Accepter ce devis',
    decline: 'Refuser',
    declineTitle: 'Refuser ce devis',
    declineBody:
      'Vous pouvez nous dire pourquoi. Cela nous aide à vous proposer autre chose.',
    declineConfirm: 'Confirmer le refus',
    declineReason: 'Motif',
    impossible: 'Impossible',
  },
  request: {
    title: 'Demande',
    numbered: (number: string) => `Demande ${number}`,
    listLead: 'Chaque demande de broderie personnalisée et où elle en est.',
    statusLine: (status: string, date: string) => `${status} · envoyée le ${date}`,
    itemCount: (count: number) => (count === 1 ? '1 article' : `${count} articles`),
    estimateShort: 'estimation',
    quoteWaiting: 'Un devis vous attend.',
    needsInfoTitle: 'Nous avons besoin d’une information',
    quotes: 'Devis',
    quoteVersion: (version: number) => `Version ${version}`,
    quoteAnswerBefore: (date: string) => ` · à répondre avant le ${date}`,
    whatYouAsked: 'Ce que vous avez demandé',
    yourNote: 'Votre note',
    estimateLead: 'Estimation indicative',
    estimateCaveat: '. Seul un devis engage un prix.',
    timeline: 'Suivi',
    timelineEmpty: 'Rien pour l’instant.',
    actorYou: 'Vous',
    actorWorkshop: 'L’atelier',
    statusEvent: (status: string) => `Statut : ${status}`,
    eventStatusChange: 'Changement de statut',
    eventMessage: 'Message',
    eventFileAdded: 'Fichier ajouté',
    eventQuoteSent: 'Devis envoyé',
    replyTitle: 'Répondre à l’atelier',
    askTitle: 'Poser une question',
    replyDescription: 'Vos messages restent attachés à cette demande.',
    replyFailed: 'Envoi impossible',
    replySent: 'Message envoyé. Nous vous répondons vite.',
    replyLabelBlocked: 'Votre réponse',
    replyLabel: 'Votre message',
    replyHintBlocked:
      'Nous vérifions votre réponse et reprenons l’étude de votre demande.',
    replyHint: 'Une question sur votre demande ? Écrivez-nous ici.',
    replySend: 'Envoyer',
    replyFootnote:
      'Vos messages sont conservés avec la demande, pour que rien ne se perde entre deux échanges.',
  },
  order: {
    listLead: 'Le détail de chaque commande reste consultable indéfiniment.',
    detailTitle: 'Commande',
    numbered: (number: string) => `Commande ${number}`,
    statusLine: (status: string, date: string) => `${status} · passée le ${date}`,
    itemCount: (count: number) => (count === 1 ? '1 article' : `${count} articles`),
    depositAsked: ' · acompte demandé',
    thanksTitle: 'Merci, votre commande est enregistrée.',
    thanksNumberBefore: 'Votre numéro de commande est ',
    thanksNoEmail:
      '. Notez-le : c’est votre référence. Nous vous appellerons pour confirmer la livraison.',
    thanksNumberAfter: (email: string) =>
      `. Nous avons envoyé la confirmation à ${email}.`,
    depositTitle: 'Acompte à régler',
    payNow: 'À payer maintenant',
    depositReferenceBefore: 'Utilisez ',
    depositReferenceAfter:
      ' comme référence de votre virement — c’est le seul identifiant à retenir. Les coordonnées bancaires vous sont communiquées par e-mail, et vous pourrez nous envoyer votre preuve de paiement dès qu’elle est disponible.',
    awaitingDepositReferenceBefore: 'Rien n’est encore lancé en production. Utilisez ',
    awaitingDepositReferenceAfter: ' comme référence de votre virement.',
    yourOrder: 'Votre commande',
    quantityLabel: (quantity: number) => `Quantité : ${quantity}`,
    subtotal: 'Sous-total',
    discount: 'Remise',
    free: 'Offerte',
    total: 'Total',
    mixedShipment:
      'Votre commande contient une pièce brodée. Elle part en une seule fois, quand tout est prêt.',
    continueShopping: 'Continuer mes achats',
    proofReceivedTitle: 'Justificatif reçu',
    proofReceivedBody: (date: string) =>
      `Nous l’avons bien reçu le ${date} et le vérifions. Votre commande avance dès qu’il est validé.`,
    proofRejectedTitle: 'Justificatif refusé',
    proofRejectedBody: 'Merci de nous en envoyer un autre.',
    proofAcceptedTitle: 'Justificatif validé',
    proofAcceptedBody: 'Votre paiement a été enregistré par l’atelier.',
    proofUploadTitle: 'Envoyer votre justificatif de virement',
    proofUploadBody: 'Une photo ou une capture du virement suffit.',
    proofSend: 'Envoyer mon justificatif',
    proofHint:
      'Photo ou capture du virement, en PNG, JPG ou PDF. L’atelier le vérifie et enregistre le paiement ; votre commande reste en attente jusque-là.',
    proofFailedTitle: 'Envoi impossible',
    proofFailedBody: 'L’envoi a échoué. Réessayez.',
    fromQuoteTitle: 'Commande sur devis',
    fromQuoteBefore: 'Cette commande reprend exactement le devis ',
    items: 'Articles',
    reference: (sku: string) => `Réf. ${sku}`,
    payment: 'Paiement',
    paymentMethod: 'Mode de paiement',
    paymentState: 'État',
    depositRequired: 'Acompte demandé',
    alreadyPaid: 'Déjà réglé',
    balance: 'Reste à régler',
    address: 'Adresse',
    tracking: 'Suivi',
    timeline: 'Suivi de la commande',
    placedAt: (dateTime: string) =>
      `Passée le ${dateTime}. Nous vous tenons informé dès qu’elle avance.`,
    title: 'Votre commande',
    awaitingDepositTitle: 'En attente de votre acompte',
    awaitingDepositBody:
      'Rien n’est encore lancé en production. Dès que votre acompte est confirmé, nous commençons.',
    awaitingConfirmationTitle: 'En attente de confirmation',
    awaitingConfirmationBody:
      'Nous vérifions votre commande et vous confirmons rapidement.',
    recordedTitle: 'Commande enregistrée',
    recordedBody: 'Nous vous tenons informé par e-mail.',
    delivery: 'Livraison',
  },

  review: {
    noneYet: 'Pas encore d’avis',
    averageOutOf: (average: string, max: number, count: number) =>
      `${average} sur ${max}, ${count} avis`,
    averageWithCount: (average: string, count: number) => `${average} · ${count} avis`,
    ratedOutOf: (rating: number, max: number) => `Noté ${rating} sur ${max}`,
    starsRow: (stars: number) => `${stars} étoiles`,
    lead: 'Vous pouvez donner votre avis sur les pièces que vous avez reçues. Chaque avis est relu par l’atelier avant d’être publié sur la fiche produit.',
    toReview: 'À évaluer',
    seeOrders: 'Voir mes commandes',
    orderReference: (number: string) => `Commande ${number}`,
    published: 'Mes avis publiés',
    noneWritten: 'Vous n’avez pas encore écrit d’avis.',
    writtenOn: (date: string) => `Écrit le ${date}`,
    workshopReply: 'Réponse de l’atelier',
    failedTitle: 'Votre avis n’a pas été enregistré',
    ratingFor: (product: string) => `Votre note pour ${product}`,
    stars: (value: number) => `${value} ${value > 1 ? 'étoiles' : 'étoile'}`,
    fieldTitle: 'Titre',
    titlePlaceholder: 'Ce qui vous a marqué',
    fieldBody: 'Votre avis',
    bodyHint: (min: number, written: number, max: number) =>
      `${min} caractères minimum · ${written}/${max}`,
    bodyPlaceholder:
      'La broderie, la matière, le délai — ce qui aiderait un autre client à choisir.',
    sending: 'Envoi…',
    send: 'Envoyer mon avis',
    moderationNote: 'Votre avis est relu par l’atelier avant d’être publié.',
  },
  auth: {
    signOut: 'Se déconnecter',
    signInLead: 'Vos devis et vos commandes personnalisées vous attendent ici.',
    signUpLead: 'Utilisez l’adresse e-mail indiquée dans votre demande de devis.',
    createAccount: 'Créer un compte',
    signInDescription: 'Accédez à vos devis et à vos commandes.',
    signUpDescription: 'Créez un compte pour suivre vos devis et vos commandes.',
    failed: 'Échec',
    fullName: 'Nom complet',
    passwordHint: 'Au moins 10 caractères.',
    signIn: 'Se connecter',
    signUp: 'Créer mon compte',
    signInTitle: 'Connexion',
    signUpTitle: 'Créer un compte',
    password: 'Mot de passe',
    noAccount: 'Pas encore de compte ?',
    hasAccount: 'Vous avez déjà un compte ?',
  },

  /* --------------------------------------------------------------- custom */
  custom: {
    stepperLabel: 'Étapes du configurateur',
    stepProduct: 'Produit',
    stepPlacement: 'Emplacement',
    stepDesign: 'Design',
    stepOptions: 'Personnalisation',
    stepReview: 'Récapitulatif',
    stepOf: (current: number, total: number) => `Étape ${current} sur ${total}`,
    back: 'Retour',
    askQuote: 'Demander mon devis',
    sendRequest: 'Envoyer ma demande',
    continue: 'Continuer',
    productLead: 'Choisissez la pièce à broder. Toutes sont brodées dans notre atelier.',
    fromPrice: 'à partir de',
    sizeFromPlacement: 'd’après le motif que vous avez placé',
    sizeLead:
      'Ce vêtement n’a pas encore de photo sur laquelle placer le motif : indiquez la taille souhaitée. Choisissez une taille courante ou saisissez la vôtre.',
    sizeUpTo: (width: number) => `jusqu’à ${width} mm de large`,
    sizeWidthMm: 'Largeur (mm)',
    sizeHeightMm: 'Hauteur (mm)',
    placementNoSurface:
      'Ce vêtement n’a pas encore de photo sur laquelle placer un motif. Décrivez l’emplacement souhaité dans les instructions, à l’étape suivante.',
    placementFaces: 'Face du vêtement',
    surfaceNames: {
      FRONT: 'Devant',
      BACK: 'Dos',
      LEFT: 'Côté gauche',
      RIGHT: 'Côté droit',
      TOP: 'Dessus',
      WRAP: 'Vue 3D',
    },
    placementInstructions:
      'Faites glisser le motif pour le déplacer. Flèches pour ajuster, Maj + flèches pour aller plus vite, + et − pour la taille, crochets pour tourner.',
    placementHint: 'Glissez le motif · coins pour redimensionner et pivoter',
    placementSize: (width: number, height: number) => `${width} × ${height} mm`,
    placementWidthOnly: (width: number) => `${width} mm de large`,
    placementQuickSizes: 'Tailles courantes',
    placementYourDesign: 'Votre motif',
    placement3d: 'Vue 3D',
    placement3dLoading: 'Chargement du modèle…',
    placement3dFailed:
      'Le modèle 3D n’a pas pu s’afficher. Utilisez les photos : le placement est le même.',
    placement3dHint:
      'Glissez pour tourner le vêtement · le motif reste où vous l’avez posé',
    placementLead:
      'Où faut-il broder ? Chaque emplacement a une taille maximale, indiquée sous son nom.',
    placementMax: (width: number, height: number) => `Jusqu’à ${width} × ${height} mm`,
    designLead:
      'Envoyez un logo, une photo ou un dessin — ou saisissez simplement le texte à broder. Les deux sont possibles.',
    designHint: 'PNG, JPG, SVG ou PDF — 25 Mo maximum',
    designAdvice:
      'Les images nettes, aux contours marqués et avec peu de couleurs se brodent le mieux. Les photographies et les dégradés donnent rarement un bon résultat.',
    filesRejectedTitle: 'Certains fichiers n’ont pas été ajoutés',
    attachedFiles: 'Fichiers joints',
    uploadingFile: (name: string) => `Envoi de ${name} en cours…`,
    noPreviewNote:
      'Nous ne pouvons pas afficher d’aperçu pour ce type de fichier — le récapitulatif ci-dessous montre exactement ce que nous allons réaliser.',

    /* --- the stitch preview (Phase 16) ---
     *
     * The effect is a rendering of the uploaded file, never a change to it:
     * the copy has to say so, because a customer who believes we have
     * altered their logo will send it again.
     */
    stitchPreviewTitle: 'Aperçu en broderie',
    stitchPreviewLead:
      'Voici à quoi ressemble votre design une fois brodé : le fil réduit les couleurs, et chaque point accroche la lumière. Votre fichier n’est pas modifié.',
    stitchPreviewStitched: 'Brodé',
    stitchPreviewOriginal: 'Fichier d’origine',
    stitchPreviewToggle: 'Affichage de l’aperçu',
    embroideryTextLabel: 'Texte à broder',
    embroideryTextHint:
      'Un prénom, un nom d’équipe, une date. Laissez vide si votre design est un fichier.',
    embroiderySize: 'Taille de la broderie',
    threadColors: 'Couleurs de fil',
    threadThreshold: (threshold: number) =>
      `Au-delà de ${threshold} couleurs, votre configuration passe en devis : nous confirmons le prix avant toute commande.`,
    quantityDiscountNote: 'Une remise s’applique automatiquement à partir de 10 pièces.',
    instructionsHint: 'Précisions sur le placement, les couleurs, la date souhaitée.',
    rowProduct: 'Produit',
    rowPlacement: 'Emplacement',
    rowDesign: 'Design',
    rowSize: 'Taille de broderie',
    rowThreads: 'Couleurs de fil',
    rowQuantity: 'Quantité',
    rowInstructions: 'Instructions',
    submitFailedTitle: 'La demande n’a pas pu être envoyée',
    edit: 'Modifier',
    contactHeading: 'Vos coordonnées',
    contactLead:
      'Nous avons besoin d’une adresse e-mail pour vous envoyer la réponse. Aucun compte n’est nécessaire.',
    emailPlaceholder: 'nom@exemple.dz',
    namePlaceholder: 'Amina',
    estimate: 'Estimation',
    estimateEmpty:
      'Choisissez un produit, un emplacement et une taille pour voir une estimation.',
    estimatePending: 'L’estimation se mettra à jour une fois vos choix complétés.',
    quoteNeeded: 'Devis nécessaire',
    quoteBecause: 'À cause de',
    quoteConfirmWithin: (hours: number) =>
      `Nous confirmons le prix final sous ${hours} heures ouvrées.`,
    fixedPriceNote: 'Prix ferme pour cette configuration. Livraison calculée séparément.',
    quantityDiscount: (percent: number) => `Remise quantité −${percent}%`,
    setupFeeIncluded: 'Frais de numérisation inclus',
    setupFeeOnce: '(une seule fois)',
    estimateCaveat: 'Estimation indicative, non contractuelle.',
    receivedTitle: 'Nous avons bien reçu votre demande',
    referenceBefore: 'Votre référence est ',
    referenceAfter: '. Conservez-la : elle identifie votre demande dans nos échanges.',
    nextQuote: (hours: number) =>
      `Nous étudions votre configuration et revenons vers vous avec un devis chiffré sous ${hours} heures ouvrées.`,
    nextFixed: (hours: number) =>
      `Nous revenons vers vous sous ${hours} heures ouvrées pour confirmer et lancer la production.`,
    filesKept:
      'Vos fichiers sont joints à la demande : l’atelier y a accès et ne vous les redemandera pas.',
    uploadRetry: 'Réessayer',
    fileTypeRejected: 'Format non accepté. Utilisez PNG, JPG, SVG ou PDF.',
    fileTooLarge: 'Fichier trop volumineux (25 Mo maximum).',
    fileEmpty: 'Ce fichier est vide.',
    heading: 'Votre design, sur le vêtement de votre choix.',
    lead: 'Choisissez la pièce et l’emplacement, envoyez votre fichier ou saisissez le texte, et voyez l’estimation se mettre à jour à chaque étape.',
    unavailableBody:
      'Les données de broderie ne sont pas encore configurées. Réessayez plus tard.',
    eyebrow: 'Sur mesure',
    metaTitle: 'Broderie personnalisée',
    metaDescription:
      'Envoyez un logo, un prénom ou un dessin et nous le brodons sur le vêtement de votre choix. Estimation immédiate, devis sous 6 heures ouvrées.',
    unavailableTitle: 'Le configurateur n’est pas disponible',
  },

  gallery: {
    details: 'Détails',
    support: 'Support',
    embroidery: 'Broderie',
    matchingProducts: 'Les pièces correspondantes',
    makeMine: 'Créer la mienne',
    count: (n: number) => `${n} ${n > 1 ? 'réalisations' : 'réalisation'}`,
    heading: 'Ce que nous avons brodé',
    lead: 'Des pièces réalisées à l’atelier, pour des entreprises, des clubs et des familles. Chaque photo indique le support et le type de broderie.',
    facetProductType: 'Support',
    facetEmbroideryType: 'Type de broderie',
    resetFilters: 'Réinitialiser les filtres',
    emptyBodyUnfiltered:
      'Nos réalisations arrivent bientôt. En attendant, la boutique est ouverte.',
    eyebrow: 'Notre travail',
    metaTitle: 'Notre travail',
    metaDescription:
      'Des pièces brodées dans notre atelier : logos d’entreprise, prénoms, écussons et motifs, sur t-shirts, sweats, polos, casquettes et accessoires.',
    notFoundTitle: 'Réalisation introuvable',
    emptyFilteredTitle: 'Aucune réalisation ne correspond',
    emptyFilteredBody: 'Essayez un autre support ou un autre type de broderie.',
    seeAll: 'Voir toutes les réalisations',
    filterLabel: 'Filtrer les réalisations',
    all: 'Tout',
    emptyTitle: 'Rien à montrer pour le moment',
    emptyBody: 'Les réalisations apparaissent ici au fur et à mesure.',
  },

  /* ------------------------------------------------------------- errors */
  upload: {
    bytes: 'o',
    kilobytes: 'Ko',
    megabytes: 'Mo',
    uploading: 'Envoi en cours…',
    failed: 'L’envoi a échoué.',
    received: 'Fichier reçu.',
    dropHere: 'Glissez un fichier ici, ou',
    chooseFile: 'Choisir un fichier',
    takePhoto: 'Prendre une photo',
    noPreviewSuffix: ' · aperçu indisponible',
    previewOf: (filename: string) => `Aperçu de ${filename}`,
    noPreview: 'Sans aperçu',
  },
  customization: {
    fallbackName: 'Pièce personnalisée',
    frozen: 'Figée',
    quantity: 'Quantité',
    placement: 'Emplacement',
    size: 'Taille',
    font: 'Police',
    threads: 'Fils',
    embroideredText: 'Texte brodé',
    instructions: 'Instructions',
    files: 'Fichiers',
  },
  seo: {
    ogFooter: 'Atelier de broderie · Algérie',
    ogProductFallback: 'Broderie personnalisée, à partir d’une pièce.',
  },
  /**
   * The workshop's own words.
   *
   * Separate from the storefront's sections because the two have different
   * readers and different registers: a customer reads "Votre commande", an
   * operator reads "Commande". Phase 14.8 translated these screens after the
   * owner asked for a bilingual workshop; the language is a cookie preference
   * rather than a URL prefix (`i18n/server`).
   */
  admin: {
    slugHint: (slug: string) =>
      `La page sera /shop/${slug}. Changer l’adresse d’un produit en ligne crée automatiquement une redirection depuis l’ancienne.`,
    amountsIn: (currency: string) => `Montants en ${currency}, sans décimale.`,
    compareAtPrice: (currency: string) => `Prix barré (${currency})`,
    noCategoryBody:
      'Un produit appartient à une catégorie et il n’en existe aucune. Créez-en une depuis Catalogue › Catégories, puis revenez ici.',
    thresholdHint:
      'En dessous de ce nombre, la variante apparaît en alerte. Vide : seuil par défaut.',
    ordersKeepSnapshot:
      'Les commandes déjà passées conservent le nom, le SKU et le prix enregistrés au moment de l’achat.',
    archiveSnapshotNote:
      'Les commandes déjà passées ne changent pas : chaque ligne conserve le nom, le SKU et le prix enregistrés au moment de l’achat. Le produit peut être remis en ligne à tout moment.',
    reviewsModerationLead:
      'Un avis reste invisible tant qu’il n’est pas publié. Publier ou refuser recalcule la note du produit dans la même transaction.',
    orderLines: (count: number) =>
      count === 1 ? 'Une ligne de commande' : `${count} lignes de commande`,
    orderedSnapshotNote:
      'référencent ce produit. Elles conservent le nom, le SKU et le prix enregistrés au moment de l’achat : rien de ce que vous modifiez ici ne les change.',
    noOptionNote:
      'Aucune option. Un produit sans option a une seule variante, ce qui convient à une pièce vendue en taille unique.',
    variantsLead:
      'Ce qui est réellement vendu et compté. Le stock se règle depuis l’écran Stock, jamais ici : chaque mouvement y est enregistré.',
    placedOn: 'passée le',
    depositBlocksNote:
      'Rien n’est réservé et rien n’est en fabrication tant que l’acompte n’est pas encaissé. La référence de virement est le numéro de commande.',
    itemRef: (sku: string) => `Réf. ${sku}`,
    toProduce: ' · à fabriquer',
    noEmail: 'sans e-mail',
    noPhone: 'sans téléphone',
    quoteWaitingTitle: (number: string) => `Devis ${number} en attente`,
    quoteSentOn: (date: string) => `Envoyé le ${date}.`,
    quoteSupersedeNote: (version: number) =>
      `Enregistrer un nouveau brouillon crée la version ${version}, qui remplacera celle-ci à l’envoi.`,
    currentStatusNote: (status: string) =>
      `Actuellement : ${status}. Seules les transitions autorisées sont proposées.`,
    outstandingLabel: 'Reste à encaisser :',
    paymentRecorded: 'Paiement enregistré.',
    proofNoPreview: '— sans aperçu.',
    paymentsLead:
      'Ce qui a été encaissé, ce qui est attendu, et les justificatifs à contrôler. Chaque ligne ouvre la commande où l’encaissement se saisit.',
    changeRefused: 'Modification refusée',
    heroFallbackNote:
      'Sans photographie, l’accroche revient à sa mise en page en deux colonnes.',
    noPoints: 'Aucun point. La section n’affiche que son titre et son texte.',
    addPhoto: 'Ajouter une photo',
    replacePhoto: 'Remplacer',
    removePhoto: 'Retirer',
    editWhat: (name: string) => `Modifier — ${name}`,
    deletePoint: (index: number) => `Supprimer le point ${index}`,
    fieldEyebrow: 'Sur-titre',
    fieldNote: 'Note sous les boutons',
    fieldSecondaryCta: 'Bouton secondaire',
    fieldSecondaryCtaHref: 'Destination du bouton secondaire',
    fieldPhotograph: 'Photographie',
    fieldPhotographAlt: 'Description de la photographie',
    fieldLimit: 'Nombre d’éléments affichés',
    fieldShowDelivery: 'Afficher les zones de livraison',
    fieldPoints: 'Points',
    /** The marquee's phrases, one per line — see . */
    /** The marquee's phrases, one per line — see `marqueeConfig`. */
    fieldWords: 'Mots défilants (un par ligne)',
    fieldTitle: 'Titre',
    fieldSubtitle: 'Sous-titre',
    fieldCare: 'Entretien',
    fieldBody: 'Texte',
    fieldButton: 'Bouton',
    fieldDestination: 'Destination',
    destinationHint: 'Une page du site, comme /shop ou /custom.',
    editorLead:
      'Le français est la version de référence. L’anglais ne remplace que ce que vous y écrivez.',
    noBanner: 'Aucun bandeau. La page commence directement par l’en-tête.',
    addMessage: 'Ajouter un message',
    bannerMessage: 'Message',
    bannerShown: 'Affiché',
    bannerDestinationHint: 'Une page du site, ou rien pour un message sans lien.',
    deleteMessage: 'Supprimer ce message',
    confirmDeleteMessage: 'Supprimer ce message ?',
    hidden: 'Masquée',
    hide: 'Masquer',
    show: 'Afficher',
    moveUp: 'Monter',
    moveDown: 'Descendre',
    bandBanner: 'Bandeau',
    bandHero: 'Accroche',
    bandMarquee: 'Bandeau défilant',
    bandHowItWorks: 'Comment ça marche',
    bandCategories: 'Catégories',
    bandFeatured: 'Produits mis en avant',
    bandGallery: 'Galerie',
    bandWhyUs: 'Pourquoi nous',
    bandReviews: 'Avis',
    bandSocial: 'Réseaux',
    bandCustomCta: 'Appel sur mesure',
    bandFinalCta: 'Appel final',
    options: 'Options',
    variants: 'Variantes',
    addVariant: 'Ajouter une variante',
    addOption: 'Ajouter une option',
    variantsOf: (name: string) => `Variantes de ${name}`,
    stockScreenLink: 'l’écran Stock',
    newStatus: 'Nouveau statut',
    cancelOrderTitle: 'Annuler cette commande ?',
    cancelOrder: 'Annuler la commande',
    savePayment: 'Enregistrer le paiement',
    saveNote: 'Enregistrer la note',
    specificPrice: (currency: string) => `Prix spécifique (${currency})`,
    filterAll: 'Toutes',
    filterUnpaid: 'Non réglées',
    filterPartlyPaid: 'Partiellement réglées',
    filterSettled: 'Soldées',
    filterProofs: 'Justificatifs à vérifier',
    awaitingDeposit: 'En attente de l’acompte',
    itemsAsOrdered: 'Tels que commandés, jamais relus du catalogue.',
    historyInternal: 'Entrées internes comprises. Le client n’en voit qu’une partie.',
    guestOrder: 'Commande invité',
    noAddress: 'Aucune adresse enregistrée.',
    depositAsked: 'Acompte demandé',
    toMake: ' à fabriquer',
    statusHeading: 'Statut',
    cancelReason: 'Motif de l’annulation',
    toldToCustomer: 'Communiqué au client.',
    trackingNumber: 'Numéro de suivi',
    holdReason: 'Motif de la pause',
    internalNoteHint: 'Note interne : le client ne la voit pas.',
    cancelHint:
      'L’annulation est définitive et libère le stock réservé. Le motif est communiqué au client.',
    paymentHint:
      'Un paiement enregistré recalcule l’état de règlement ; il ne se saisit pas directement.',
    amountInCentimes: 'Montant (centimes)',
    amountRefusedAbove: 'Le serveur refuse tout montant supérieur au reste dû.',
    reference: 'Référence',
    proofToVerify: 'Justificatif à vérifier',
    proofHint:
      'Envoyé par le client. Acceptez-le, puis enregistrez le paiement correspondant.',
    reasonShownAsIs: 'Le motif est affiché au client tel quel.',
    reason: 'Motif',
    internalNote: 'Note interne',
    neverVisible: 'Jamais visible par le client, sur aucun écran.',
    note: 'Note',
    finalStatus:
      'Cette commande est dans un statut final. Rien ne peut plus la faire bouger.',
    productionStarted: 'Si la fabrication a commencé, les matières sont déjà engagées.',
    fullPayment: 'Paiement intégral',
    statusUpdated: 'Statut mis à jour.',
    proofAccepted: 'Justificatif accepté.',
    proofRejected: 'Justificatif refusé.',
    noteSaved: 'Note enregistrée.',
    informationAskedTitle: 'Information demandée au client',
    noCustomerAccount: 'Aucun compte client',
    theRequest: 'La demande',
    customerPreview: 'Aperçu client',
    customerPreviewHint:
      'Exactement ce que le client verra. Les totaux viennent du serveur.',
    customerNote: 'Note du client',
    nothingYet: 'Rien pour l’instant.',
    noQuoteForRequest: 'Aucun devis pour cette demande.',
    quoteSent: 'Devis envoyé',
    quoteEditorHint:
      'Vous fixez les lignes ; les totaux sont calculés par le serveur à l’enregistrement.',
    lineLabel: 'Libellé',
    lineDetail: 'Précision',
    quantity: 'Quantité',
    saveDraftFirst: 'Enregistrez le brouillon avant de pouvoir l’envoyer.',
    draftSaved: 'Brouillon enregistré. Les totaux ci-dessous sont ceux du serveur.',
    negativeForDiscount: 'Négatif pour une remise.',
    conversationHint: 'Une conversation ordinaire ne change pas le statut de la demande.',
    yourMessage: 'Votre message',
    workshopOnly: 'Visible uniquement par l’atelier.',
    blocksRequestHint:
      'Bloque la demande jusqu’à la réponse du client. À réserver à ce qui empêche de chiffrer.',
    readAsIs: 'Le client lit ce texte tel quel.',
    requestStatusHeading: 'Statut de la demande',
    takeIntoReview: 'Prendre en étude',
    noOrdersYet: 'Aucune commande.',
    noRequestsYet: 'Aucune demande.',
    noQuotesSent: 'Aucun devis envoyé.',
    addressConfirmed: 'Adresse confirmée',
    adjustmentRefused: 'Ajustement refusé',
    adjustmentHint: 'Un nombre signé : « 12 » pour une réception, « -2 » pour une casse.',
    adjustmentNoteHint: 'Conservée dans l’historique du mouvement.',
    resultingStockHere: 'Le stock résultant s’affiche ici.',
    publicReply: 'Réponse publique de l’atelier',
    publicReplyHint: 'Affichée sous l’avis sur la fiche produit.',
    moderationHint:
      'Publier ou refuser recalcule la note du produit dans la même transaction.',
    productOrdered: 'Ce produit a déjà été commandé',
    noVariant: 'Aucune variante',
    colPrice: 'Prix',
    oneOrderLine: 'Une ligne de commande',
    newProductLead:
      'Créez la fiche, puis ajoutez ses options, ses variantes et son stock.',
    noCategory: 'Aucune catégorie',

    /* --- categories (Phase 14.13) --- */
    /* --- 3D models (Phase 14.15) --- */
    modelHeading: 'Modèle 3D',
    modelAdd: 'Ajouter un modèle',
    modelHint: (extension: string, megabytes: number) =>
      `Un fichier .${extension} autonome, ${megabytes} Mo au maximum. Il est analysé avant d’être stocké : un modèle qui va chercher une image ailleurs est refusé.`,
    modelChooseMaterial:
      'Le fichier a été lu sans être stocké. Choisissez la matière sur laquelle la broderie est appliquée.',
    modelMaterial: 'Matière brodée',
    modelSuggested: 'suggérée',
    modelWidthMm: 'Largeur réelle (mm)',
    modelUpload: 'Attacher le modèle',
    modelNone: 'Aucun modèle 3D pour ce produit.',
    modelUnnamed: 'Modèle sans nom',
    modelInactive: 'Inactif',
    modelActivate: 'Activer',
    modelDeactivate: 'Désactiver',
    modelDelete: 'Supprimer le modèle',
    modelTooLarge: (megabytes: number) => `Le fichier dépasse ${megabytes} Mo.`,

    navCategories: 'Catégories',
    fieldCategoryName: 'Nom de la catégorie',

    /* --- translations (Phase 14.14) --- */
    translationHeading: 'Version anglaise',
    translationFieldLabel: (label: string, language: string) => `${label} (${language})`,
    translationProgress: (done: number, total: number) =>
      total === 0 ? 'rien à traduire' : `${done} / ${total} traduits`,
    translationHint:
      'Le texte français est rappelé sous chaque champ. Laissez vide ce que vous ne traduisez pas : le visiteur anglophone verra le français plutôt qu’un blanc.',
    translationNoSource: 'Rien en français à traduire ici.',
    translationTooLong: 'C’est trop long.',
    translationUnknownField: 'Ce champ ne peut pas être traduit.',
    colTranslated: 'Anglais',
    categories: 'Catégories',
    categoriesLead:
      'Les rayons de la boutique. Chaque catégorie a sa propre page et sa puce dans le catalogue.',
    newCategory: 'Nouvelle catégorie',
    newCategoryLead:
      'Le nom, l’adresse et la place dans la rangée. Les produits s’y rattachent depuis leur propre fiche.',
    editCategory: 'Modifier la catégorie',
    fieldSlug: 'Adresse (slug)',
    fieldCategoryPosition: 'Position',
    categoryPositionHint:
      'L’ordre des puces dans le catalogue. Le plus petit nombre passe en premier.',
    fieldCategoryActive: 'Catégorie visible',
    categoryActiveHint:
      'Décochée, elle disparaît du catalogue et sa page renvoie une erreur. Impossible tant qu’elle contient des produits en ligne.',
    categoryDescriptionHint:
      'Le texte sous le titre de la page de catégorie. Facultatif, deux lignes suffisent.',
    createCategory: 'Créer la catégorie',
    colLiveProducts: 'En ligne',
    categoryInactive: 'Masquée',
    noCategoriesTitle: 'Aucune catégorie',
    noCategoriesBody:
      'Un produit appartient à une catégorie. Créez-en une avant d’ajouter des produits.',
    categoryEmptyWarning: 'Cette catégorie ne contient aucun produit en ligne.',
    viewCategoryOnSite: 'Voir dans la boutique',
    saveRefused: 'Enregistrement refusé',
    actionRefused: 'Action refusée',
    fieldsetIdentity: 'Identité',
    identityHint: 'Le nom et l’adresse tels qu’ils apparaissent dans la boutique.',
    fieldProductName: 'Nom du produit',
    fieldDescription: 'Description',
    descriptionHint: 'Le texte que lit le client sur la page produit.',
    fieldCategory: 'Catégorie',
    chooseCategory: 'Choisir une catégorie',
    fieldsetPrice: 'Prix',
    compareAtHint: 'Affiché barré à côté du prix. Doit être supérieur au prix de vente.',
    fieldsetAvailability: 'Disponibilité',
    featuredHint: 'Peut apparaître dans la bande « Sélection » de l’accueil.',
    fieldNewArrival: 'Nouveauté',
    fieldsetDetails: 'Détails',
    detailsHint: 'Facultatifs. Affichés sur la page produit quand ils sont renseignés.',
    fieldMaterial: 'Matière',
    fieldEmbroideryDetails: 'Détails de broderie',
    fieldsetSeo: 'Référencement',
    fieldSeoTitle: 'Titre pour les moteurs',
    fieldSeoDescription: 'Description pour les moteurs',
    seoBlankHint: 'Laissez vide pour reprendre le nom et la description.',
    saveChanges: 'Enregistrer',
    changesSaved: 'Modifications enregistrées',
    createProductThenVariants: 'Le produit est créé, puis vous ajoutez ses variantes.',
    ordersUnchanged: 'Les commandes déjà passées ne sont pas modifiées.',
    createProduct: 'Créer le produit',
    optionHint: 'Une option est un axe de choix : une taille, une couleur, une finition.',
    fieldOptionName: 'Nom de l’option',
    optionValuesHint: 'Séparées par des virgules, dans l’ordre d’affichage.',
    skuHint: 'Identifiant unique, lu sur l’étiquette. Mis en majuscules automatiquement.',
    fieldLowStockThreshold: 'Seuil d’alerte de stock',
    fieldVariantActive: 'Variante active',
    variantActiveHint:
      'Une variante inactive ne peut pas être achetée, même si le produit est en ligne.',
    variantCreatedEmpty:
      'La variante est créée à zéro en stock. Approvisionnez-la depuis l’écran Stock.',
    variantEditHint:
      'Le SKU, le prix et le seuil d’alerte. La combinaison d’options ne change pas.',
    archiveHint:
      'Il disparaît de la boutique et son adresse renvoie une page introuvable.',
    contentLead:
      'L’ordre des sections, leurs textes dans les deux langues, les images et le bandeau.',
    contentLiveTitle: 'Ce que voit un visiteur',
    contentLiveBefore: 'Les modifications sont visibles immédiatement sur ',
    contentLiveLink: 'la page d’accueil',
    contentLiveAfter:
      '. Une section désactivée disparaît de la page sans être supprimée.',
    bannerHeading: 'Bandeau',
    bannerLead:
      'La bande au-dessus de l’en-tête. Un message actif à la fois suffit ; les autres restent enregistrés et éteints.',
    colItems: 'Articles',
    colEstimate: 'Estimation',
    colAge: 'Âge',
    ageToday: 'aujourd’hui',
    ageOneDay: '1 jour',
    ageDays: (days: number) => `${days} jours`,
    informationAsked: 'Information demandée :',
    onQuote: 'Sur devis',
    waitingOnCustomer: 'En attente du client',
    toHandle: 'À traiter',
    colCategory: 'Catégorie',
    colModified: 'Modifié',
    colSettlement: 'Règlement',
    colDue: 'Échéance',
    colReserved: 'Réservé',
    colCollected: 'Encaissé',
    colLastActivity: 'Dernière activité',
    colSku: 'SKU',
    colStock: 'Stock',

    productsLead:
      'Le catalogue vendu par l’atelier. Les demandes sur mesure sont ailleurs.',
    filterByState: 'Filtrer par état',
    newProduct: 'Nouveau produit',
    noProductMatches: 'Aucun produit ne correspond',
    catalogueEmpty: 'Le catalogue est vide',
    createFirstProduct: 'Créez un premier produit pour le mettre en vente.',

    noOrderInQueue: 'Aucune commande dans cette file',
    noOrders: 'Aucune commande',
    nothingInStatus: 'Rien n’est actuellement dans ce statut.',
    ordersAppearHere: 'Les commandes apparaissent ici dès qu’elles sont passées.',

    quotesTitle: 'Devis',
    quotesAwaitingAnswer: 'En attente de réponse',
    quotesAwaitingHint: 'Relancer avant échéance',
    quotesAccepted: 'Acceptés',
    quotesAcceptedHint: 'À suivre jusqu’à la commande',
    quotesUnfinished: 'Commandes non finalisées',
    quotesEmptyTitle: 'Aucun devis en cours',
    quotesEmptyBody: 'Les devis apparaissent ici dès qu’ils sont envoyés.',
    quotesCaption: 'Devis en cours',
    quoteToFinalise: 'Commande à finaliser',
    quoteWindowClosed: 'Fenêtre de commande close',
    quoteLapsed: 'Échue',
    quoteExpiresToday: 'expire aujourd’hui',

    requestsWaitingWorkshop: 'Demandes en attente de l’atelier',
    requestsWaitingCustomer: 'Demandes en attente d’une réponse du client',
    requestQuoteSent: 'Devis envoyé',
    noRequestInQueue: 'Aucune demande dans cette file',
    noRequests: 'Aucune demande',
    requestsAppearHere:
      'Les demandes de broderie personnalisée apparaissent ici dès qu’elles sont envoyées.',

    stockTitle: 'Stock',
    stockLead:
      'Une ligne par variante. Chaque mouvement est enregistré avec son motif et son auteur.',
    stockOutHint: 'Ne peuvent pas être vendues',
    stockLow: 'Stock bas',
    stockLowHint: 'Au seuil d’alerte ou en dessous',
    stockAvailableUnits: 'Unités disponibles',
    stockAvailableHint: 'Stock moins réservé',
    stockSearchPlaceholder: 'Produit ou SKU',
    stockCaption: 'Stock par variante',
    stockUntracked: 'Non compté',

    noResults: 'Aucun résultat',
    noCustomers: 'Aucun client',
    noCustomerMatches: 'Aucun compte ne correspond à cette recherche.',
    customersAppearHere: 'Les comptes clients apparaissent ici dès qu’ils sont créés.',
    customerConfirmed: 'Confirmé',

    reviewsTitle: 'Avis clients',
    reviewsEmptyTitle: 'Aucun avis dans cette vue',
    reviewsEmptyBody: 'Rien n’attend de décision. Tout est à jour.',
    reviewResponsePublished: 'Réponse publiée',

    paymentsUnpaid: 'Non réglées',
    paymentsUnpaidHint: 'Aucun encaissement à ce jour',
    paymentsProofs: 'Justificatifs à vérifier',
    paymentsProofsHint: 'Transferts déclarés par le client',
    paymentsOutstanding: 'Reste à encaisser',
    paymentsOutstandingHint: 'Sur les commandes non soldées',
    paymentsAllMethods: 'Tous les moyens',
    paymentsSettled: 'Soldée',
    today: 'Aujourd’hui',
    todayLead:
      'Ce qui attend une action, en premier. Chaque ligne mène à l’écran où elle se traite.',
    tileRequests: 'Demandes à étudier',
    tileRequestsHint: 'Réponse promise sous 6 h',
    tileQuotes: 'Devis en attente',
    tileQuotesHint: 'Envoyés, sans réponse',
    tileProofs: 'Justificatifs à vérifier',
    tileProofsHint: 'Acomptes en attente de contrôle',
    tileOutOfStock: 'Variantes en rupture',
    tileLowStockHint: (count: number) => `${count} en stock bas`,
    allClearTitle: 'Rien en attente',
    allClearBody:
      'Aucune demande, aucun devis, aucune commande et aucune rupture n’attend l’atelier.',
    queueNewRequests: 'Nouvelles demandes',
    queueNewRequestsEmpty: 'Aucune nouvelle demande.',
    queueNewRequestsCaption: 'Nouvelles demandes sur mesure',
    allRequests: 'Toutes les demandes',
    queueQuotes: 'Devis en attente de réponse',
    queueQuotesEmpty: 'Aucun devis en attente.',
    queueQuotesCaption: 'Devis envoyés sans réponse',
    allQuotes: 'Tous les devis',
    queueDeposits: 'Acomptes attendus',
    queueDepositsEmpty: 'Aucun acompte en attente.',
    queueDepositsCaption: 'Commandes en attente d’acompte',
    paymentsScreen: 'Écran paiements',
    queueToConfirm: 'Commandes à confirmer',
    queueToConfirmEmpty: 'Aucune commande à confirmer.',
    queueToConfirmCaption: 'Commandes passées et non confirmées',
    allOrders: 'Toutes les commandes',
    queueInProduction: 'En fabrication',
    queueInProductionEmpty: 'Rien en fabrication.',
    queueInProductionCaption: 'Commandes confirmées, en production ou prêtes',
    queueStock: 'Stock à réapprovisionner',
    queueStockEmpty: 'Aucune variante en alerte.',
    queueStockCaption: 'Variantes en rupture ou en stock bas',
    stockScreen: 'Écran stock',
    colRequest: 'Demande',
    colCustomer: 'Client',
    colReceived: 'Reçue',
    colState: 'État',
    colQuote: 'Devis',
    colExpires: 'Expire',
    colAmount: 'Montant',
    colOrder: 'Commande',
    colSince: 'Depuis',
    colDeposit: 'Acompte',
    colProof: 'Justificatif',
    colPlaced: 'Passée',
    colTotal: 'Total',
    colStatus: 'Statut',
    colProduct: 'Produit',
    colAvailable: 'Disponible',
    proofToCheck: 'À vérifier',
    dueToday: 'aujourd’hui',
    dueTomorrow: 'demain',
    dueInDays: (days: number) => `dans ${days} jours`,
    workshop: 'Atelier',
    navigation: 'Navigation de l’atelier',
    openNavigation: 'Ouvrir la navigation',
    signOut: 'Se déconnecter',
    groupWorkshop: 'Atelier',
    groupSales: 'Ventes',
    groupCatalogue: 'Catalogue',
    groupShop: 'Boutique',
    groupCustomers: 'Clients',
    navToday: 'Aujourd’hui',
    navRequests: 'Demandes',
    navQuotes: 'Devis',
    navOrders: 'Commandes',
    navPayments: 'Paiements',
    navProducts: 'Produits',
    navStock: 'Stock',
    navHomepage: 'Page d’accueil',
    navCustomers: 'Clients',
    navSettings: 'Réglages',
    navReviews: 'Avis',

    save: 'Enregistrer',
    cancel: 'Annuler',
    edit: 'Modifier',
    add: 'Ajouter',
    search: 'Rechercher',
    filter: 'Filtrer',
    all: 'Tous',
    none: 'Aucun',
    nothingHere: 'Rien dans cette file',
    refused: 'Modification refusée',
    loading: 'Chargement…',
    seePage: 'Voir la page',
    backToList: 'Retour à la liste',
  },
  adminMedia: {
    title: 'Photographies',
    add: 'Ajouter des photos',
    hint: (max: number) => `JPG, PNG ou WebP · ${max} au maximum · 12 Mo par fichier`,
    full: (max: number) => `Maximum atteint (${max}). Supprimez-en une pour en ajouter.`,
    empty: 'Aucune photographie. La fiche produit affiche un cadre vide.',
    uploadFailed: 'Envoi impossible',
    tooLarge: (name: string) => `${name} dépasse 12 Mo.`,
    primary: 'Principale',
    unknownSize: 'Dimensions inconnues',
    surfaceLabel: 'Face du vêtement (pour le personnalisateur)',
    surfaceNone: 'Photo catalogue — rien ne s’y pose',
    surfaceNames: {
      FRONT: 'Devant',
      BACK: 'Dos',
      LEFT: 'Côté gauche',
      RIGHT: 'Côté droit',
      TOP: 'Dessus',
      WRAP: 'Modèle 3D',
    },
    surfaceWidthLabel: 'Largeur réelle du vêtement (mm)',
    surfaceWidthHint:
      'D’un bord à l’autre de la photo, en millimètres. C’est ce chiffre qui convertit ce que le client fait glisser en une taille réelle.',
    altLabel: 'Description (pour les lecteurs d’écran)',
    moveUp: 'Monter',
    moveDown: 'Descendre',
    makePrimary: 'Définir comme principale',
    remove: 'Supprimer',
    confirmRemove: 'Supprimer cette photographie ? Cette action est définitive.',
  },
  adminSettings: {
    lead: 'Ce que la boutique dit d’elle-même, et les règles qu’elle applique. Chaque valeur est lue par le site en direct : une modification prend effet immédiatement.',

    save: 'Enregistrer les réglages',
    noChanges: 'Aucune modification',
    pendingChanges: (count: number) =>
      count === 1
        ? '1 modification non enregistrée'
        : `${count} modifications non enregistrées`,
    saved: (count: number) =>
      count === 1 ? '1 réglage enregistré' : `${count} réglages enregistrés`,
    nothingChanged: 'Rien n’a changé.',
    forbidden: 'Seul un administrateur peut modifier les réglages.',

    emptyTitle: 'Réglages introuvables',
    emptyBody:
      'Les lignes de réglages ne sont pas dans la base. Lancez `npm run db:seed` : la commande est idempotente et ne touche pas au catalogue.',

    lastChangedBy: (who: string) => `Modifié par ${who}`,
    percentHint: (percent: number) => `soit ${percent} %`,

    groups: {
      brand: {
        title: 'Identité',
        description:
          'Le nom qui apparaît dans les titres de page, les e-mails et le pied de page.',
      },
      availability: {
        title: 'Disponibilité',
        description:
          'Ouvrir ou fermer la boutique au public. L’atelier reste accessible.',
      },
      accounts: {
        title: 'Comptes clients',
        description: 'Comment les clients s’inscrivent et ce qu’ils doivent confirmer.',
      },
      notifications: {
        title: 'Notifications',
        description: 'Qui l’atelier prévient, et ce que la boutique promet au client.',
      },
      pricing: {
        title: 'Tarifs sur mesure',
        description:
          'Les montants qui composent le prix d’une broderie. Tout est en dinars, en chiffres entiers.',
      },
    },

    refusals: {
      UNKNOWN_KEY: 'Ce réglage n’existe pas.',
      REQUIRED: 'Ce champ est obligatoire.',
      TOO_LONG: 'C’est trop long.',
      NOT_A_NUMBER: 'Indiquez un nombre entier.',
      OUT_OF_RANGE: 'Cette valeur est hors des limites acceptées.',
      NOT_A_BOOLEAN: 'Valeur invalide.',
      BAD_EMAIL: 'Une des adresses n’est pas valide.',
    },

    fields: {
      'brand.name': {
        label: 'Nom de la boutique',
        help: 'Apparaît dans le titre de chaque page, dans les e-mails et dans le pied de page.',
      },
      'contact.whatsapp': {
        label: 'Numéro WhatsApp',
        help: 'Affiché quand la boutique est fermée, pour que le client puisse quand même vous joindre.',
      },
      'site.storefrontEnabled': {
        label: 'Boutique ouverte au public',
        help: 'Décoché, la boutique, le configurateur, le panier et les comptes clients laissent place à une page « nous revenons bientôt », dès la page suivante et pour tout le monde, vous compris. L’atelier et la page de connexion restent accessibles : vous ne pouvez pas vous enfermer dehors.',
      },
      'accounts.emailVerificationRequired': {
        label: 'Exiger la confirmation de l’adresse e-mail',
        help: 'Décoché, tous les clients connectés sont considérés comme confirmés et peuvent accepter un devis. À décocher tant qu’aucun fournisseur d’e-mail n’est configuré.',
      },
      'notifications.adminRecipients': {
        label: 'Adresses de l’atelier',
        help: 'Séparées par des virgules. Reçoivent les nouvelles demandes, les commandes et les devis qui expirent. Vide, personne n’est prévenu.',
      },
      'custom_orders.responseTimeHours': {
        label: 'Délai de réponse promis (heures)',
        help: 'Affiché au client sur la page d’accueil et dans le configurateur.',
      },
      'custom_orders.setupFee': {
        label: 'Frais de numérisation (DA)',
        help: 'Facturés une seule fois par configuration, pas par pièce.',
      },
      'custom_orders.textSurcharge': {
        label: 'Supplément texte brodé (DA)',
        help: 'Par pièce, quand la broderie comporte du texte.',
      },
      'custom_orders.threadColorSurchargePerColor': {
        label: 'Supplément par couleur de fil (DA)',
        help: 'Par pièce, au-delà de la première couleur.',
      },
      'custom_orders.setupFeeWaiverQuantity': {
        label: 'Quantité qui annule les frais de numérisation',
        help: 'À partir de cette quantité, les frais ne sont plus facturés.',
      },
      'custom_orders.depositPercent': {
        label: 'Acompte (points de base)',
        help: '5000 = 50 %. L’acompte demandé avant de lancer la fabrication.',
      },
      'custom_orders.quoteValidityDays': {
        label: 'Validité d’un devis (jours)',
        help: 'Passé ce délai, le devis expire et doit être refait.',
      },
    },
  },
  adminArchive: {
    /*
     * Deliberately genderless.
     *
     * The same strings label a table of commandes, demandes, devis, avis and
     * produits, and French would need three variants of "archivé" to agree
     * with all five. "Archives" is a noun and "élément" is masculine, so one
     * set of words reads correctly on every screen.
     */
    /*
     * "Liste", not "En cours": the request screen already filters by a status
     * called "En cours d'étude", and two controls a centimetre apart reading
     * almost the same words is a screen nobody trusts. Paired with "Archives"
     * the meaning is plain on all five lists.
     */
    tabActive: 'Liste',
    tabArchived: 'Archives',
    tabArchivedCount: (count: number) => `Archives (${count})`,

    selectRow: (label: string) => `Sélectionner ${label}`,
    selectAll: 'Tout sélectionner sur cette page',
    selected: (count: number) =>
      count === 1 ? '1 élément sélectionné' : `${count} éléments sélectionnés`,
    clear: 'Effacer la sélection',

    archive: 'Archiver',
    restore: 'Restaurer',
    working: 'Un instant…',

    archived: (count: number) =>
      count === 1 ? '1 élément archivé' : `${count} éléments archivés`,
    restored: (count: number) =>
      count === 1 ? '1 élément restauré' : `${count} éléments restaurés`,
    nothingMoved: 'Rien à déplacer : ces lignes y étaient déjà.',
    refusedPublished: (count: number) =>
      count === 1
        ? '1 produit publié a été ignoré. Dépubliez-le depuis sa fiche.'
        : `${count} produits publiés ont été ignorés. Dépubliez-les depuis leur fiche.`,

    failed: 'Action refusée',
    forbidden: 'Vous n’avez pas accès à l’archivage.',
    empty: 'Sélectionnez au moins une ligne.',
    tooMany: (max: number) => `Sélection trop grande : ${max} lignes au maximum.`,
    unknown: 'Rechargez la page et réessayez.',

    emptyTitle: 'Rien dans les archives',
    emptyBody: 'Ce que vous archivez depuis les files se retrouve ici, et en revient.',
    lead: 'Rangé, pas supprimé : le client, les totaux et l’historique ne changent pas.',
  },
  errors: {
    errorEyebrow: 'Erreur',
    notFoundEyebrow: '404',
    couldNotLoadTitle: 'Cette page n’a pas pu se charger.',
    couldNotLoadBody:
      'Le problème vient de chez nous, pas de vous. Réessayez dans un instant ; si cela se reproduit, la boutique reste accessible.',
    storefrontNotFoundBody:
      'Le lien est peut-être incorrect, ou la pièce que vous cherchez n’est plus au catalogue.',
    notFoundTitle: 'Cette page n’existe pas.',
    notFoundBody: 'Le lien est peut-être ancien, ou l’adresse mal recopiée.',
    goHome: 'Retour à l’accueil',
    unexpectedTitle: 'Quelque chose s’est mal passé.',
    unexpectedBody: 'Nous n’avons pas pu afficher cette page. Réessayez dans un instant.',
    reference: 'Référence',
    retry: 'Réessayer',
  },
};

/**
 * The contract every other language must satisfy.
 *
 * Deliberately **not** `as const`: a literal-typed dictionary would give every
 * French string its own type, and English would then fail to be "Annuler"
 * rather than failing to have a `cancel` key at all. Structural typing is what
 * makes the check useful — same keys, same shapes, any words.
 */
export type Dictionary = typeof fr;
