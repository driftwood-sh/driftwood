import assert from "node:assert/strict";
import test from "node:test";

import type { AccountsPage, EmailState, SendingAccount } from "./api.ts";
import type { ManagedMailbox } from "../dashboard/managed-inboxes.ts";
import {
  accountLabel,
  channelConnected,
  connectedChannelCount,
  emailAddress,
  emailDailyCap,
  emailProviderName,
  emailRowState,
  emailSummary,
  emailSummaryLine,
  isUsable,
  linkMinutesLeft,
  linkedBy,
  linkedByLine,
  managedInboxReady,
  newestOwnActive,
  ownAccount,
} from "./model.ts";

function account<S>(overrides: Partial<SendingAccount<S>> & { channelState: S }): SendingAccount<S> {
  return {
    id: "a-1",
    display: "Yuvan Sharma",
    connectedBy: { id: "u-1", name: "Yuvan Sharma", email: "yuvan@autosana.ai" },
    isMine: false,
    canDisconnect: false,
    status: "active",
    error: null,
    connectedAt: "2026-09-09T18:04:00Z",
    sentToday: null,
    dailyCap: null,
    linkMintedAt: null,
    ...overrides,
  };
}

const gmail = (address: string, linkState: EmailState["linkState"] = null): EmailState => ({
  provider: "gmail",
  address,
  linkState,
});

function mailbox(overrides: Partial<ManagedMailbox>): ManagedMailbox {
  return {
    address: "outreach@example-mail.com",
    domain: "example-mail.com",
    status: "warming",
    warming_day: 5,
    warming_days_total: 14,
    todays_cap: 5,
    sent_today: 2,
    health: "good",
    paused_reason: null,
    ...overrides,
  };
}

test("the label falls back from display to the linker's name, then their email", () => {
  assert.equal(accountLabel(account({ channelState: {} })), "Yuvan Sharma");
  assert.equal(accountLabel(account({ display: null, channelState: {} })), "Yuvan Sharma");
  assert.equal(
    accountLabel(
      account({
        display: null,
        connectedBy: { id: "u-1", name: null, email: "yuvan@autosana.ai" },
        channelState: {},
      }),
    ),
    "yuvan@autosana.ai",
  );
});

test("the second line names the linker, or says 'you' on the viewer's own row", () => {
  assert.equal(linkedBy(account({ channelState: {} })), "Yuvan Sharma");
  assert.equal(linkedBy(account({ isMine: true, channelState: {} })), "you");
  assert.equal(linkedByLine(account({ channelState: {} })), "Linked by Yuvan Sharma");
  assert.equal(linkedByLine(account({ isMine: true, channelState: {} })), "Linked by you");
  assert.equal(
    linkedByLine(
      account({ connectedBy: { id: "u-2", name: null, email: "sam@example.com" }, channelState: {} }),
    ),
    "Linked by sam@example.com",
  );
});

test("only an active row is usable, and a chat-locked X row is not", () => {
  assert.equal(isUsable(account({ channelState: {} })), true);
  assert.equal(isUsable(account({ status: "pending", channelState: {} })), false);
  assert.equal(isUsable(account({ status: "error", error: "Signed out.", channelState: {} })), false);
  assert.equal(
    isUsable(account({ channelState: { handle: "pmarca", pending: false, chatLocked: true } })),
    false,
  );
  assert.equal(
    isUsable(account({ channelState: { handle: "pmarca", pending: false, chatLocked: false } })),
    true,
  );
});

test("a channel is connected when any row is usable", () => {
  assert.equal(channelConnected([]), false);
  assert.equal(channelConnected([account({ status: "pending", channelState: {} })]), false);
  assert.equal(
    channelConnected([account({ status: "pending", channelState: {} }), account({ id: "a-2", channelState: {} })]),
    true,
  );
});

test("ownAccount picks the viewer's row and null when there is none", () => {
  const mine = account({ id: "mine", isMine: true, channelState: {} });
  assert.equal(ownAccount([account({ channelState: {} }), mine]), mine);
  assert.equal(ownAccount([account({ channelState: {} })]), null);
});

test("the section count is the number of channels with a usable row", () => {
  const page: AccountsPage = {
    canConnect: true,
    linkedin: [account({ channelState: {} })],
    email: [account({ status: "pending", channelState: { provider: "outlook", address: "sam@example.com", linkState: null } })],
    x: [account({ channelState: { handle: "pmarca", pending: false, chatLocked: true } })],
  };
  assert.equal(connectedChannelCount(page), 1);
  assert.equal(connectedChannelCount({ ...page, x: [account({ channelState: { handle: null, pending: false, chatLocked: false } })] }), 2);
});

test("an email row's cap falls back to 20 when the backend sends none", () => {
  assert.equal(emailDailyCap(account({ channelState: gmail("a@example.com") })), 20);
  assert.equal(emailDailyCap(account({ dailyCap: 35, channelState: gmail("a@example.com") })), 35);
});

