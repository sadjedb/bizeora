# BUSINESS-RULES.md

> The authoritative domain rules. Where this file and the UI disagree, this file wins.
> Every rule marked **[DOMAIN]** must be implemented once, in `domain/`, as a pure function,
> and covered by unit tests. No rule marked **[DOMAIN]** may be reimplemented in a component,
> a page, an action, or the admin.

---

## 1. Money and Rounding

1.1 **[DOMAIN]** All money is an integer count of minor units with an ISO currency code.
Floating-point arithmetic on money is prohibited.

1.2 **[DOMAIN]** Rounding happens at exactly two points: after a percentage discount is applied to
a line, and after a percentage deposit is computed. Both use half-up. No other stage rounds.

1.3 Prices are entered by the admin in whole dinars and stored in centimes. Display formats as
whole dinars with a thousands separator and the suffix `DA`.

1.4 **[DOMAIN]** Two amounts may only be added when their currencies match. The `Money` type
enforces this; a mismatch is a programming error, not a runtime branch.

1.5 A single currency (DZD) is active in V1. The currency column exists so that adding a second
market is data, not a migration.

### 1.6 Percentages are integer basis points **[DOMAIN]**

**Every percentage that participates in a business calculation is stored and passed as an integer
count of basis points, where 10 000 basis points = 100%.** There is exactly one representation;
fractional forms such as `0.5` are prohibited in configuration, in the database, and in every
domain function signature. See ADR-018.

| Percentage | Basis points |
| ---------- | ------------ |
| 0%         | `0`          |
| 5%         | `500`        |
| 10%        | `1000`       |
| 15%        | `1500`       |
| 50%        | `5000`       |
| 100%       | `10000`      |

The single conversion, applied wherever a percentage meets money:

```
applyBasisPoints(amount, basisPoints) = roundHalfUp(amount * basisPoints / 10000)
```

Applies to: `settings.custom_orders.depositPercent`, `discount_tiers.discountBasisPoints`,
`coupons.value` when `type = PERCENTAGE`, and `settings.custom_orders.estimateBandPercent`.

Rationale: a fraction is a float, floats are prohibited on money (1.1), and two coexisting
conventions in one codebase is how a deposit is charged at 0.5% or 5000% of an order. Basis points
also express one tenth of a percent without a decimal, which is enough precision for any discount
this business will offer.

Fields storing basis points are named with the `BasisPoints` suffix, or are documented as basis
points at their definition, so the unit is never inferred from the value.

---

## 2. Pricing

### 2.1 Product pricing **[DOMAIN]**

```
unitPrice(variant, product) =
  variant.priceOverride ?? product.basePrice
```

- `compareAtPrice` is display-only. It must be strictly greater than the effective price, or it
  is not rendered. It never participates in a calculation.
- A product with `status <> ACTIVE` or `publishedAt IS NULL` cannot be priced or purchased.
- An inactive variant cannot be purchased even when its product is active.

### 2.2 Customisation pricing **[DOMAIN]**

```
customizationUnitPrice(config, profile, settings) =
    embroiderySize.basePrice
  + placementModifier(profile, placement)
  + threadColorSurcharge(threadColorCount, settings)
  + textSurcharge(config.embroideryText, settings)
```

- `threadColorSurcharge` charges for colours beyond the first, at a per-colour rate from settings.
- Text and an uploaded design may both be present; each surcharge applies once per unit.
- A setup fee is charged **once per configuration**, not per unit, and appears as its own line.
  It is waived above a quantity threshold from settings.

```
customLineUnitPrice = productUnitPrice + customizationUnitPrice
customLineTotal     = customLineUnitPrice * quantity + setupFee(config, quantity, settings)
```

### 2.3 Which pricing mode applies **[DOMAIN]**

The system decides, not the customer. A configuration is **FIXED** only when _every_ condition
holds:

1. It names a catalogue product and a real variant (no free-text product type).
2. Its placement comes from the product's customisation profile (no custom placement note).
3. Its embroidery size is one of the predefined sizes (no free dimensions).
4. Thread colour count is at or below `settings.custom_orders.quoteThresholdThreadColors`
   (default **3**).
5. Quantity is at or below `settings.custom_orders.quoteThresholdQuantity` (default **10**).
6. Instructions are empty or shorter than
   `settings.custom_orders.quoteThresholdInstructionLength` (default **200** characters).
7. All attached design files have status `READY`.

Each of conditions 4 to 6 reads a named settings key. All three are seeded in Phase 2 and are
listed in `DATABASE.md` section 14; none of them is hard-coded.

Otherwise it is **QUOTE**, and `pricingModeReason` records which condition failed, so the customer
is told why rather than being stalled.

2.3.1 An admin may force quote mode on a request at any time before checkout.

2.3.2 The mode is computed server-side on every save. A client-supplied `pricingMode` is ignored.

### 2.4 Estimates **[DOMAIN]**

2.4.1 An estimate is shown at every builder step, including in quote mode. There is no state in
which the customer is shown no number.

2.4.2 In quote mode the estimate is a range: `[computed * (1 - band), computed * (1 + band)]`,
with the band from `settings.custom_orders.estimateBandPercent` in basis points (default **15%**,
seeded as `1500`), always accompanied by the caveat that the final price is confirmed in the quote.

2.4.3 An estimate is never binding. `estimateMin` and `estimateMax` are snapshotted on the
configuration for the admin's reference when pricing.

### 2.5 Quantity discounts **[DOMAIN]**

Tiered by total quantity of custom units in a request or cart. Tiers are rows in the
**`discount_tiers` table**, not a settings value — see ADR-017 and `DATABASE.md` section 12.

V1 seed tiers:

| Units | Discount | `discountBasisPoints` |
| ----- | -------- | --------------------- |
| 1–9   | 0%       | `0`                   |
| 10–24 | 5%       | `500`                 |
| 25–49 | 10%      | `1000`                |
| 50+   | 15%      | `1500`                |

- Applied to the embroidery component only, never to the garment price.
- Shown as an explicit line ("Quantity discount, 25 units, −10%"), never folded silently into a
  unit price.
- The tiers are admin-editable data; the tier-selection function is domain code.
- Quantity discounts and coupons may both apply; the quantity discount is applied first.

2.5.1 **[DOMAIN]** Tier selection: the applicable tier is the single active row whose
`minQuantity <= totalCustomUnits` and whose `maxQuantity` is null or `>= totalCustomUnits`. The
table constraints guarantee exactly one match (`DATABASE.md` section 18), so tier selection is a
lookup rather than a search with a tie-break rule.

