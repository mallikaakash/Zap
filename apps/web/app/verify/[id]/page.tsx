"use client";

import { use } from "react";
import { api, short, usd } from "@/lib/client";
import { Logo, Notice, Pill, SimBadge, Spinner, usePoll } from "@/components/ui";
import type { Receipt } from "@/lib/types";

interface Verify {
  receipt: Receipt;
  contract: string;
  networkId: string;
  mode: string;
  attribution: { orderRefHash: string; matches: boolean; amountMatches: boolean; mintTxHash: string | null; direct: boolean } | null;
  contractTotals: { allocated: string; inFlightTotal: string; usdcBalance: string; paused: boolean };
  refunds: Array<{ amount: string; quoteId: string | null; depositAccount: string | null; txHash: string | null; payoutState: string; amountOutFormatted: string | null; simulated: boolean; quotedRecipient: string | null; recipientMatchesTarget: boolean | null }>;
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-4 border-b border-line py-2.5 text-sm last:border-b-0">
    <span className="text-muted">{k}</span>
    <span className="text-right font-medium break-all">{children}</span>
  </div>
);

/** Public page: lets anyone check what the settlement executor did with a receipt. */
export default function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: v, error } = usePoll(() => api<Verify>(`/api/verify/${id}`), 5000, [id]);
  const covered = v ? BigInt(v.contractTotals.usdcBalance) >= BigInt(v.contractTotals.allocated) : true;
  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-10">
      <div className="flex justify-center"><a href="/"><Logo /></a></div>
      {error && !v ? <Notice tone="bad">{error}</Notice> : null}
      {!v && !error ? <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Checking the chain…</p> : null}
      {v ? (
        <>
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-semibold">Verify receipt #{v.receipt.id}</h1>
              <SimBadge mode={v.mode} />
            </div>
            <p className="mt-1 text-sm text-muted">Read from contract <span className="mono">{v.contract}</span> on {v.networkId}. The executor attributes payments to orders and passes refund deposit addresses; this page shows what it did so anyone can check.</p>
            <div className="mt-4">
              <Row k="Amount">{usd(v.receipt.amount)}</Row>
              <Row k="Paid to shop / refunded">{usd(v.receipt.released)} / {usd(v.receipt.refunded)}</Row>
              <Row k="Refund target (on chain)"><span className="mono">{short(v.receipt.refundTarget.address, 12, 10)}</span> · {v.receipt.refundTarget.chain}</Row>
              <Row k="Order reference (hash)"><span className="mono">{short(v.receipt.orderRef, 10, 10)}</span></Row>
              {v.attribution ? (
                <>
                  <Row k="Matches the shop's order">{v.attribution.matches ? <Pill tone="good">Yes</Pill> : <Pill tone="bad">No</Pill>}</Row>
                  <Row k="Amount matches the order">{v.attribution.amountMatches ? <Pill tone="good">Yes</Pill> : <Pill tone="bad">No</Pill>}</Row>
                  <Row k="How it was paid">{v.attribution.direct ? "USDC sent straight to the contract" : "Swap delivered to the contract; executor minted the receipt"}</Row>
                </>
              ) : (
                <Row k="Order record">Not found off chain</Row>
              )}
            </div>
          </div>

          <div className="card p-6">
            <h2 className="text-sm font-semibold">Refund payouts</h2>
            {v.refunds.length === 0 ? <p className="mt-2 text-sm text-muted">No refund has left this receipt.</p> : null}
            {v.refunds.map((f, i) => (
              <div key={i} className="mt-3 rounded-xl border border-line px-3.5">
                <Row k="Left escrow">{usd(f.amount)}</Row>
                <Row k="Sent to (deposit account)"><span className="mono">{short(f.depositAccount, 12, 10)}</span></Row>
                <Row k="Quote id"><span className="mono">{short(f.quoteId, 14, 8)}</span></Row>
                <Row k="Delivers">{f.amountOutFormatted ?? "—"} → <span className="mono">{short(f.quotedRecipient, 10, 8)}</span></Row>
                <Row k="Recipient = refund target">
                  {f.simulated ? <Pill tone="warn">Simulated swap, not checkable</Pill> : f.recipientMatchesTarget === true ? <Pill tone="good">Yes</Pill> : f.recipientMatchesTarget === false ? <Pill tone="bad">No</Pill> : <Pill>Unknown</Pill>}
                </Row>
                <Row k="State">{f.payoutState}</Row>
              </div>
            ))}
          </div>

          <div className="card p-6">
            <h2 className="text-sm font-semibold">Contract solvency</h2>
            <div className="mt-2">
              <Row k="USDC held by the contract">{usd(v.contractTotals.usdcBalance)}</Row>
              <Row k="Owed to open receipts">{usd(v.contractTotals.allocated)}</Row>
              <Row k="Transfers in flight">{usd(v.contractTotals.inFlightTotal)}</Row>
              <Row k="Every receipt is covered">{covered ? <Pill tone="good">Yes</Pill> : <Pill tone="bad">No</Pill>}</Row>
              <Row k="Paused">{v.contractTotals.paused ? <Pill tone="warn">Yes · refunds still work</Pill> : "No"}</Row>
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
