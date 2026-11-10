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
import { esc, receipt, short, span, usdc, utc, whoList } from "./format.ts";

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
        const total = status.paid.length + status.unpaid.length;
        await this.post(id, `💸 ${whoList(fresh, this.store)} paid for round ${status.round + 1}.\n${status.paid.length} of ${total} members have paid.`);
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
          ? `🏁 <b>${esc(circle.name)}</b> is complete!\n\nAll ${circle.history.length} rounds are done, and every member received the pot once. Any deposits left over were returned.`
          : `🛑 <b>${esc(circle.name)}</b> was closed by a vote of all members.\n\nEveryone got back this round's payments and their deposits.`,
      );
    }
  }

  private async remind(id: string, circle: Circle, s: RoundStatus): Promise<void> {
    const sent = (this.store.watch(id).reminded[s.round] ??= []);
    const unpaid = whoList(s.unpaid, this.store);
    const lead = Math.min(REMIND_BEFORE_MS, (circle.round_duration_sec * 1000) / 2);
    if (s.now_ms > s.deadline_ms) {
      if (sent.includes("overdue")) return;
      sent.push("overdue");
      await this.post(
        id,
        `⚠️ Round ${s.round + 1} is past its deadline.\n\n` +
          `Still to pay: ${unpaid}\n\n` +
          `There's a short grace period until ${utc(s.grace_ends_ms)} (${span(s.grace_ends_ms - s.now_ms)} from now). ` +
          `After that I'll pay out what was collected. A missed payment goes on that member's record, ` +
          `and up to ${usdc(circle.contribution)} is taken from their deposit and added to the pot.`,
      );
    } else if (s.deadline_ms - s.now_ms <= lead) {
      if (sent.includes("due")) return;
      sent.push("due");
      await this.post(
        id,
        `⏰ Reminder: round ${s.round + 1} is due in ${span(s.deadline_ms - s.now_ms)} (${utc(s.deadline_ms)}).\n\n` +
          `Still to pay: ${unpaid}\n\n` +
          `Each member pays ${usdc(circle.contribution)}. Type /pay to see how.`,
      );
    }
  }

  settledText(circle: Circle, round: number): string {
    const rec = circle.history[round];
    const tx = this.store.state.settleTx[`${circle.id}:${round}`];
    const lines = [`✅ Round ${round + 1} of ${circle.order.length} is paid out!`, "", `${whoList([rec.recipient], this.store)} received <b>${usdc(rec.amount)}</b>.`];
    if (rec.missed.length) {
      const names = whoList(rec.missed, this.store);
      const one = rec.missed.length === 1;
      const slashed = BigInt(rec.slashed);
      lines.push(
        "",
        `❗ ${names} didn't pay this round.` +
          (slashed > 0n
            ? ` ${usdc(slashed)} was taken from ${one ? "their deposit" : "their deposits"} and added to the pot.`
            : ` There was no deposit to take from, so the pot is smaller.`),
      );
      const defaulted = rec.missed.filter((a) => circle.order.indexOf(a) < round);
      if (defaulted.length) {
        lines.push(`${whoList(defaulted, this.store)} already had ${defaulted.length === 1 ? "their turn" : "their turns"}, so this counts as a default on ${defaulted.length === 1 ? "their record" : "their records"}.`);
      } else {
        lines.push(`It's noted on ${one ? "their record" : "their records"} as a missed payment.`);
      }
    }
    if (rec.payout === "Claimable") lines.push("", `The transfer didn't go through, so the money is waiting for ${esc(short(rec.recipient))} to claim it.`);
    lines.push("", rec.settled_by === this.ledger.treasurerId ? "Paid out by me, the treasurer." : `Paid out by ${esc(short(rec.settled_by))}.`);
    if (tx) lines.push(receipt(tx.hash, tx.url));
    return lines.join("\n");
  }
}
