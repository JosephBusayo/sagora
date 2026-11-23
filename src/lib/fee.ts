/**
 * Sagora's service fee.
 *
 * Its own module, and deliberately importing nothing: both the quote side and the payout side need
 * it, and those two already import each other's neighbours. A policy with no dependencies can sit
 * under both without a cycle.
 *
 * **The fee is added to the farmer's total, never deducted from the provider.** Karim's handover of
 * 23 November 2026 is explicit about it, including the arithmetic people get wrong:
 *
 *     Provider service price                  2,000
 *     Sagora service fee paid by farmer, 10%    200
 *     Farmer total                            2,200
 *     Provider service amount                 2,000
 *
 *   "Add 10% to the provider price; do not deduct it from the provider or calculate 2,020."
 *
 * The 2,020 it warns against is the mistake of taking 10% of the farmer's total rather than the
 * provider's price. The percentage is of the provider's price, full stop.
 *
 * This reverses what the code did until now, which took 10% out of the provider's payout — so a
 * provider quoting 2,000 received 1,800 and the farmer paid 2,000. The fee a farmer is charged is
 * frozen onto the agreement when they accept, so changing the number here never alters a total
 * somebody has already agreed to.
 */

/**
 * The pilot policy. During the pilot there is no provider subscription and no charge to the
 * provider at all: "no provider subscription or Sagora provider charge during the pilot."
 *
 * Setting `approved` to false stops the fee being added to new agreements without touching any
 * total already agreed.
 */
export const FEE_POLICY = { approved: true, percent: 10 };

/**
 * Sagora's fee on one provider price.
 *
 * Rounds up, so the farmer's total never comes out a minor unit short of provider price plus fee
 * and the two halves always sum to exactly what was charged.
 */
export function serviceFeeOn(providerAmountMinor: number): number {
  if (!FEE_POLICY.approved) return 0;
  if (providerAmountMinor <= 0) return 0;
  return Math.ceil((providerAmountMinor * FEE_POLICY.percent) / 100);
}

/** What the farmer pays: the provider's price with Sagora's fee on top. */
export const farmerTotal = (providerAmountMinor: number, feeMinor: number) => providerAmountMinor + feeMinor;