2.5.2 A quantity with no matching tier is a data defect, not a zero discount. The domain function
returns a typed error rather than silently discounting nothing, because a silent zero is
indistinguishable from a correct result.

2.5.3 The discount is `applyBasisPoints(embroideryComponent, tier.discountBasisPoints)` per
section 1.6, rounded once.

### 2.6 Quote pricing **[DOMAIN]**

2.6.1 A quote is priced by an admin from line items. The system supplies a **suggested** set of
lines derived from the configuration; the admin may change every value.

2.6.2 Line kinds and their treatment:

| Kind                                                        | Sign     | In `subtotal`                         |
| ----------------------------------------------------------- | -------- | ------------------------------------- |
| PRODUCT, EMBROIDERY, SETUP_FEE, DIGITIZING, RUSH_FEE, OTHER | positive | yes                                   |
| DISCOUNT                                                    | negative | no — accumulates into `discountTotal` |
| SHIPPING                                                    | positive | no — accumulates into `shippingTotal` |

```
subtotal      = sum(positive lines)
discountTotal = abs(sum(DISCOUNT lines))
shippingTotal = sum(SHIPPING lines)
grandTotal    = subtotal - discountTotal + shippingTotal + taxTotal
```

2.6.3 A quote cannot be sent with `grandTotal <= 0`, with no lines, or with a `validUntil` in
the past. Nor with **only fee lines**: a quote whose every line is `SETUP_FEE`, `DIGITIZING`,
`RUSH_FEE` or `OTHER` maps to an order with nothing in it to make. At least one `PRODUCT` or
`EMBROIDERY` line is required — the same pair `hasProductionLine` names, and the same pair 2.6.5
maps to a `CUSTOM` order item.

2.6.4 Accepting a quote locks its `grandTotal`. The resulting order's lines carry
`lockedUnitPrice`; no later catalogue change alters them.

### 2.6.5 Quote line to order line mapping **[DOMAIN]**

Every quote line must survive acceptance. The mapping is exhaustive and total — no line is
discarded, and the resulting order reconciles to the accepted `grandTotal` exactly.

| Quote line kind | Becomes                                                                                                                          | Notes                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `PRODUCT`       | An order item, `kind = CUSTOM` (or `STOCK` where the line names a stock variant)                                                 | Carries the frozen `customizationConfigId`                             |
| `EMBROIDERY`    | Folded into the unit price of the `PRODUCT` line it prices, **or** its own order item of `kind = CUSTOM` where the admin priced it separately | The admin's line structure is preserved as authored. Narrowed from "its own `FEE` item" by **ADR-025**: a `FEE` item is constrained to quantity 1, no configuration and `requiresProduction = false`, and embroidery is none of those |
| `SETUP_FEE`     | An order item, `kind = FEE`, `feeKind = SETUP_FEE`, `quantity = 1`                                                               |                                                                        |
| `DIGITIZING`    | An order item, `kind = FEE`, `feeKind = DIGITIZING`, `quantity = 1`                                                              |                                                                        |
| `RUSH_FEE`      | An order item, `kind = FEE`, `feeKind = RUSH_FEE`, `quantity = 1`                                                                |                                                                        |
| `OTHER`         | An order item, `kind = FEE`, `feeKind = OTHER`, `quantity = 1`                                                                   |                                                                        |
| `SHIPPING`      | `orders.shippingTotal`, **not** an order item                                                                                    | `shippingRateLabel` is set to "Quoted delivery"; no rate lookup occurs |
| `DISCOUNT`      | `orders.discountTotal`, **not** an order item                                                                                    | Stored as a positive magnitude                                         |

Consequences that must hold after mapping:

```
orders.subtotal      = sum(order_items.lineTotal)          // includes FEE lines
orders.shippingTotal = sum(quote SHIPPING lines)
orders.discountTotal = abs(sum(quote DISCOUNT lines))
orders.grandTotal    = quote.grandTotal                     // exact equality, asserted
```

The final assertion is a hard invariant: if the reconstructed order total does not equal the
accepted quote total to the centime, order placement **fails** rather than charging a different
amount. A fee line's `label` is copied verbatim into `nameSnapshot`, so the customer's order
confirmation itemises exactly what their quote itemised.

### 2.7 Price precedence **[DOMAIN]**

When more than one price could apply to a line, precedence is strict:

```
accepted quote price  >  variant override  >  product base price
```

A quote-locked line ignores catalogue changes entirely, including sale prices.

---

## 3. Discounts and Coupons _(V1.5)_

3.1 **[DOMAIN]** One coupon per order. Coupons do not stack with each other. They do stack with
quantity discounts, applied after them.

3.2 **[DOMAIN]** A coupon is valid only when all hold: it is active; now is within
`startsAt`–`endsAt`; the eligible subtotal is at or above `minimumOrderTotal`; total redemptions
are below `usageLimitTotal`; this customer's redemptions are below `usageLimitPerCustomer`; and
the order contains at least one line within the coupon's scope.

3.3 **[DOMAIN]** Application:

```
PERCENTAGE     discount = min(applyBasisPoints(eligibleSubtotal, value),
                              maximumDiscount ?? Inf)
FIXED_AMOUNT   discount = min(value, eligibleSubtotal)
FREE_SHIPPING  shippingTotal = 0
```

`coupons.value` is basis points when `type = PERCENTAGE` and minor units when
`type = FIXED_AMOUNT` — the same convention as section 1.6, using the same conversion.

Eligible subtotal counts only lines within the coupon's scope.

3.4 A coupon never reduces `grandTotal` below zero and never applies to shipping unless its type
is `FREE_SHIPPING`.

3.5 Coupons do not apply to custom or quote-derived lines unless `appliesToCustomOrders` is true.
Default false: those prices are already negotiated.

3.6 Per-customer limits are enforced by counting `coupon_redemptions`, inside the order
transaction, not by reading the cached `usedCount`.

3.7 Coupon validity is re-checked at order placement. A coupon that expires between cart and
checkout is dropped with a clear message, and the order proceeds at the undiscounted total only
after the customer sees the new total.

---

## 4. Shipping

4.1 **[DOMAIN]** Resolution:

```
zone = zoneForWilaya(wilayaCode)                    // exactly one, enforced by unique index
rate = rateFor(zone, deliveryType)                  // HOME or DESK
shipping = (rate.freeOverAmount != null && subtotalAfterDiscount >= rate.freeOverAmount)
             ? 0
             : rate.price
```

