// The treasurer's routine, no LLM involved. Every tick, for each circle a
// group follows:
//   - announce new payments in the current round
//   - settle with the treasurer key as soon as the contract allows it
//   - announce every settled round, whoever settled it
//   - remind unpaid members once before the deadline and once after it
//   - announce the end of the circle
// Times come from block time (`now_ms`), the same clock the contract uses.

import type { Circle, Ledger, RoundStatus } from "./ledger.ts";
import type { Store } from "./store.ts";
import { esc, span, txLink, usdc, utc, who } from "./format.ts";

export type Notify = (chatId: number, html: string) => Promise<void>;

/** Remind this long before the deadline (at most half a round). */
const REMIND_BEFORE_MS = 30 * 60_000;

export class Scheduler {
  private readonly ledger: Ledger;
  private readonly store: Store;
  private readonly notify: Notify;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(ledger: Ledger, store: Store, notify: Notify) {
    this.ledger = ledger;
    this.store = store;
    this.notify = notify;
  }

  start(intervalMs: number): void {
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** One pass over every followed circle. Overlapping ticks are skipped. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const circles = new Set(Object.values(this.store.state.groups).map((g) => g.circleId));
      for (const id of circles) {
        try {
          await this.check(id);
        } catch (e) {
          console.error(`scheduler: circle ${id}: ${e instanceof Error ? e.message : e}`);
        }
      }
    } finally {
      this.store.save();
      this.running = false;
    }
  }

  private async post(circleId: string, html: string): Promise<void> {
    for (const chat of this.store.chatsFor(circleId)) await this.notify(chat, html);
  }

  private async check(id: string): Promise<void> {
    let status = await this.ledger.roundStatus(id);
    const watch = this.store.watch(id);

    if (status.status === "Active") {
      const seen = (watch.paid[status.round] ??= []);
      const fresh = status.paid.filter((a) => !seen.includes(a));
      if (fresh.length) {
        seen.push(...fresh);
        const names = fresh.map((a) => who(a, this.store)).join(", ");
        await this.post(id, `💸 ${names} paid round ${status.round + 1} (${status.paid.length} of ${status.paid.length + status.unpaid.length}).`);
      }
    }

    if (status.status === "Active" && status.can_settle) {
      const out = await this.ledger.settle(id);
      if (out.status === "ok" && out.hash) {
        this.store.state.settleTx[`${id}:${status.round}`] = { hash: out.hash, url: out.url };
      } else {
        console.error(`scheduler: settle ${id} round ${status.round}: ${out.status}: ${out.error}`);
      }
      status = await this.ledger.roundStatus(id);
    }

    const circle = await this.ledger.circle(id);
    if (!circle) return;
    for (const rec of circle.history.slice(watch.announced)) {
      await this.post(id, this.settledText(circle, rec.round));
      watch.announced++;
    }

    if (status.status === "Active" && !status.can_settle && status.unpaid.length) {
      await this.remind(id, circle, status);
    }

    if ((status.status === "Completed" || status.status === "Dissolved") && !watch.ended) {
      watch.ended = true;
      await this.post(
        id,
        status.status === "Completed"
          ? `🏁 <b>${esc(circle.name)}</b> is complete: ${circle.history.length} rounds, every member received the pot once. Bonds left over were returned.`
          : `🛑 <b>${esc(circle.name)}</b> was dissolved by unanimous vote; this round's contributions and all bonds were refunded.`,
      );
    }
  }

  private async remind(id: string, circle: Circle, s: RoundStatus): Promise<void> {
    const sent = (this.store.watch(id).reminded[s.round] ??= []);
    const unpaid = s.unpaid.map((a) => who(a, this.store)).join(", ");
    const lead = Math.min(REMIND_BEFORE_MS, (circle.round_duration_sec * 1000) / 2);
    if (s.now_ms > s.deadline_ms) {
      if (sent.includes("overdue")) return;
      sent.push("overdue");
      await this.post(
        id,
        `⚠️ Round ${s.round + 1} is past its deadline. Still unpaid: ${unpaid}.\n` +
          `Grace period ends at ${utc(s.grace_ends_ms)} (in ${span(s.grace_ends_ms - s.now_ms)}). Then I settle with what was collected; ` +
          `each missed payment is recorded and up to one contribution of that member's bond goes into the pot.`,
      );
    } else if (s.deadline_ms - s.now_ms <= lead) {
      if (sent.includes("due")) return;
      sent.push("due");
      await this.post(
        id,
        `⏰ Round ${s.round + 1} is due at ${utc(s.deadline_ms)} (in ${span(s.deadline_ms - s.now_ms)}). ` +
          `Still unpaid: ${unpaid}. Pay ${usdc(circle.contribution)} with /pay.`,
      );
    }
  }

  settledText(circle: Circle, round: number): string {
    const rec = circle.history[round];
    const tx = this.store.state.settleTx[`${circle.id}:${round}`];
    let text = `✅ Round ${round + 1} of ${circle.order.length} settled: <b>${usdc(rec.amount)}</b> paid to ${who(rec.recipient, this.store)}.`;
    if (rec.missed.length) {
      const missed = rec.missed
        .map((a) => `${who(a, this.store)}${circle.order.indexOf(a) < round ? " (default: already received the pot)" : ""}`)
        .join(", ");
      text += `\nMissed by ${missed}. ${usdc(rec.slashed)} of bond was slashed into the pot.`;
    }
    text += `\nSettled by ${esc(rec.settled_by)}${tx ? ` · tx ${txLink(tx.hash, tx.url)}` : ""}`;
    if (rec.payout === "Claimable") text += `\nThe transfer failed, so the amount is claimable by ${esc(rec.recipient)} only.`;
    return text;
  }
}
