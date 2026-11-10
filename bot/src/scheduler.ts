// The treasurer's routine, no LLM involved. Every tick, for each circle a
// group follows:
//   - announce new payments in the current round
//   - settle with the treasurer key as soon as the contract allows it
//   - announce every settled round, whoever settled it
//   - remind unpaid members once before the deadline and once after it
//   - announce the end of the circle
// Times come from block time (`now_ms`), the same clock the contract uses.

import type { Circle, Ledger, RoundStatus } from "./ledger.ts";
import type { Net, Store } from "./store.ts";
import { esc, receipt, short, span, usdc, utc, whoList } from "./format.ts";

export type Notify = (chatId: number, html: string) => Promise<void>;
export type Ledgers = Partial<Record<Net, Ledger>>;

/** " · testnet" or " · mainnet": every circle message says which network it's about. */
export const netTag = (net: Net) => ` · ${net}`;

/** Remind this long before the deadline (at most half a round). */
const REMIND_BEFORE_MS = 30 * 60_000;

export class Scheduler {
  private readonly ledgers: Ledgers;
  private readonly store: Store;
  private readonly notify: Notify;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(ledgers: Ledgers, store: Store, notify: Notify) {
    this.ledgers = ledgers;
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
      const circles = new Set(Object.values(this.store.state.groups).map((g) => `${g.network}:${g.circleId}`));
      for (const key of circles) {
        const [net, id] = key.split(":") as [Net, string];
        const ledger = this.ledgers[net];
        if (!ledger) continue;
        try {
          await this.check(net, ledger, id);
        } catch (e) {
          console.error(`scheduler: ${net} circle ${id}: ${e instanceof Error ? e.message : e}`);
        }
      }
    } finally {
      this.store.save();
      this.running = false;
    }
  }

  private async post(net: Net, circleId: string, html: string): Promise<void> {
    for (const chat of this.store.chatsFor(net, circleId)) await this.notify(chat, html);
  }

  private async check(net: Net, ledger: Ledger, id: string): Promise<void> {
    let status = await ledger.roundStatus(id);
    const watch = this.store.watch(net, id);

    if (status.status === "Active") {
      const seen = (watch.paid[status.round] ??= []);
      const fresh = status.paid.filter((a) => !seen.includes(a));
      if (fresh.length) {
        seen.push(...fresh);
        const total = status.paid.length + status.unpaid.length;
        await this.post(net, id, `💸 ${whoList(fresh, this.store)} paid for round ${status.round + 1}${netTag(net)}.\n${status.paid.length} of ${total} members have paid.`);
      }
    }

    if (status.status === "Active" && status.can_settle) {
      const out = await ledger.settle(id);
      if (out.status === "ok" && out.hash) {
        this.store.recordSettle(net, id, status.round, { hash: out.hash, url: out.url });
      } else {
        console.error(`scheduler: settle ${net} ${id} round ${status.round}: ${out.status}: ${out.error}`);
      }
      status = await ledger.roundStatus(id);
    }

    const circle = await ledger.circle(id);
    if (!circle) return;
    for (const rec of circle.history.slice(watch.announced)) {
      await this.post(net, id, this.settledText(net, circle, rec.round));
      watch.announced++;
    }

    if (status.status === "Active" && !status.can_settle && status.unpaid.length) {
      await this.remind(net, id, circle, status);
    }

    if ((status.status === "Completed" || status.status === "Dissolved") && !watch.ended) {
      watch.ended = true;
      await this.post(
        net,
        id,
        status.status === "Completed"
          ? `🏁 <b>${esc(circle.name)}</b>${netTag(net)} is complete!\n\nAll ${circle.history.length} rounds are done, and every member received the pot once. Any deposits left over were returned.`
          : `🛑 <b>${esc(circle.name)}</b>${netTag(net)} was closed by a vote of all members.\n\nEveryone got back this round's payments and their deposits.`,
      );
    }
  }

  private async remind(net: Net, id: string, circle: Circle, s: RoundStatus): Promise<void> {
    const sent = (this.store.watch(net, id).reminded[s.round] ??= []);
    const unpaid = whoList(s.unpaid, this.store);
    const lead = Math.min(REMIND_BEFORE_MS, (circle.round_duration_sec * 1000) / 2);
    if (s.now_ms > s.deadline_ms) {
      if (sent.includes("overdue")) return;
      sent.push("overdue");
      await this.post(
        net,
        id,
        `⚠️ Round ${s.round + 1} is past its deadline${netTag(net)}.\n\n` +
          `Still to pay: ${unpaid}\n\n` +
          `There's a short grace period until ${utc(s.grace_ends_ms)} (${span(s.grace_ends_ms - s.now_ms)} from now). ` +
          `After that I'll pay out what was collected. A missed payment goes on that member's record, ` +
          `and up to ${usdc(circle.contribution)} is taken from their deposit and added to the pot.`,
      );
    } else if (s.deadline_ms - s.now_ms <= lead) {
      if (sent.includes("due")) return;
      sent.push("due");
      await this.post(
        net,
        id,
        `⏰ Reminder${netTag(net)}: round ${s.round + 1} is due in ${span(s.deadline_ms - s.now_ms)} (${utc(s.deadline_ms)}).\n\n` +
          `Still to pay: ${unpaid}\n\n` +
          `Each member pays ${usdc(circle.contribution)}. Type /pay to see how.`,
      );
    }
  }

  settledText(net: Net, circle: Circle, round: number): string {
    const rec = circle.history[round];
    const tx = this.store.settleTx(net, circle.id, round);
    const treasurer = this.ledgers[net]?.treasurerId;
    const lines = [`✅ Round ${round + 1} of ${circle.order.length} is paid out!${netTag(net)}`, "", `${whoList([rec.recipient], this.store)} received <b>${usdc(rec.amount)}</b>.`];
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
    lines.push("", rec.settled_by === treasurer ? "Paid out by me, the treasurer." : `Paid out by ${esc(short(rec.settled_by))}.`);
    if (tx) lines.push(receipt(tx.hash, tx.url));
    return lines.join("\n");
  }
}