4.2 **`shipping_rates.freeOverAmount` is the sole runtime source of truth for free delivery.**
`settings.shipping.defaultFreeThreshold` is a creation and seeding default only: it pre-fills the
field when a rate is created and is **never read during a shipping calculation**, in the cart, at
checkout, in the quote builder, or in the cart's free-delivery progress indicator. A rate with a
null `freeOverAmount` offers no free delivery; it does not fall back to the setting.

4.2.1 Free-shipping thresholds compare against the subtotal **after** discounts, so a discount
cannot be used to reach a threshold it no longer qualifies for.

4.3 Shipping is charged once per order, not per line or per parcel.

4.4 An unmapped wilaya blocks checkout with an explicit message and a contact CTA. It never
silently defaults to a rate.

4.5 Delivery estimates are `estimatedMinDays`–`estimatedMaxDays` from the rate, counted from
`confirmedAt`, plus a production lead time from settings for orders containing custom lines.
Estimates are displayed as a range and are never presented as a guarantee.

4.6 Quote shipping is set by the admin as a `SHIPPING` line and **supersedes** rate resolution
entirely for that order. No zone or rate lookup occurs at any point in a quote-bound checkout;
`orders.shippingRateId` is left null and `shippingRateLabel` records "Quoted delivery".

4.7 **[DOMAIN]** Every order records which rate applied: `shippingRateId` for reporting and
`shippingRateLabel` as an immutable snapshot ("Nord — Desk delivery"). Rate rows are deactivated
rather than deleted, and the snapshot means a historical delivery charge stays explainable even
after the rate table has been edited.

---

## 5. Order Totals

5.1 **[DOMAIN]** The single totals pipeline, used identically by cart, checkout, order placement
and the admin:

```
lineTotal_i  = unitPrice_i * quantity_i - lineDiscount_i
subtotal     = sum(lineTotal_i)
discountTotal= quantityDiscount + couponDiscount
shippingTotal= resolveShipping(...)
taxTotal     = 0 in V1 (settings-driven)
grandTotal   = subtotal - discountTotal + shippingTotal + taxTotal
```

5.2 Totals shown to a customer are always computed server-side. A client-submitted total is
ignored; if it disagrees with the server's, the server's is used and the customer is shown the
difference before committing.

5.3 **[DOMAIN]** Totals are recomputed and re-validated at order placement, inside the
transaction. Between adding to cart and paying, prices, stock, coupons and quotes can all change.

5.4 On placement, totals are **snapshotted** onto the order and never recomputed afterwards.

5.5 Deposits **[DOMAIN]**:

```
depositRequired =
  order derives from a quote     -> quote.depositRequired          // COPIED, never recomputed
  order contains no custom line  -> 0
  payment method is prepaid      -> grandTotal
  otherwise                      -> applyBasisPoints(
                                      grandTotal,
                                      settings.custom_orders.depositPercent)
```

`settings.custom_orders.depositPercent` is stored in **basis points** (section 1.6). The default
deposit is **50%**, seeded as `5000`. It is never a fraction: an earlier draft of this document
wrote `grandTotal * depositPercent`, which would only be correct for a float value such as `0.5`
and is superseded by the form above.

An order with `depositRequired > 0` cannot leave `AWAITING_PAYMENT` until
`amountPaid >= depositRequired`.

5.5.1 **A quote-derived order copies the quote's deposit.** It is never recomputed from the
current `depositPercent`, because the deposit is part of what the customer accepted. If the
setting changes between acceptance and checkout, the accepted figure still stands. Only a
non-quote custom order computes its deposit from the current rule.

---

## 5A. Quote-Bound Checkout

An accepted quote is a fixed commercial commitment and must not become a mutable cart. Acceptance
creates a **quote-bound cart** (`carts.kind = 'QUOTE_BOUND'`), separate from and independent of the
customer's standard shopping cart.

5A.1 **[DOMAIN]** A quote-bound cart contains **exactly** the accepted quote's lines, mapped per
section 2.6.5, and nothing else. Arbitrary products cannot be added to it, quantities cannot be
edited, and lines cannot be removed. The only actions available are check out and abandon.

5A.2 The customer's standard cart is unaffected by acceptance and remains fully usable. A customer
may hold one active standard cart and any number of quote-bound carts at the same time; each is
checked out separately, producing separate orders. A quote-bound cart never participates in the
guest-cart merge on login.

5A.3 **Quote shipping supersedes rate calculation.** No zone or rate lookup occurs. The quote's
`SHIPPING` lines are the shipping total. See section 4.6.

5A.4 **Coupons are disabled** on a quote-bound cart. The price was already negotiated; stacking a
coupon on it would discount a discount. Consistent with section 3.5, and enforced by the check
constraint that a quote-bound cart carries no `couponId`.

5A.5 **Quantity discounts are not re-applied.** They were already priced into the quote's lines by
the admin.

5A.6 **[DOMAIN]** At placement the reconstructed total must equal `quote.grandTotal` **exactly**.
A mismatch aborts placement with a domain error; it never charges a different amount. This is the
single assertion that makes "the customer pays what they accepted" verifiable rather than assumed.

5A.7 The deposit is the quote's deposit (5.5.1).

5A.8 Stock is still validated at placement for any line that names a tracked variant. See
section 10.9 for what happens when a blank has become unavailable since acceptance.

---

## 6. Custom Request Lifecycle

6.1 **[DOMAIN]** Allowed transitions. Anything not listed is rejected.

```
DRAFT      -> SUBMITTED | CANCELLED | EXPIRED
SUBMITTED  -> IN_REVIEW | NEEDS_INFO | REJECTED | CANCELLED
IN_REVIEW  -> QUOTED | NEEDS_INFO | REJECTED | CANCELLED
NEEDS_INFO -> IN_REVIEW | CANCELLED | EXPIRED
QUOTED     -> ACCEPTED | REJECTED | EXPIRED | IN_REVIEW | NEEDS_INFO
             // IN_REVIEW  = admin is revising the quote
             // NEEDS_INFO = admin needs blocking information before the quote can stand
ACCEPTED   -> CONVERTED | CANCELLED
CONVERTED  -> (terminal)
REJECTED | EXPIRED | CANCELLED -> (terminal, except a new request may clone the configuration)
```

6.2 Actor rules:

| Transition                                           | Who                                       |
| ---------------------------------------------------- | ----------------------------------------- |
| DRAFT to SUBMITTED                                   | Customer (owner)                          |
| SUBMITTED to IN_REVIEW, NEEDS_INFO, QUOTED, REJECTED | Admin or staff                            |
| NEEDS_INFO to IN_REVIEW                              | Customer supplying information, or admin  |
| QUOTED to ACCEPTED / REJECTED                        | Customer (owner) only                     |
| ACCEPTED to CONVERTED                                | System, at order placement                |
| any to CANCELLED                                     | Customer before QUOTED; admin at any time |