test("the email row's name line is the address, then the label fallback", () => {
  assert.equal(emailAddress(account({ channelState: gmail("a@example.com") })), "a@example.com");
  assert.equal(
    emailAddress(account({ channelState: { provider: "gmail", address: null, linkState: null } })),
    "Yuvan Sharma",
  );
});

test("an error row with an expired link reads as expired, other rows follow their status", () => {
  assert.equal(emailRowState(account({ channelState: gmail("a@example.com") })), "active");
  assert.equal(emailRowState(account({ status: "pending", channelState: gmail("a@example.com") })), "pending");
  assert.equal(
    emailRowState(account({ status: "error", error: "Signed out.", channelState: gmail("a@example.com") })),
    "error",
  );
  assert.equal(
    emailRowState(account({ status: "error", error: null, channelState: gmail("a@example.com", "expired") })),
    "expired",
  );
  // an active row never reads as expired, whatever the channel state says
  assert.equal(emailRowState(account({ channelState: gmail("a@example.com", "expired") })), "active");
});

test("the provider name feeds the chip and the tab sentence", () => {
  assert.equal(emailProviderName("gmail"), "Google");
  assert.equal(emailProviderName("outlook"), "Microsoft");
  assert.equal(emailProviderName(null), null);
});

test("minutes left on a pending link count down from ten and floor at zero", () => {
  const now = Date.parse("2026-09-11T10:00:00Z");
  assert.equal(linkMinutesLeft(null, now), null);
  assert.equal(linkMinutesLeft("not a date", now), null);
  assert.equal(linkMinutesLeft("2026-09-11T09:58:00Z", now), 8);
  assert.equal(linkMinutesLeft("2026-09-11T09:58:30Z", now), 8);
  assert.equal(linkMinutesLeft("2026-09-11T10:00:00Z", now), 10);
  assert.equal(linkMinutesLeft("2026-09-11T09:45:00Z", now), 0);
});

test("a bought inbox is ready when it can send today", () => {
  assert.equal(managedInboxReady(mailbox({ status: "active" })), true);
  assert.equal(managedInboxReady(mailbox({ status: "ready" })), true);
  assert.equal(managedInboxReady(mailbox({ status: "warming", todays_cap: 0 })), false);
  assert.equal(managedInboxReady(mailbox({ status: "provisioning", todays_cap: 0 })), false);
  assert.equal(managedInboxReady(mailbox({ status: "paused", todays_cap: 0 })), false);
});

test("the summary counts usable rows plus ready bought inboxes and sums their caps", () => {
  const rows = [
    account({ id: "a", channelState: gmail("a@example.com") }),
    account({ id: "b", dailyCap: 30, channelState: gmail("b@example.com") }),
    account({ id: "c", status: "pending", channelState: gmail("c@example.com") }),
    account({ id: "d", status: "error", error: null, channelState: gmail("d@example.com", "expired") }),
  ];
  const boxes = [
    mailbox({ address: "w@example-mail.com", status: "ready", warming_day: null, todays_cap: 6 }),
    mailbox({ address: "x@example-mail.com", status: "warming", todays_cap: 0 }),
    mailbox({ address: "y@example-mail.com", status: "paused", todays_cap: 0 }),
  ];
  assert.deepEqual(emailSummary(rows, boxes), { ready: 3, cap: 56, warming: 1 });
  assert.deepEqual(emailSummary([], []), { ready: 0, cap: 0, warming: 0 });
});

test("the summary line pluralizes and drops the cap when nothing can send", () => {
  assert.equal(emailSummaryLine({ ready: 3, cap: 60 }), "3 mailboxes ready · up to 60 sends a day");
  assert.equal(emailSummaryLine({ ready: 1, cap: 20 }), "1 mailbox ready · up to 20 sends a day");
  assert.equal(emailSummaryLine({ ready: 0, cap: 0 }), "0 mailboxes ready");
  assert.equal(emailSummaryLine({ ready: 0, cap: 0, warming: 8 }), "0 mailboxes ready · 8 warming up");
  assert.equal(
    emailSummaryLine({ ready: 2, cap: 12, warming: 1 }),
    "2 mailboxes ready · up to 12 sends a day · 1 warming up",
  );
});

test("the return banner names the viewer's newest active mailbox", () => {
  const older = account({ id: "old", isMine: true, connectedAt: "2026-09-01T00:00:00Z", channelState: gmail("old@example.com") });
  const newer = account({ id: "new", isMine: true, connectedAt: "2026-09-10T00:00:00Z", channelState: gmail("new@example.com") });
  const theirs = account({ id: "theirs", connectedAt: "2026-09-11T00:00:00Z", channelState: gmail("sam@example.com") });
  const pending = account({ id: "pending", isMine: true, status: "pending", connectedAt: null, channelState: gmail("p@example.com") });
  assert.equal(newestOwnActive([older, theirs, newer, pending]), newer);
  assert.equal(newestOwnActive([theirs, pending]), null);
  assert.equal(newestOwnActive([]), null);
});
