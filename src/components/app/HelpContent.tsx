const FARMER = [
  ["Is my request a booking?", "No. A request asks providers for quotes. The work is booked once you accept a quote and your payment is in."],
  ["How do I pay?", "Pay the way agreed with Sagora and keep your receipt. The Sagora team records it, and your request shows what has arrived."],
  ["Can I change my request?", "Yes, until a provider sends a quote. Open the request and choose Edit request."],
  ["What if the work is not done properly?", "When the provider reports the work, you can confirm it or raise a concern. Nothing is settled until you confirm."],
];

const PROVIDER = [
  ["How do I get requests?", "Once Sagora approves your business, requests appear under Requests. Send a quote from the request itself."],
  ["Can one machine go on two jobs?", "No. A machine already committed for those dates is refused when you schedule a job."],
  ["When am I paid?", "After the farmer confirms the work. A reported job is not a confirmed one. Approved money shows in your wallet."],
  ["What if a machine breaks down?", "Report a fault on the machine. A blocking fault flags its jobs as at risk and keeps the commitment on record."],
];

/** Answers taken from how the product actually behaves, so they cannot promise anything else. */
export function HelpContent({ audience }: { audience: "farmer" | "provider" }) {
  return (
    <dl className="help">
      {(audience === "farmer" ? FARMER : PROVIDER).map(([q, a]) => (
        <div key={q}><dt>{q}</dt><dd>{a}</dd></div>
      ))}
    </dl>
  );
}