6.3 Submission requires: at least one request item; every item's configuration valid per section
9; contact name and phone; an identified user; and all attached files in status `READY`.

6.4 Every transition writes a `custom_request_events` row with actor, timestamp and optional note.
No code sets `status` without going through the transition function.

6.5 A `DRAFT` older than the settings TTL (default 30 days) is expired by the cleanup job, and its
orphaned uploads are deleted.

6.6 A customer may cancel a request until it reaches `QUOTED`. After that, rejecting the quote is
the path — this keeps the record of what was offered.

### 6.7 What `NEEDS_INFO` means

`NEEDS_INFO` is a **workflow blocker**, not a conversation marker. It exists so the admin queue can
distinguish "waiting on me" from "waiting on the customer", and the queue's ordering depends on
that distinction being accurate.

6.7.1 It is set **only** by an admin or staff member, and only when a specific, blocking piece of
information is required before the request can progress — a higher-resolution file, a missing
size breakdown, a decision between two placements. Setting it requires `needsInfoReason`, which is
shown to the customer verbatim.

6.7.2 **Ordinary conversation does not change the request status.** A customer question, an admin
answer, a progress note and a courtesy message are all `custom_request_events` rows with
`type = 'MESSAGE'` and no status effect whatsoever. A customer asking "how long will this take?"
must never move the request into `NEEDS_INFO`.

6.7.3 It is cleared by an admin returning the request to `IN_REVIEW`, normally after the customer
has supplied what was asked for. The customer supplying information raises an event and notifies
the admin; it does not clear the state on its own, because only the admin can judge whether what
arrived is sufficient.

6.7.4 `NEEDS_INFO` is reachable from `SUBMITTED`, `IN_REVIEW` and `QUOTED`. Reaching it from
`QUOTED` does not cancel or invalidate the sent quote; the quote remains `SENT` or `VIEWED` and
continues to run down its own `validUntil`. If the answer changes the price, the admin revises the
quote, which creates version N+1 per section 7.2.

6.7.5 `NEEDS_INFO` exists only on the request. It is deliberately **not** a quote status (a quote
awaiting information has not been priced) and **not** an order status (`ON_HOLD` covers a stalled
order). This is what keeps the three lifecycles unambiguous.

---

## 7. Quote Lifecycle

7.1 **[DOMAIN]** Allowed transitions:

```
DRAFT  -> SENT | CANCELLED
SENT   -> VIEWED | ACCEPTED | REJECTED | EXPIRED | CANCELLED | SUPERSEDED
VIEWED -> ACCEPTED | REJECTED | EXPIRED | CANCELLED | SUPERSEDED
ACCEPTED | REJECTED | EXPIRED | CANCELLED | SUPERSEDED -> (terminal)
```

7.2 A quote is **immutable once sent**. Changing a sent quote creates version N+1 and transitions
version N to `SUPERSEDED`. At most one quote per request may be in `SENT` or `VIEWED`.

7.2.1 **[DOMAIN]** Sending a quote **freezes every customisation it prices**, in the same
transaction as the transition to `SENT`. Freezing writes `frozenAt` and the display snapshots
(`productNameSnapshot`, `placementLabel`, `embroiderySizeLabel`, `threadColorNames`, `fontLabel`).

7.2.2 After that point the configuration cannot be edited. A customer or admin change — a new
file, a different placement, another thread colour — **clones** the configuration, edits the clone,
and prices the clone as quote version N+1. The request items point at the clone; version N and the
configuration it described both remain intact.

7.2.3 This is why the freeze point is **send**, not acceptance. A quote is immutable from the
moment it is sent, so what it describes must be immutable from that moment too. Freezing only at
acceptance would leave version 1's line items fixed while the configuration underneath them
changed, making the version history a record of prices without a record of what was priced.

7.3 `VIEWED` is set once, on the owner's first authenticated view. An admin view does not set it.

7.4 Expiry: a quote in `SENT` or `VIEWED` past `validUntil` is `EXPIRED`. Enforced two ways —
an hourly job, and a lazy check on every read — so correctness never depends on the job running.
Default validity is 14 days, from settings.

7.5 Only the owning customer may accept or reject, and only from `SENT` or `VIEWED`.

7.6 Acceptance is atomic, in one transaction: transition the quote to `ACCEPTED`; transition the
request to `ACCEPTED`; set `acceptanceValidUntil`; create a **new quote-bound cart** containing
every quote line mapped per section 2.6.5, each with its `lockedUnitPrice`; and write both event
rows. The customer's standard cart is not touched. See section 5A.

7.7 An accepted quote may back **exactly one** order, enforced by a partial unique index.

7.8 Rejection may capture a reason. A rejected quote may be superseded by a new version, which
returns the request to `IN_REVIEW`.

7.9 An expired quote is read-only. "Request an updated quote" clones the configuration into a new
request; it never revives the old one.

### 7.10 Acceptance validity **[DOMAIN]**

An accepted quote does not stay redeemable forever. Acceptance without payment is not a
commitment the business can be held to indefinitely, and an accepted price becomes wrong as costs
move.

```
acceptanceValidUntil = acceptedAt + settings.custom_orders.acceptanceValidityDays   // default 7
```

7.10.1 The quote-bound cart is checkout-valid only while `now <= acceptanceValidUntil`.

7.10.2 After expiry the quote-bound cart transitions to `INVALIDATED` and can no longer be checked
out. Enforced two ways — a scheduled job and a lazy check on every read — so correctness never
depends on the job having run, exactly as for `validUntil` in 7.4.

7.10.3 The customer is shown the expiry plainly and offered **"Request an updated quote"**. That
action clones the frozen configurations into a **new request**, which the admin prices as a new
quote. It does not revive the accepted quote and does not reuse its prices.

7.10.4 The quote itself remains `ACCEPTED` and historically readable. Only its redeemability
lapses. An order already placed against it is entirely unaffected.

7.10.5 The countdown is displayed to the customer from acceptance onward, and an expiry-warning
notification is sent before it lapses.

---

## 8. Order Lifecycle

8.1 **[DOMAIN]** Allowed transitions:

```
AWAITING_PAYMENT      -> AWAITING_CONFIRMATION | CANCELLED
AWAITING_CONFIRMATION -> CONFIRMED | CANCELLED | ON_HOLD
CONFIRMED             -> DESIGN_REVIEW | IN_PRODUCTION | READY | CANCELLED | ON_HOLD
DESIGN_REVIEW         -> IN_PRODUCTION | ON_HOLD | CANCELLED
IN_PRODUCTION         -> READY | ON_HOLD | CANCELLED
READY                 -> SHIPPED | CANCELLED
SHIPPED               -> DELIVERED | ON_HOLD
DELIVERED             -> REFUNDED
ON_HOLD               -> (the status it was held from) | CANCELLED
CANCELLED | REFUNDED  -> (terminal)
```

8.2 Entry status at placement:

- `depositRequired > 0` and unpaid: `AWAITING_PAYMENT`
- otherwise: `AWAITING_CONFIRMATION`

8.3 `DESIGN_REVIEW` applies only to orders with at least one `requiresProduction` line. Stock-only
orders go `CONFIRMED -> READY -> SHIPPED`.

8.4 Cancellation:

- A customer may cancel while in `AWAITING_PAYMENT` or `AWAITING_CONFIRMATION`.
- After `CONFIRMED`, only an admin may cancel, and a reason is required.
- After `IN_PRODUCTION`, an order containing custom lines may be cancelled only by an admin, and
  the UI states that materials are already committed.
- Cancellation releases reserved stock in the same transaction.

8.5 Every transition writes an `order_status_history` row: from, to, actor, timestamp, optional
note, and `isCustomerVisible`. The denormalised `orders.status` and the `*At` columns are updated
in the same transaction. History is append-only.

8.6 `ON_HOLD` records the status it was entered from so it can be released back correctly.

8.7 A transition may require a payload: `SHIPPED` requires a carrier and tracking number,
`CANCELLED` requires a reason, `ON_HOLD` requires a note. Enforced by the state machine, not by
the form.

8.8 Payment status is derived, never set by hand:

```
amountPaid = sum(succeeded payments) - sum(refunds)
paymentStatus = amountPaid == 0                  -> UNPAID
              | amountPaid >= grandTotal         -> PAID
              | amountPaid >= depositRequired    -> DEPOSIT_PAID
              | otherwise                        -> UNPAID
```

Recorded in the same transaction as any payment write.

### 8.9 An order is a single fulfilment unit (V1 limitation)

8.9.1 V1 has **no per-line fulfilment state**. Status, tracking number and carrier live on the
order, not on the line. There is no `order_item_fulfillments` table and none is planned for V1.

8.9.2 **Partial shipment is not a V1 capability.** A mixed order containing a stock item and a
custom item ships once, when everything is ready. The stock item waits for the custom item.

8.9.3 The customer-facing consequence must be stated at checkout, not discovered later: when a
cart mixes stock and custom lines, the delivery estimate shown is the **longest** of the lines,
with an explanatory note. A customer who wants the stock item sooner is told to order it
separately.

8.9.4 Adding per-line fulfilment later is purely additive — a new table plus a derived order
status — and requires no change to `orders` or `order_items`. It is deliberately deferred until
order volume shows it is needed.

### 8.10 Deposit payment flow (V1)

V1 collects deposits **offline**, by bank transfer or CCP. No payment provider is integrated. The
flow is manual by design, and must still be legible to the customer at every step.

```
Order placed with depositRequired > 0
   -> status AWAITING_PAYMENT, no stock reserved, nothing in production
   -> customer shown: amount due now, account details, and the payment reference
   -> customer transfers, then submits proof through the order page
   -> admin reviews the proof in the order workspace
   -> admin records a Payment row (kind DEPOSIT) or rejects with a reason
   -> paymentStatus recomputes -> DEPOSIT_PAID
   -> admin confirms the order -> CONFIRMED, stock reserved, production may begin
```

8.10.1 **The payment reference is the order number.** No separate identifier is generated; one
reference the customer can read aloud on the phone is worth more than a unique token they will
mistype. The customer is instructed to use it as the transfer reference.

8.10.2 **Proof of payment** is an upload against the order — a transfer receipt photograph or
screenshot. It is stored under the same private-file rules as design files
(`SECURITY.md` sections 6 to 8), is never public, and is retained with the order.

8.10.3 **`AWAITING_PAYMENT` means the business has committed nothing.** No stock is reserved, no
materials are ordered, no production begins. This is what makes the state safe to leave open.

8.10.4 **Admin confirmation is explicit.** Recording a payment writes a `payments` row with
`recordedByUserId`, which is what moves `paymentStatus`. An admin never edits `paymentStatus`
directly. Rejecting a proof returns the order to `AWAITING_PAYMENT` with a reason shown to the
customer.

8.10.5 **Unconfirmed payment.** An order in `AWAITING_PAYMENT` past
`settings.custom_orders.depositWindowDays` is flagged in the admin queue for follow-up, and may be
cancelled by an admin with a reason. It is **not** auto-cancelled: a customer who has transferred
money and not yet been credited must not find their order cancelled. Since nothing is reserved,
leaving it open costs the business nothing.

**Open business question — see `tasks/CURRENT.md`.** The bank/CCP account details, whether a CCP
account exists alongside a bank account, the exact wording given to customers, and the value of
`depositWindowDays` all require the owner's input. The flow above is the structure; those values
are not invented here.

---

## 9. Customisation Validation **[DOMAIN]**

A configuration is valid when:

9.1 It names either a catalogue product or a free-text product type, not both, not neither.

9.2 If it names a variant, the variant belongs to the named product and is active.

9.3 The product is customisable (`isCustomizable`) when the configuration originates from a
product page.

9.4 The placement belongs to the applicable customisation profile, or a custom placement note is
present.

9.5 The embroidery size belongs to the profile, or explicit dimensions are within the placement's
`maxWidthMm` and `maxHeightMm`.

9.6 Thread colour count is between 1 and the settings maximum (default 8) and matches the number
of joined thread colours.

9.7 At least one of a design file and embroidery text is present. A configuration with neither is
not a configuration.

9.8 Embroidery text is at most 120 characters and requires a font when present.

9.9 Instructions are at most 2000 characters.

9.10 Quantity is between 1 and 999.

9.11 Every attached design file has status `READY` and is owned by the same user.

9.12 A configuration is **frozen** once referenced by an order item, or by **any quote in `SENT`,
`VIEWED` or `ACCEPTED`**. Freezing writes `frozenAt` and the display snapshots. A modification
attempt on a frozen configuration creates a clone (recording `clonedFromConfigId`) and returns the
new ID; it never mutates the original. See section 7.2.1 and ADR-010.

9.13 Rendering rules follow from the freeze. An **unfrozen** configuration renders from the live
reference tables. A **frozen** configuration renders from its snapshot columns only, never from
the reference tables, so a later rename, price change or deactivation cannot alter how a historical
order or quote reads. Reference rows are deactivated (`isActive = false`), never hard-deleted, so
the foreign keys stay resolvable for reporting.

---

## 10. Stock

10.1 Stock is tracked per **variant**, never per product.

10.2 `stockPolicy` governs behaviour:

| Policy          | Behaviour                                                                |
| --------------- | ------------------------------------------------------------------------ |
| `TRACK`         | Availability enforced; reserved on confirmation; decremented on shipment |
| `DONT_TRACK`    | Always available                                                         |
| `MADE_TO_ORDER` | Always available; always sets `requiresProduction` on the line           |

10.3 **Stock is not reserved when an item is added to the cart.** A cart is not a commitment, and
reserving there lets a bot exhaust inventory. Availability is checked at add-to-cart for feedback
and re-checked authoritatively at placement.

10.4 **[DOMAIN]** Reservation happens at order confirmation:

```
available = stockQuantity - reservedQuantity
```

Placement fails if any `TRACK` line exceeds available. The check and the increment of
`reservedQuantity` occur in one statement — `UPDATE ... WHERE stock_quantity - reserved_quantity
>= n` — so two simultaneous orders cannot oversell.

10.4.1 **When the increment happens.** Availability is validated at *every* placement, but the
reservation is taken at placement only for an order entering `AWAITING_CONFIRMATION`. An order
entering `AWAITING_PAYMENT` reserves nothing, because 8.10.3 says the business has committed
nothing until the deposit is confirmed; its reservation is taken on the transition to `CONFIRMED`.
"Order confirmation" in the heading above means that transition. See ADR-022.

10.5 `stockQuantity` is decremented and `reservedQuantity` released when the order ships.
Cancellation before shipment releases the reservation without decrementing.

10.6 Backorder is not supported in V1. An unavailable variant cannot be ordered.

10.7 A variant at or below `lowStockThreshold` appears in the admin's low-stock list. Public
"only N left" messaging is not shown in V1 — it is a pressure tactic that conflicts with the
brand's tone.

10.8 **Blanks used for custom work default to `MADE_TO_ORDER`.** A blank the business sources per
job rather than holds on a shelf must not be stock-tracked, because tracking it turns a sourcing
question into a hard checkout failure. A blank that genuinely is held in quantity may be set to
`TRACK`, and it then consumes stock like any other line. The default is `MADE_TO_ORDER`; `TRACK`
is a deliberate admin choice per product.

### 10.9 A blank becomes unavailable after quote acceptance

The problematic case: the customer accepted a quote, the blank was `TRACK`, and by the time they
check out it is out of stock or the variant has been deactivated.

10.9.1 **Placement must not fail silently or dump the customer at a generic error.** A customer who
has already accepted a quote and committed to a price is owed an explanation and a route forward.

10.9.2 The required behaviour in V1: placement is blocked with a specific, customer-facing message
naming the affected item; the quote-bound cart is preserved rather than discarded; the customer is
offered "Contact us about this order" with the request reference pre-filled; and the admin is
notified so they can resolve it — by restocking, by substituting an equivalent blank at the same
price, or by issuing a revised quote.

10.9.3 **Open business decision — recorded, not invented.** Whether the business substitutes an
equivalent blank automatically, absorbs a price difference, or always reissues a quote is an
operational policy the owner has not yet set. Until they do, V1 implements 10.9.2 — block, explain,
preserve, escalate — and the admin resolves each case by hand. See `tasks/CURRENT.md`.

10.9.4 The exposure is limited by 10.8: with blanks defaulting to `MADE_TO_ORDER`, this case
arises only for products the owner has explicitly chosen to stock-track.

### 10.10 Manual stock adjustments

10.10.1 Staff may change a variant's `stockQuantity` directly, from `/admin/stock`. Every such
change is a **signed delta with a reason**, written to `inventory_adjustments` in the same
transaction (ADR-029). There is no editable quantity field anywhere in the application.

10.10.2 **[DOMAIN]** Two conditions are refused, and both are enforced by the `UPDATE`'s own
`WHERE` clause rather than by a check performed a moment earlier:

```
stock_quantity + delta >= 0
stock_quantity + delta >= reserved_quantity
```

The first keeps a count from becoming a number that makes every downstream availability
calculation silently wrong. The second protects units already promised to orders that exist —
removing them would either violate the `reserved_quantity <= stock_quantity` check constraint or
quietly unsell an order a customer may have paid a deposit on. The operator is told to cancel the
order first, because that is the operation that actually releases the units.

10.10.3 An adjustment **never** changes `reservedQuantity`. 10.4 takes a reservation and 10.5
releases it; nothing on the stock screen may.

10.10.4 A variant is created with `stockQuantity = 0` and stocked through an adjustment, so the
first units on a shelf carry a ledger row like every other movement.

10.10.5 Reasons are a closed set: `RECEIVED`, `COUNT`, `DAMAGED`, `RETURNED`, `CORRECTION`. A
free-text reason is a reason nobody can group, and grouping is the only reason to keep a ledger.

---

## 11. Product Availability

11.1 A product is publicly visible only when `status = ACTIVE`, `publishedAt` is in the past and
`deletedAt` is null.

11.2 A product is purchasable only when it is visible **and** has at least one active variant that
is available under its stock policy.

11.3 A visible product with no purchasable variant renders as "Currently unavailable" with the
variant selector disabled. It is not hidden — it retains SEO value and can be linked to.

11.4 An archived product keeps its URL and returns 410 Gone with a link to its category, so search
engines de-index it cleanly instead of 404-ing.

11.5 Draft products are visible to admins only, through a signed preview link.

11.6 A slug change writes a `product_redirects` row and the old URL 301s permanently.

---

## 11A. Reviews

11A.1 A review requires an **authenticated user** with a **delivered** order containing the
product. `isVerifiedPurchase` is therefore always true in V1, and `orderItemId` is always set.

11A.2 One review per customer per product, enforced by a partial unique index.

11A.3 Reviews are `PENDING` until moderated; only `APPROVED` reviews are publicly visible.
Moderation recomputes the product's denormalised rating in the same transaction.

11A.5 **[DOMAIN]** A review body is between 20 and 2000 characters after trimming, and a title, if
given, is at most 120. Phase 13 chose these: the floor exists because "super" tells a reader
nothing, the ceiling because a public write into an unbounded text column is a way to fill a
database. They live in `domain/review` so the form, the server action and the tests read the same
numbers.

11A.6 The rating a product carries is **recomputed from its approved reviews**, never adjusted
incrementally — an incremental update is how a denormalised aggregate drifts from the rows it
summarises with nothing to notice. `products.ratingAverage` is the mean × 100 and is null, not
zero, when there are no approved reviews.

11A.7 Moderation is applied with a **conditional update on the status the moderator was looking
at**, so two moderators acting at once cannot both believe they decided. The second is told the
review moved.

### 11A.4 Guest purchasers cannot review (accepted consequence)

A guest order has `userId` null, so **a guest purchaser cannot leave a review** unless they first
claim the order into an account. This follows directly from ADR-005 and is deliberately not
changed in V1:

- Every review carries a verified purchase, which is the entire basis for trusting ratings on a
  small catalogue where a handful of fabricated reviews would be decisive.
- Guest reviewing would require identifying the reviewer by order number and phone — an
  unauthenticated write path onto public content, and an obvious spam and impersonation surface.

The mitigation is the claim flow, not a policy change: the order confirmation and the guest
order-tracking page both offer "create an account to review this order", pre-filled from the
order. The path from guest purchase to review exists; it passes through authentication.

11.9 **A category with live products may not be hidden.** Switching `is_active`
off takes a category out of the chip row and makes `/shop/c/<slug>` a 404, while
the products inside it keep their own pages and keep selling — a shelf nobody can
reach that is still being stocked. The predicate is `mayDeactivateCategory` and
the count is taken against the database at save time, not from the figure the
form was rendered with. Unpublishing or moving the products first is the way
through, and it is a decision somebody makes on purpose. See ADR-039.

11.10 **A renamed category leaves no redirect**, unlike a renamed product
(11.6). A product URL is what a customer is sent and what a search engine ranks;
a category listing is navigation, reachable from every catalogue page, so the old
address simply 404s. Renaming one is cheap and rare; a second redirect table for
it would be machinery for a URL nobody bookmarks.

11.12 **The catalogue is translated by an overlay, and an untranslated field reads in French.**
`products`, `categories`, `gallery_items` and `banners` each carry a `translations` column holding
`{"<locale>": {"<column>": "…"}}`. French lives in the row's own columns and is the source of
truth; the overlay supplies what it has, **field by field**, so a product with an English name and
no English description is correct rather than half-blank. A blank overlay field means "not
translated" on the way in and on the way out — there is no way to translate something to nothing.
Which fields may be translated is a closed list in `domain/translation`, because the overlay is
written by a form and merging it wholesale would be a way to set a price. See ADR-040.

11.13 **Translation changes what a row says, never which rows there are.** Visibility, pricing,
availability and ordering are computed from the French columns in both languages. A search made in
English also matches the English name; a draft with an English overlay is still a draft.

11.11 **A narrowed catalogue is a view, not a page.** `/shop` and each
`/shop/c/<slug>` are indexable; a search, an order or a page number is
`noindex, follow` and canonicalises to the listing it narrows. Filtering,
ordering and pagination all happen in the query, so the count shown beside the
filters is the count the database returned. See ADR-039.

---

## 12. Permissions

12.1 Roles: `CUSTOMER`, `STAFF`, `ADMIN`. Roles are not hierarchical in code; each permission is
checked explicitly.

| Capability                               | CUSTOMER  | STAFF | ADMIN |
| ---------------------------------------- | --------- | ----- | ----- |
| Browse catalogue, place orders           | yes (own) | yes   | yes   |
| View own orders, requests, quotes, files | yes       | —     | —     |
| Accept or reject a quote                 | yes (own) | no    | no    |
| View any customer's order                | no        | yes   | yes   |
| Change order status                      | no        | yes   | yes   |
| Download a design file                   | own only  | yes   | yes   |
| Create and send a quote                  | no        | yes   | yes   |
| Manage products and categories           | no        | yes   | yes   |
| Adjust stock on hand                     | no        | yes   | yes   |
| Moderate reviews                         | no        | yes   | yes   |
| Archive and restore records              | no        | yes   | yes   |
| Manage the gallery and content           | no        | yes   | yes   |
| Manage coupons                           | no        | no    | yes   |
| Manage settings and shipping rates       | no        | no    | yes   |
| Manage users and roles                   | no        | no    | yes   |
| Read audit logs                          | no        | no    | yes   |

12.2 **[DOMAIN]** Permission predicates are pure functions over `(actor, resource)`. Nothing
checks a role inline in a component.

12.3 Only a customer may accept a quote. An admin accepting on a customer's behalf would destroy
the meaning of acceptance; where it is operationally necessary, the admin records a new quote at
the agreed price and the customer accepts it.

12.4 An admin cannot demote or delete their own account, and the last `ADMIN` cannot be removed.

12.5 Every admin access to a design file or to customer PII writes an audit log entry.

12.6 **Archiving is not deleting.** The workshop may take an order, a request, a quote or a review
off its own lists; the row stays in the table, the customer's screens are unchanged, and restoring
is one click. It is a staff capability precisely because it is reversible. A product archives
through its own status instead, and a **published** product may not be archived from a bulk
selection — unpublishing has a customer-visible effect and stays on the product's screen. At most
100 rows move per act, and each batch writes one audit entry. See ADR-034.


12.7 **Two settings change what everybody may do, and both are admin-only.**

- `site.storefrontEnabled`, off, closes the public shop to **everybody**, staff included: the
  catalogue, the builder, the cart, the checkout and the customer's account are replaced by a
  page that says the workshop is still there. `/admin` is untouched, and so is `/login` — closing
  the shop must not be able to lock the owner out of it. The switch takes effect on the next
  request, not on a timer. See ADR-038.
- `accounts.emailVerificationRequired`, off, treats every signed-in customer as though their
  address were confirmed. It exists because a shop with no mail provider configured cannot send a
  confirmation, and a requirement nobody can satisfy is a shop that cannot take an order. With it
  off, the account screen stops asking for a confirmation as well — a chore with no consequence is
  worse than no chore.

Every permission predicate that cares takes the policy as an argument
(`requiresEmailVerification(actor, policy)`); none of them reads a setting for itself, which is
what keeps them pure and testable (12.2).

12.8 The bounds on an editable setting are business rules and live in `domain/settings`, not in
the table. A deposit outside 0–100 %, a response time of zero hours or a blank shop name is
refused by the same function on the screen and on the server. See ADR-037.

---

## 13. File Rules

Security enforcement is in `SECURITY.md` sections 6 to 8. The business rules:

13.1 Accepted types: PNG, JPG/JPEG, SVG, PDF. Nothing else, on any path.

13.2 Limits: 25 MB per file, 5 files per configuration, 50 MB per request in total. Configurable
in settings; the hard ceiling is enforced in the domain layer regardless.

13.3 **[DOMAIN]** A file is usable only in status `READY`. `PENDING`, `REJECTED` and
`QUARANTINED` files cannot be attached to a submitted request or an order.

13.4 A raster below 300 px on its shortest side produces a **warning**, not a rejection. The owner
decides what is workable; the platform does not refuse business.

13.5 Design files are **private by default**, always. There is no setting that makes the private
bucket public.

13.6 A design may appear in the public gallery only when the customer has given explicit consent,
recorded as `customerConsentAt`, and only as a separately uploaded public image. The private
original is never served publicly, even with consent.

13.7 Files are retained for 24 months after the last order that references them, then eligible for
deletion. Orphaned uploads with no configuration after 7 days are deleted by the cleanup job.

13.8 A customer may delete a saved design that is not referenced by any order. A referenced file is
soft-deleted from the library but retained for the order record.

---

## 14. Customer Ownership

14.1 A customer may read and act on exactly the rows they own, as classified in
`DATABASE.md` section 15.

14.2 **[DOMAIN]** Ownership checks are part of the query, not a post-fetch comparison. A repository
never loads a row and then compares `userId`.

14.3 A request for a resource owned by someone else returns **not found**, never forbidden. A
forbidden response confirms the resource exists.

14.4 Guest access is limited to: the confirmation page via a single-use `guestToken`, and the
order lookup by order number plus the phone on the order, rate-limited and audit-logged.

14.5 A guest order is claimed by an account when the account's verified email matches the order's
`contactEmail`, and only through the explicit post-purchase claim flow.

14.6 Account deletion anonymises `users` (email, phone, name replaced with tombstones) and retains
orders for legal and accounting purposes. Design files are deleted unless referenced by a
retained order.

14.7 An admin's own customer account, if any, is subject to the same customer rules. Role does not
grant ownership.

---

## 15. Admin Behaviour

15.1 Admin mutations pass through the same services, validation and state machines as customer
mutations. There is no privileged bypass path.

15.2 An admin may not edit an order's line prices after placement. Corrections are made by
cancelling and reissuing, or by recording a discount line, so the audit trail stays intact.

15.3 An admin may not edit a sent quote. Revision creates a version.

15.4 Internal notes are never returned by a customer-scoped query, at the DTO layer.

15.5 Deleting a product with orders is prohibited; it is archived. Deleting a category with
products is prohibited; the products are reassigned first.

15.6 Reviews are `PENDING` until moderated. Only `APPROVED` reviews are publicly visible.
Moderation recomputes the product's denormalised rating in the same transaction.

15.7 Publishing a gallery item sourced from a customer design requires the consent flag (13.6).

15.8 Settings changes take effect immediately and invalidate the settings cache. Changing a price
rule does not retroactively alter placed orders — snapshots protect them.

15.9 Every status change, quote send, file download, PII view and settings change is audit-logged
with the acting user.

---

## 16. Centralisation Requirements

The following must exist exactly once, in `domain/`, as pure, unit-tested functions. Duplicating
any of them anywhere in the codebase is a defect, regardless of whether the duplicate is correct.

| Rule                                             | Module                 | Consumers                                          |
| ------------------------------------------------ | ---------------------- | -------------------------------------------------- |
| Unit price resolution                            | `domain/pricing`       | product page, cart, checkout, admin, quote builder |
| Customisation surcharges                         | `domain/pricing`       | builder estimate, cart, quote builder              |
| Pricing-mode determination                       | `domain/request`       | builder, request service, admin                    |
| Estimate range                                   | `domain/pricing`       | builder, request record                            |
| Quantity discount tiers                          | `domain/discount`      | cart, quote builder                                |
| Coupon eligibility and application               | `domain/discount`      | cart, checkout                                     |
| Shipping resolution                              | `domain/shipping`      | cart, checkout, quote builder                      |
| **Quote line to order line mapping (2.6.5)**     | `domain/quote`         | quote acceptance, order placement                  |
| **Quote-bound cart rules (5A)**                  | `domain/cart`          | cart, checkout, order placement                    |
| **Acceptance validity (7.10)**                   | `domain/quote`         | cart, checkout, expiry job                         |
| **Configuration freeze and clone (7.2.1, 9.12)** | `domain/customization` | quote send, builder edit, reorder                  |
| Order totals pipeline                            | `domain/order`         | cart, checkout, order placement, admin             |
| Deposit calculation                              | `domain/order`         | checkout, payment, admin                           |
| Order state machine                              | `domain/order`         | admin, system transitions, webhooks                |
| Request state machine                            | `domain/request`       | builder, admin, cron                               |
| Quote state machine                              | `domain/quote`         | admin, customer accept/reject, cron                |
| Quote totals                                     | `domain/quote`         | quote builder, quote view, order creation          |
| Configuration validation                         | `domain/customization` | builder, request service, order service            |
| File policy predicates                           | `domain/files`         | upload presign, upload complete, admin             |
| Permission predicates                            | `domain/permissions`   | every action wrapper, every admin route            |
| Stock availability                               | `domain/order`         | product page, cart, order placement                |
| **Review eligibility and rating arithmetic (11A)** | `domain/review`      | account review form, moderation, product page      |
| **Gallery consent (13.6)**                       | `domain/gallery`       | gallery publication, gallery listing               |
| **Homepage section ordering and config**         | `domain/content`       | homepage composition, content service              |

### Required test coverage

Each of the above needs unit tests covering: the normal case, every boundary in the rule
(threshold quantities, exact free-shipping amounts, expiry at the second), every rejection path,
and rounding behaviour where money is divided. State machines additionally need a test asserting
that **every** transition not in the allowed map is rejected — a table-driven test over the full
cross product, so a later addition to an enum cannot silently open a path.

Three additional tests are mandatory because they guard invariants that are cheap to break and
expensive to discover in production:

1. **Quote-to-order reconciliation.** For a quote containing every line kind — product,
   embroidery, setup fee, digitising, rush, shipping and discount — the order built from its
   acceptance must have `grandTotal` exactly equal to `quote.grandTotal`, with fees present as
   distinct `FEE` lines and shipping and discount landing in the order's totals rather than in
   line items.
2. **Freeze immutability.** Sending a quote freezes its configurations and populates every
   snapshot column; a subsequent edit produces a clone and leaves the original byte-identical;
   deactivating or renaming the referenced reference rows does not change how the frozen
   configuration renders.
3. **Quote-bound cart isolation.** A quote-bound cart rejects added items, quantity edits and
   coupons, and does not participate in the guest-cart merge.
