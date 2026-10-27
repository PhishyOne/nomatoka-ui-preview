"use strict";

(() => {
  const ATTEMPT_KEY = "nomatoka.closed-alpha-attempt.v1";
  const COMMAND_HISTORY_KEY = "nomatoka.foundation-command-history.v1";
  const COMMAND_PENDING_KEY = "nomatoka.foundation-command-pending.v1";
  const PROOF_PATTERN = /^[A-Za-z0-9_-]{43}$/;
  const ACCOUNT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
  const COMMAND_REFERENCE_PATTERN = /^foundation:[A-Za-z0-9_-]{22}$/;
  const GRANT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const MAX_HISTORY_REFERENCES = 16;
  const TAKEOVER_WARNING = "Another session for this account is active. Move command control to this session to continue.";

  async function requestWithDeadline(platform, path, options, readResponse) {
    const controller = new platform.AbortController();
    const timer = platform.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await platform.fetch(path, { credentials: "same-origin", ...options, signal: controller.signal });
      // Keep the deadline until the representation is read or deliberately
      // cancelled, including requests that have not received headers yet.
      return await readResponse(response);
    } finally { platform.clearTimeout(timer); }
  }

  function controlPresentation(status) {
    const inactive = status === "inactive";
    return {
      commandDisabled: status !== "active",
      warningHidden: !inactive,
      warningText: inactive ? TAKEOVER_WARNING : "",
    };
  }

  // Both route styling and action proposals interpret the same received evidence.
  // Account ownership is established by refreshPicture's existing observation fence.
  function receivedTrunkEvidence(reports) {
    const trunkIds = ["fallen-trunk", "fallen-trunk-cleared", "fallen-trunk-inspected"];
    // Match only the exact summaries admitted by product-stores.js. Never use
    // substring matching: the nonblocking summary also contains "blocking".
    const summaries = {
      "fallen-trunk": ["Ortega reported a fallen trunk blocking the Short path."],
      "fallen-trunk-cleared": ["Ortega reported that the fallen trunk no longer blocks Short path. Other obstructions are not ruled out."],
      "fallen-trunk-inspected": [
        "Ortega inspected the fallen trunk and reported it blocking Short path. Other obstructions are not ruled out.",
        "Ortega inspected the fallen trunk and reported it not blocking Short path. Other obstructions are not ruled out.",
      ],
    };
    const evidence = reports.filter(report => trunkIds.includes(report?.id)).map(report => {
      const stamp = report.delivery?.receivedAt;
      // The public contract uses UTC ISO timestamps with six fractional digits.
      // Keep microseconds for ordering; Date alone would introduce false ties.
      const validTime = typeof stamp === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(stamp)
        && Number(stamp.slice(0, 4)) >= 1970 && Number.isFinite(Date.parse(stamp)) && new Date(stamp).toISOString() === `${stamp.slice(0, 23)}Z`;
      const orderId = report.relatedOrderId, kind = report.delivery?.kind, personId = report.source?.personId;
      const validIdentity = typeof orderId === "string" && orderId.length === 36 && GRANT_PATTERN.test(orderId)
        && personId === "ortega" && ["local report", "local radio"].includes(kind)
        && (report.id !== "fallen-trunk-inspected" || kind === "local report");
      const index = summaries[report.id].indexOf(report.summary);
      return { stamp, kind, identity: JSON.stringify([orderId, kind, personId]), valid: validTime && validIdentity && index >= 0,
        blocked: report.id === "fallen-trunk" || (report.id === "fallen-trunk-inspected" && index === 0) };
    });
    // A blocking inspection projects two cards from one receipt. Coalesce only
    // matching receipt identities and conditions, never the original cards.
    // Equal times on different receipts cannot establish an ordering.
    const receipts = new Map();
    const coherent = evidence.every(item => {
      if (!item.valid) return false;
      const prior = receipts.get(item.stamp);
      if (prior) return prior.identity === item.identity && prior.blocked === item.blocked;
      receipts.set(item.stamp, item);
      return true;
    });
    const latest = [...receipts.values()].sort((a, b) => a.stamp.localeCompare(b.stamp)).at(-1);
    return { coherent, latest, count: evidence.length };
  }

  function routeKnowledge(picture) {
    const unknown = { state: "unconfirmed", text: "Short path: passage unconfirmed. Lower path: passage unconfirmed." };
    const reports = Array.isArray(picture?.reports) ? picture.reports : [];
    const { coherent, latest, count } = receivedTrunkEvidence(reports);
    if (!count) return unknown;
    if (!coherent) return { state: "uncertain", text: "Short path: received reports cannot establish a last-known condition. See received reports. Current passage unconfirmed. Lower path: passage unconfirmed." };
    return {
      state: latest.blocked ? "reported-blocked" : "reported-not-blocking",
      text: `Last received report: ${latest.blocked ? "Short path obstructed by trunk" : "trunk reported not blocking Short path"}. Received ${latest.stamp} · ${latest.kind}. Observation time not supplied. Current passage unconfirmed; other obstructions not ruled out.${count > 1 ? " Evidence retained in received reports." : ""} Lower path: passage unconfirmed.`,
    };
  }

  // Input is the already account/control-fenced public operations picture only.
  // These are wording proposals, never a second interpreter or capability oracle.
  function contextualActions(selectedEntity, picture) {
    if (!picture) return [];
    const options = [], reports = picture.reports ?? [];
    const notice = "Proposal, not a guarantee of execution or delivery.";
    const localGuidance = "Review VIA; these proposals use in-person delivery. Contact may be stale.";
    const add = (id, target, command, evidence, guidance = localGuidance, disabledReason = "") =>
      options.push({ id, selectedEntity, target, command, evidence, notice, guidance, disabledReason });
    const holding = picture.contact?.area === "Ridge" && picture.contact?.source === "local radio"
      && picture.contact?.state === "last-known";
    const briefing = "Local briefing; planning context, not a live condition report.";
    if ((selectedEntity === "staging-area" && picture.reference?.label === "Staging Area")
      || (selectedEntity === "ortega" && picture.contact && !holding)) {
      for (const [id, command] of [["status", "status"], ["rest", "rest here"], ["observe", "observe here"], ["hold", "hold here"]])
        add(id, "ortega", command, selectedEntity === "ortega" ? "Available Ortega contact in received picture." : briefing,
          `${localGuidance}${id === "status" ? " Status repeats known facts; it does not obtain live intelligence." : " Here refers to Ortega's place when interpreted."}`);
    }
    if (selectedEntity === "ridge" && picture.objective?.label === "Ridge") {
      for (const [id, command] of [["scout", "scout ridge"], ["deploy", "move to ridge and hold"],
        ["scout-cautious", "scout ridge cautiously"], ["scout-quick", "scout ridge quickly"],
        ["scout-return", "scout ridge if blocked, return"], ["scout-reroute", "scout ridge if blocked, reroute"]])
        add(id, "ridge", command, briefing);
    }
    if (picture.objective?.label === "Ridge") {
      for (const [route, name] of [["short", "short"], ["long", "lower"]]) {
        if (!["ridge", route].includes(selectedEntity) || !picture.routes?.some(item => item.id === route)) continue;
        add(`scout-via-${route}`, "ridge", `scout ridge via ${name} path`, briefing,
          `${localGuidance} Named route preference; passage is not confirmed.`);
        add(`scout-via-${route}-return`, "ridge", `scout ridge via ${name} path if blocked, return`, briefing,
          `${localGuidance} Named route preference; return if blocked.`);
      }
    }
    const trunkIds = ["fallen-trunk", "fallen-trunk-cleared", "fallen-trunk-inspected"];
    if (trunkIds.includes(selectedEntity) && reports.some(report => report.id === selectedEntity)) {
      const { coherent, latest } = receivedTrunkEvidence(reports);
      const label = coherent
        ? `Last reported ${latest.blocked ? "blocking" : "not blocking"} Short path; received ${latest.stamp}. Current condition unknown.`
        : "Received trunk evidence; last reported condition uncertain (unknown summary, invalid receipt identity/time, conflicting evidence or tied receipts).";
      add("inspect-trunk", "fallen-trunk", "inspect the fallen trunk", label);
      if (coherent && latest.blocked) add("clear-trunk", "fallen-trunk", "clear the fallen trunk", label);
    }
    if (selectedEntity === "ridge-marker" && reports.some(report => report.id === "ridge-marker"))
      add("inspect-marker", "ridge-marker", "inspect the stone marker", "Received stone marker exterior report; contents and current condition unknown.");
    if (holding && ["ortega", "ridge"].includes(selectedEntity)) {
      for (const [id, command] of [["observe-held", "observe here"], ["return-base", "return to base"]])
        add(id, "ortega", command, "Last reported holding at Ridge by local radio; no live position.",
          "Select VIA Radio yourself for this remote proposal. Preparing text does not change the method; delivery remains unconfirmed.",
          picture.radioOrder ? "Radio order awaiting a report; another remote proposal is locked." : "");
    }
    return options;
  }

  // Words are views of the exact textarea, not a second command representation.
  function draftTokens(text) {
    return [...text.matchAll(/\S+/gu)].map(match => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
  }

  function editDraftTokens(text, from, to = null) {
    const tokens = draftTokens(text);
    if (!Number.isInteger(from) || !tokens[from]) return text;
    if (to === null) {
      const start = tokens[from + 1] ? tokens[from].start : (tokens[from - 1]?.end ?? 0);
      const end = tokens[from + 1]?.start ?? text.length;
      return text.slice(0, start) + text.slice(end);
    }
    if (!Number.isInteger(to) || !tokens[to] || from === to) return text;
    const words = tokens.map(token => token.text);
    words.splice(to, 0, words.splice(from, 1)[0]);
    // Retain punctuation inside words and the user's whitespace between slots.
    let index = 0;
    return text.replace(/\S+/gu, () => words[index++]);
  }

  function progressiveSuggestions(text, options) {
    const tokens = draftTokens(text), words = tokens.map(token => token.text.toLowerCase());
    const groups = new Map();
    for (const option of options) {
      if (option.disabledReason) continue;
      const command = option.command.split(/\s+/u);
      let consumed = words.length, replaceStart = text.length;
      const partial = words.length && !/\s$/u.test(text) && command[consumed - 1] !== words.at(-1);
      if (partial) {
        if (!command[consumed - 1]?.startsWith(words.at(-1))) continue;
        consumed--; replaceStart = tokens.at(-1).start;
      }
      if (!words.slice(0, consumed).every((word, index) => command[index] === word)) continue;
      const remaining = command.slice(consumed);
      if (!remaining.length) continue;
      const key = remaining[0];
      const group = groups.get(key);
      if (group) {
        let length = 0;
        while (length < group.words.length && group.words[length] === remaining[length]) length++;
        group.words.length = length;
      } else groups.set(key, { words: remaining, replaceStart, consumed, option });
    }
    return [...groups.values()].map(group => {
      // Suggestions are short *next* building blocks, not canned orders.
      // Even a unique four-word continuation must be built incrementally.
      // Pair only small connector phrases or source-backed compound target
      // names already contained in available commands. These are display
      // boundaries, NEVER new parser rules or inferred capabilities.
      const [first, second] = group.words;
      const twoWords = group.consumed > 0 && !!second
        && (["to", "and", "if"].includes(first.toLowerCase())
          || ["path", "marker", "trunk"].includes(second.toLowerCase()));
      const phrase = group.words.slice(0, twoWords ? 2 : 1).join(" ");
      const prefix = text.slice(0, group.replaceStart);
      return { phrase, text: prefix + (prefix && !/\s$/u.test(prefix) ? " " : "") + phrase, option: group.option };
    });
  }

  function createClient(platform) {
    const crypto = platform.crypto;
    const fetch = platform.fetch.bind(platform);
    const location = platform.location;
    const localStorage = platform.localStorage;
    const sessionStorage = platform.sessionStorage;
    let memoryAttempt;
    let memoryCommandReferences = [];
    let memoryPendingCommand;
    let activeCommandContext;
    let automaticControlClaimAttempted = false;

    function forgetAttempt() {
      memoryAttempt = undefined;
      try { sessionStorage.removeItem(ATTEMPT_KEY); } catch {}
    }

    function readAttempt() {
      let value = memoryAttempt;
      try {
        const stored = sessionStorage.getItem(ATTEMPT_KEY);
        if (stored !== null) value = JSON.parse(stored);
      } catch {
        return value;
      }
      if (
        value === null
        || typeof value !== "object"
        || Array.isArray(value)
        || Object.keys(value).sort().join(",") !== "attemptSecret,inviteCode"
        || !PROOF_PATTERN.test(value.inviteCode)
        || !PROOF_PATTERN.test(value.attemptSecret)
      ) {
        forgetAttempt();
        return undefined;
      }
      return value;
    }

    function retainAttempt(attempt) {
      memoryAttempt = attempt;
      try { sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt)); } catch {}
    }

    function commandReferences() {
      let value = memoryCommandReferences;
      try {
        const stored = localStorage.getItem(COMMAND_HISTORY_KEY);
        if (stored !== null) value = JSON.parse(stored);
      } catch {
        return value;
      }
      if (!Array.isArray(value) || value.some((item) => !COMMAND_REFERENCE_PATTERN.test(item))) value = [];
      memoryCommandReferences = [...new Set(value)].slice(-MAX_HISTORY_REFERENCES);
      try { localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(memoryCommandReferences)); } catch {}
      return [...memoryCommandReferences];
    }

    function retainCommandReferences(value) {
      memoryCommandReferences = [...new Set(value)].slice(-MAX_HISTORY_REFERENCES);
      try { localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(memoryCommandReferences)); } catch {}
    }

    function clearPendingCommand() {
      memoryPendingCommand = undefined;
      try { localStorage.removeItem(COMMAND_PENDING_KEY); } catch {}
    }

    function pendingCommand() {
      let value = memoryPendingCommand;
      try {
        const stored = localStorage.getItem(COMMAND_PENDING_KEY);
        if (stored !== null) value = JSON.parse(stored);
      } catch {
        return value;
      }
      if (
        value === null
        || typeof value !== "object"
        || Array.isArray(value)
        || Object.keys(value).sort().join(",") !== "command,context"
        || value.command === null
        || typeof value.command !== "object"
        || Array.isArray(value.command)
        || Object.keys(value.command).sort().join(",") !== "expectedWorldVersion,idempotencyKey"
        || !COMMAND_REFERENCE_PATTERN.test(value.command.idempotencyKey)
        || !Number.isSafeInteger(value.command.expectedWorldVersion)
        || value.command.expectedWorldVersion < 1
        || value.context === null
        || typeof value.context !== "object"
        || Array.isArray(value.context)
        || Object.keys(value.context).sort().join(",") !== "accountId,controlVersion,grantId"
        || !ACCOUNT_PATTERN.test(value.context.accountId)
        || !Number.isSafeInteger(value.context.controlVersion)
        || value.context.controlVersion < 1
        || !GRANT_PATTERN.test(value.context.grantId)
      ) {
        clearPendingCommand();
        return undefined;
      }
      memoryPendingCommand = value;
      return value;
    }

    function retainPendingCommand(value) {
      memoryPendingCommand = value;
      try { localStorage.setItem(COMMAND_PENDING_KEY, JSON.stringify(value)); } catch {}
    }

    function observedCommandContext(projection) {
      const accountId = projection?.commander?.id;
      const control = projection?.control;
      if (!ACCOUNT_PATTERN.test(accountId)
        || control === null
        || typeof control !== "object"
        || !Number.isSafeInteger(control.version)
        || control.version < 0
        || !["active", "available", "inactive"].includes(control.status)) return undefined;
      if (control.status !== "active") return { accountId, active: undefined };
      if (control.version < 1 || !GRANT_PATTERN.test(control.grantId)) return undefined;
      return {
        accountId,
        active: Object.freeze({ accountId, controlVersion: control.version, grantId: control.grantId }),
      };
    }

    function sameCommandContext(left, right) {
      return left !== undefined
        && right !== undefined
        && left.accountId === right.accountId
        && left.controlVersion === right.controlVersion
        && left.grantId === right.grantId;
    }

    function randomBase64Url(byteLength) {
      const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return platform.btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
    }

    function newAttemptSecret() {
      return randomBase64Url(32);
    }

    function newCommandReference() {
      return `foundation:${randomBase64Url(16)}`;
    }

    function statusText(response, phase) {
      if (response.status === 429) return "This account has reached its session limit. Retry this same attempt after another session ends.";
      if (response.status === 503) return `${phase} could not be confirmed. Retry to reconcile the same attempt.`;
      if (response.status === 410) return "This sign-in attempt has expired. Submit the invite code to start a new attempt.";
      if (response.status === 401) return phase === "Activation"
        ? "Activation could not be recovered. Retry with the same invite code."
        : "That invitation could not be accepted.";
      return `${phase} could not be completed.`;
    }

    async function request(path, options = {}) {
      return fetch(path, { credentials: "same-origin", ...options });
    }

    async function responseBody(response) {
      try { return await response.json(); } catch { return undefined; }
    }

    async function activate() {
      const response = await request("/api/auth/session/activate", { method: "POST" });
      if (response.status === 200) {
        forgetAttempt();
        location.replace("/play");
        return undefined;
      }
      if (response.status === 410) forgetAttempt();
      return statusText(response, "Activation");
    }

    async function submitInvite(inviteCode) {
      const retained = readAttempt();
      const attempt = retained?.inviteCode === inviteCode
        ? retained
        : { inviteCode, attemptSecret: newAttemptSecret() };
      retainAttempt(attempt);
      const response = await request("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attempt),
      });
      if (response.status === 200) {
        forgetAttempt();
        location.replace("/play");
        return undefined;
      }
      if (response.status === 202) return activate();
      if ([400, 401, 410].includes(response.status)) forgetAttempt();
      return statusText(response, "Sign-in");
    }

    async function recoverSession() {
      const response = await request("/api/session");
      if (response.status === 200) {
        forgetAttempt();
        location.replace("/play");
      }
      return response.status;
    }

    async function logout() {
      const response = await request("/api/auth/logout", { method: "POST" });
      if (response.status === 200) {
        forgetAttempt();
        location.replace("/play");
        return undefined;
      }
      return response.status === 503
        ? "Sign-out could not be confirmed. Retry to reconcile this session."
        : "Sign-out could not be completed.";
    }

    async function commander() {
      return requestWithDeadline(platform, "/api/commander", { cache: "no-store" }, async response => {
        // A failed authority observation must not wait for an optional error body.
        if (response.status !== 200) {
          response.body?.cancel().catch(() => {});
          return { status: response.status };
        }
        return { status: response.status, body: await responseBody(response) };
      });
    }

    async function claimControl(expectedVersion) {
      return requestWithDeadline(platform, "/api/control/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion }),
      }, async response => ({ status: response.status, body: await responseBody(response) }));
    }

    async function commanderForWorkspace(isCurrent = () => true) {
      let result = await commander();
      if (result.status !== 200
        || result.body?.control?.status !== "available"
        || automaticControlClaimAttempted || !isCurrent()) return result;
      automaticControlClaimAttempted = true;
      try { await claimControl(result.body.control.version); } catch {}
      result = await commander();
      return result;
    }

    async function historyFor(references) {
      const response = await request("/api/commands/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKeys: references }),
      });
      const body = await responseBody(response);
      return {
        status: response.status,
        entries: Array.isArray(body?.entries)
          ? body.entries.map((entry, index) => ({ entry, reference: references[index] }))
          : [],
      };
    }

    async function discardPendingCommand(value, observedAccountId) {
      let reconciledAbsent = false;
      if (value.context.accountId === observedAccountId) {
        try {
          const result = await historyFor([value.command.idempotencyKey]);
          reconciledAbsent = result.status === 200
            && result.entries.length === 1
            && result.entries[0].entry === null;
        } catch {}
      }
      const references = commandReferences();
      if (reconciledAbsent) {
        retainCommandReferences(references.filter((item) => item !== value.command.idempotencyKey));
      } else {
        retainCommandReferences([...references, value.command.idempotencyKey]);
      }
      clearPendingCommand();
    }

    async function synchronizeCommandContext(projection) {
      const observed = observedCommandContext(projection);
      const retained = pendingCommand();
      activeCommandContext = observed?.active;
      if (retained === undefined || sameCommandContext(retained.context, activeCommandContext)) return;
      await discardPendingCommand(retained, observed?.accountId);
    }

    async function submitCommand(expectedWorldVersion) {
      if (activeCommandContext === undefined) {
        return { status: 403, body: undefined };
      }
      let retained = pendingCommand();
      if (retained !== undefined && !sameCommandContext(retained.context, activeCommandContext)) {
        await discardPendingCommand(retained, activeCommandContext.accountId);
        retained = undefined;
      }
      if (retained === undefined) {
        const command = { idempotencyKey: newCommandReference(), expectedWorldVersion };
        retained = { command, context: activeCommandContext };
        retainPendingCommand(retained);
        retainCommandReferences([...commandReferences(), command.idempotencyKey]);
      }
      const command = retained.command;
      const response = await request("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const result = { status: response.status, body: await responseBody(response) };
      if (response.status === 201) {
        clearPendingCommand();
      } else if ([400, 401, 403, 409].includes(response.status)) {
        await discardPendingCommand(retained, activeCommandContext.accountId);
      }
      return result;
    }

    async function history() {
      const references = commandReferences();
      return historyFor(references);
    }

    return Object.freeze({
      claimControl,
      commander,
      commanderForWorkspace,
      commandReferences,
      forgetAttempt,
      hasPendingCommand: () => {
        const retained = pendingCommand();
        return retained !== undefined && sameCommandContext(retained.context, activeCommandContext);
      },
      history,
      logout,
      readAttempt,
      recoverSession,
      submitCommand,
      submitInvite,
      synchronizeCommandContext,
    });
  }

  // These are authenticated, bounded public response forms, not inferred delivery.
  function orderPresentation(order) {
    if (order.decision === "issued") return { state: "unresolved", label: "Issued · delivery unconfirmed" };
    if (["This order was not delivered. Wait for the accepted outing to return.",
      "A radio order is already awaiting a report."].includes(order.response))
      return { state: "unresolved", label: "Issued · delivery unconfirmed" };
    if (order.response === "Radio order transmitted. Awaiting a report.")
      return { state: "transmitted", label: "Transmitted · awaiting report" };
    if (order.decision === "accepted") return { state: "accepted", label: "Accepted" };
    if (order.decision === "questioned") return { state: "clarification", label: "Needs clarification" };
    if (order.decision === "refused") return { state: "rejected", label: "Rejected" };
    return { state: "recorded", label: "Recorded · check response" };
  }
  function methodSummary(order) {
    const via = order.via === "in-person" ? "In person" : order.via === "radio" ? "Radio" : "Method unspecified";
    return `TO Ortega · VIA ${via}` + (order.via
      ? ` · Delivery: ${order.delivery} · Actor interpretation: ${order.interpretation}` : "");
  }
  function orderFeedback(order) {
    if (order.responseKind === "platform-notice") return `Platform notice: ${order.response}`;
    const presentation = orderPresentation(order);
    if (presentation.state === "unresolved") return "No transmission recorded. No mercenary interpretation or acceptance recorded."
      + (order.response === "A radio order is already awaiting a report." ? " Another radio order awaits a report." : "");
    if (presentation.state === "transmitted") return "Radio transmission recorded; acknowledgment and execution unconfirmed.";
    if (["accepted", "clarification", "rejected"].includes(presentation.state))
      return `Local delivery recorded. ${order.response}`;
    return order.response ?? "No response recorded.";
  }
  // This overlay reads only public immutable commands and delivered knowledge.
  // It never repairs a historical result in place or consults a running task.
  const unavailableOutcome = "outcome not confirmed from available records";
  function acceptedAssignment(order) {
    return orderPresentation(order).state === "accepted" && !order.response.startsWith("Known facts:");
  }
  function coveredOrderSpan(orders, from, to) {
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to < from) return null;
    const span = orders.filter(entry => Number.isSafeInteger(entry.resultingMercenaryVersion)
      && entry.resultingMercenaryVersion >= from && entry.resultingMercenaryVersion <= to);
    return span.length === to - from + 1
      && new Set(span.map(entry => entry.resultingMercenaryVersion)).size === span.length
      && new Set(span.map(entry => entry.orderId)).size === span.length ? span : null;
  }
  function orderLifecycle(order, knowledge, orders = [], picture) {
    const issued = orderPresentation(order);
    const report = ["accepted", "transmitted"].includes(issued.state)
      && knowledge?.report && knowledge.orderId === order.orderId;
    if (report && knowledge.source === "local report")
      return { state: "completed", label: "Completed · report received" };
    if (report && knowledge.source === "local radio")
      return order.response === "I will move to the ridge and hold. I will radio my arrival."
        ? { state: "holding-reported", label: "Arrival reported · holding last reported" }
        : { state: "completed", label: "Completed · report received" };
    const reportedOrder = orders.find(entry => entry.orderId === knowledge?.orderId);
    // A radio return references its own order, not the earlier deployment ID.
    // Text equality cannot attribute that report when the same deployment was
    // superseded before departure. Require a complete, unique version chain
    // and prove this is the last accepted assignment before the radio.
    const from = order.resultingMercenaryVersion, to = reportedOrder?.resultingMercenaryVersion;
    const span = to > from ? coveredOrderSpan(orders, from, to) : null;
    const complete = span?.some(entry => entry.orderId === order.orderId)
      && span.some(entry => entry.orderId === reportedOrder?.orderId);
    const newerAssignment = span?.some(entry =>
      entry.resultingMercenaryVersion > from && entry.resultingMercenaryVersion < to
      && acceptedAssignment(entry));
    if (complete && !newerAssignment
      && reportedOrder?.response === "Radio order transmitted. Awaiting a report."
      && reportedOrder.mercenary.currentOrder === order.text
      && order.response === "I will move to the ridge and hold. I will radio my arrival.") {
      if (knowledge?.source === "local report" && knowledge.report?.startsWith("I have returned to base. "))
        return { state: "concluded", label: "Deployment concluded · return report received" };
      if (knowledge?.source === "local radio" && knowledge.report && knowledge.contact === "holding reported")
        return { state: "holding-reported", label: "Holding · last received report" };
    }
    // Fact summaries prove receipt for their exact related order, not that its
    // assignment returned/completed. The picture is not a full report journal.
    if (["accepted", "transmitted"].includes(issued.state)
      && picture?.reports.some(received => received.relatedOrderId === order.orderId))
      return { state: "report-received", label: `Report received · ${unavailableOutcome}` };
    if (issued.state === "transmitted" && picture?.radioOrder?.orderId === order.orderId
      && Number.isSafeInteger(picture.revision) && Number.isSafeInteger(knowledge?.revision)
      && picture.revision >= knowledge.revision) return issued;
    if (issued.state === "transmitted")
      return { state: issued.state, label: `Transmitted · ${unavailableOutcome}` };
    if (issued.state === "accepted")
      return { state: issued.state, label: `Accepted · ${unavailableOutcome}` };
    return issued;
  }
  function assignmentPresentation(mercenary, knowledge, orders = [], picture) {
    if (!mercenary?.currentOrder) return { text: "None", status: "ready" };
    const assignment = orders.filter(entry => entry.resultingMercenaryVersion <= mercenary.version
      && acceptedAssignment(entry))
      .sort((a, b) => b.resultingMercenaryVersion - a.resultingMercenaryVersion)[0];
    // A missing command between the assignment and this snapshot could be a
    // new identical assignment. Never let an old report conclude that command.
    const covered = assignment?.text === mercenary.currentOrder
      && coveredOrderSpan(orders, assignment.resultingMercenaryVersion, mercenary.version);
    if (!covered) return { text: mercenary.currentOrder, incomplete: true,
      status: `Order history incomplete · ${unavailableOutcome}. Load older history for attribution.` };
    const lifecycle = orderLifecycle(assignment, knowledge, orders, picture);
    const concluded = ["completed", "concluded"].includes(lifecycle?.state);
    return { text: concluded ? `${mercenary.currentOrder} — concluded` : mercenary.currentOrder,
      status: concluded ? "Concluded · report received" : lifecycle?.state === "holding-reported"
        ? "Holding · last received report" : `Assignment recorded · ${unavailableOutcome}` };
  }
  function personnelPresentation(mercenary, knowledge, orders, picture) {
    if (!mercenary) return null;
    const assignment = assignmentPresentation(mercenary, knowledge, orders, picture);
    return { name: mercenary.name, assignment: assignment.text,
      status: mercenary.currentOrder ? assignment.status : "No assignment recorded",
      location: knowledge?.location ? `Last reported location: ${knowledge.location}` : "Location unconfirmed" };
  }
  function peopleReportPreview(picture) {
    // This is a projection of the admitted picture, never a retained report store.
    return [...(picture?.reports ?? [])].sort((a, b) =>
      a.delivery.receivedAt < b.delivery.receivedAt ? 1 : a.delivery.receivedAt > b.delivery.receivedAt ? -1 : 0)
      .slice(0, 5).map(report => ({ label: report.label, summary: report.summary,
        source: `${report.source.label} · ${report.source.means} · ${report.delivery.kind}`,
        receivedAt: report.delivery.receivedAt,
        uncertainty: "Received report; current status unconfirmed. Exact position and observation time not supplied." }));
  }
  // Only the authenticated public picture supplies evidence. Neither the order
  // response nor latest knowledge is a cumulative report source.
  function deliveredStatusBrief(order, picture, minimumRevision = 0) {
    if (typeof order?.text !== "string" || order.text.trim().toLowerCase() !== "status") return null;
    const label = "Commander records / delivered status brief — NOT A REPLY";
    if (!picture || !Number.isSafeInteger(picture.revision) || picture.revision < minimumRevision)
      return { label, contact: "No operations picture confirmed", reports: [] };
    const contact = picture.contact;
    const contactText = contact
      ? `Contact recorded in picture: ${contact.state === "last-known" ? "last known" : "recorded present"} at ${contact.area} · ${contact.source}. Contact receipt time and order identity not supplied.`
      : "No contact report supplied.";
    return { label, contact: `${contactText} Saved picture; may be stale. No live position or new acknowledgment confirmed.`,
      reports: [...picture.reports].sort((a, b) => a.delivery.receivedAt.localeCompare(b.delivery.receivedAt))
        .map(report => `Received ${report.delivery.receivedAt} · ${report.source.label} · ${report.source.means} · ${report.delivery.kind} · Order ${report.relatedOrderId}: ${report.summary} Area: ${report.area}; exact position not reported. Observation time not supplied. ${report.retention}. Unknown: ${report.unknown.join(" · ")}.`) };
  }
  function renderDeliveredStatusBrief(document, brief) {
    document.querySelector("#delivered-status-brief").hidden = !brief;
    document.querySelector("#delivered-status-label").textContent = brief?.label ?? "";
    document.querySelector("#delivered-status-contact").textContent = brief?.contact ?? "";
    const reports = document.querySelector("#delivered-status-reports");
    reports.replaceChildren();
    for (const text of brief?.reports.length ? brief.reports : brief ? ["No received report summaries in this picture."] : []) {
      const item = document.createElement("li");
      item.textContent = text; reports.append(item);
    }
  }
  function normalizeOrderDraft(value) {
    const text = value.trim();
    if (!text.length) throw new Error("Enter an order; spaces alone cannot be sent.");
    if (!text.isWellFormed() || text.includes("\0") || [...text].length > 280)
      throw new Error("Use 1–280 well-formed characters, without null characters.");
    return text;
  }

  function notificationTime(value) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
    return { datetime: value, text: new Date(value).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }) };
  }

  // Explicit public fields only. Report IDs identify retained facts, not unique
  // deliveries: the originating order and server receipt time complete identity.
  function reportNotifications(reports) {
    return reports.filter(report => ["local report", "local radio"].includes(report.delivery?.kind))
      .map(report => ({
        id: JSON.stringify(["report", report.id, report.relatedOrderId, report.delivery.receivedAt]),
        receipt: JSON.stringify([report.relatedOrderId, report.delivery.receivedAt]),
        state: "received", label: "Report received", text: report.summary,
        orderId: report.relatedOrderId, timestamp: report.delivery.receivedAt,
        detail: `${report.source.label} · ${report.source.means} · ${report.delivery.kind}. ${report.retention}. Observation time not supplied.`
          + (report.area ? ` Area: ${report.area}; exact position not reported.` : "")
          + (report.unknown?.length ? ` Unknown: ${report.unknown.join(" · ")}.` : ""),
      }));
  }
  // The command feed includes EVERY admitted communication. The floating
  // attention box deliberately contains a much narrower verified subset.
  // G0010 does not yet expose an authoritative "waiting for instructions"
  // event type; never infer such an event from a conversational sentence.
  function attentionReports(reports) {
    if (!Array.isArray(reports)) return [];
    const evidence = receivedTrunkEvidence(reports);
    if (!evidence.coherent || !evidence.latest?.blocked) return [];
    // Two projection cards can represent ONE physical blocking receipt.
    // Surface it once; older blocked receipts stop being current once cleared.
    const latest = reports.find(report => report.delivery?.receivedAt === evidence.latest.stamp
      && report.id === "fallen-trunk-inspected" && report.summary ===
        "Ortega inspected the fallen trunk and reported it blocking Short path. Other obstructions are not ruled out.")
      ?? reports.find(report => report.delivery?.receivedAt === evidence.latest.stamp
        && report.id === "fallen-trunk"
        && report.summary === "Ortega reported a fallen trunk blocking the Short path.");
    if (!latest) return [];
    const entry = reportNotifications([latest])[0];
    return entry ? [{
      ...entry, label: "Route obstruction needs review",
      text: "Short path last reported blocked; current condition not confirmed."
    }] : [];
  }
  function orderNotifications(orders) {
    return orders.slice(0, 20).map(order => ({
      id: `order:${order.orderId}`, ...orderPresentation(order), text: order.text,
      orderId: order.orderId, version: order.resultingMercenaryVersion, timestamp: order.decidedAt,
      detail: `Platform recorded. ${methodSummary(order)}. ${orderFeedback(order)}`,
    }));
  }
  function createNotificationFeed() {
    let baseline = false, watermark = -Infinity, seen = new Set();
    return {
      quiet() { baseline = false; },
      receive(reports) {
        const entries = reportNotifications(reports), fresh = [], receipts = new Set();
        for (const entry of entries) {
          const time = Date.parse(entry.timestamp);
          if (baseline && Number.isFinite(time) && time > watermark && !seen.has(entry.id) && !receipts.has(entry.receipt)) {
            fresh.push(entry); receipts.add(entry.receipt);
          }
          seen.add(entry.id);
        }
        watermark = Math.max(watermark, ...entries.map(entry => Date.parse(entry.timestamp)).filter(Number.isFinite));
        seen = new Set([...seen].slice(-128));
        baseline = true;
        return { entries, fresh };
      },
    };
  }

  function mount(platform) {
    const client = createClient(platform);
    const form = platform.document.querySelector("#invite-form");
    const status = platform.document.querySelector("#access-status");
    if (form instanceof platform.HTMLFormElement && status instanceof platform.HTMLElement) {
      const input = form.querySelector("#invite-code");
      const submit = form.querySelector("#invite-submit");
      const retained = client.readAttempt();
      if (retained && input instanceof platform.HTMLInputElement) input.value = retained.inviteCode;
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!(input instanceof platform.HTMLInputElement) || !(submit instanceof platform.HTMLButtonElement)) return;
        const inviteCode = input.value.trim();
        if (!PROOF_PATTERN.test(inviteCode)) {
          status.textContent = "Enter the complete invite code.";
          return;
        }
        submit.disabled = true;
        status.textContent = "Checking invitation…";
        try {
          status.textContent = await client.submitInvite(inviteCode) ?? "Opening workspace…";
        } catch {
          status.textContent = "Sign-in could not be confirmed. Retry to reconcile the same attempt.";
        } finally {
          submit.disabled = false;
        }
      });
      client.recoverSession().then(recoveryStatus => {
        if (![200, 401].includes(recoveryStatus))
          status.textContent = "Session recovery is temporarily unavailable. You may still retry sign-in.";
      }).catch(() => {
        status.textContent = "Session recovery is temporarily unavailable. You may still retry sign-in.";
      });
    }

    // Monotonic for this document: only a fresh authenticated document may
    // establish another workspace after sign-out or authentication redirect.
    let terminal = false, terminalMessage = "Returning to sign-in…";
    const logout = platform.document.querySelector("#logout");
    if (logout instanceof platform.HTMLButtonElement && status instanceof platform.HTMLElement) {
      client.forgetAttempt();
      logout.addEventListener("click", async () => {
        endWorkspace("Signing out…");
        logout.disabled = true;
        const logoutStatus = platform.document.querySelector("#connection-status") ?? status;
        logoutStatus.textContent = "Signing out…";
        try {
          terminalMessage = await client.logout() ?? "Returning to sign-in…";
        } catch {
          terminalMessage = "Sign-out could not be confirmed. Retry to reconcile this session.";
        } finally {
          logoutStatus.textContent = terminalMessage;
          logout.disabled = false;
        }
      });
    }

    const commandButton = platform.document.querySelector("#submit-command");
    // The real Send button is repeatedly rerendered as authority/retry changes.
    // Keep the approved v0.7 paper-plane SVG mounted instead of destroying it
    // with textContent updates. The text stays in the DOM for test/readback and
    // the current action receives an explicit accessible name.
    const commandGlyph = commandButton?.querySelector(".field-send-icon");
    function labelCommandButton(label) {
      // Icon-only action at all viewport sizes. Text nodes grew below the
      // genuine 44px tap target when the editor expanded or the IME opened.
      // Keep the true action in the accessible name and retry identity.
      if(commandGlyph){
        let text=commandButton.querySelector(".field-send-text");
        if(!text){
          text=platform.document.createElement("span");
          text.className="field-send-text";
          text.hidden=true;
          text.setAttribute("aria-hidden","true");
        }
        text.textContent=label;
        commandButton.replaceChildren(commandGlyph,text);
      }else commandButton.textContent=label;
      commandButton.setAttribute("aria-label", label);
      commandButton.title=label;
      commandButton.dataset.retry = String(label === "Retry exact order");
    }
    const claimButton = platform.document.querySelector("#claim-control");
    const refreshButton = platform.document.querySelector("#refresh-history");
    const historyList = platform.document.querySelector("#command-history");
    if (!(commandButton instanceof platform.HTMLButtonElement)
      || !(claimButton instanceof platform.HTMLButtonElement)
      || !(refreshButton instanceof platform.HTMLButtonElement)
      || !(historyList instanceof platform.HTMLElement)
      || !(status instanceof platform.HTMLElement)) return;

    let projection, mercenary, pending, latestAttempt, busy = false, claiming = false;
    const recordedAcknowledgement = "Order was recorded. Delivery is not confirmed; check history for the response.";
    let localDraft = "", localMethod = "in-person", localOutcome = "", operationalVisible = false, historyScroll;
    let draftIdentity = {};
    let accountId, accountRevision = 0, authorityContext, observationBarrier = 0;
    let commanderRevision = 0, commanderReads = 0, mercenaryRevision = 0, historyRevision = 0;
    let pageCursors = [null], pageIndex = 0, newItems = false, knownNewest = 1;
    let knowledge, knowledgeRevision = 0, knowledgeFloor = 0;
    let picture, pictureRevision = 0, pictureFloor = 0, selectedMapId = "staging-area";
    let historyEntries = [], historyLoaded = false, beforeVersion = null, historyLoading = false, latestOrder;
    const orderVersions = new Map();
    const observedOrders = new Map();
    let minimumVersion = 1, controlMessage = "Checking command control…", orderMessage = "", refreshMessage = "";
    const field = selector => platform.document.querySelector(selector);
    const methodSelect = field("#order-via");
    const viaTouch=field("#field-via-touch");
    const composer = field("#order-text"), orderForm = field("#order-form"), older = field("#older-history");
    if (!composer || !orderForm) return;
    const draftList = field("#draft-tokens");
    let draftDrag, suppressPointerClick = false;
    const operationsMap = field("#operations-map");
    let reportedMapItems = field("#reported-map-items");
    const prepareMapOrder = field("#prepare-map-order"), mapActionStatus = field("#map-action-status");
    if (!operationsMap || !reportedMapItems || !prepareMapOrder || !mapActionStatus) return;
    // Presentation only: keep the mounted draft, selection and report feed intact.
    // A landscape phone can be wider than the portrait breakpoint while still
    // having insufficient height for the desktop/scrolling workspace.
    // One shared compact-mode contract with the CSS shell: every tablet up
    // to 1024px and every short landscape through 704px gets the real map +
    // reachable single command dock. Breakpoint changes never choose a
    // workspace section on behalf of the player.
    const FIELD_COMPACT_QUERY = "(max-width: 64rem), (max-height: 44rem)";
    const mobileWorkspace = platform.matchMedia?.(FIELD_COMPACT_QUERY);
    const ordersPanel = field("#orders-panel"), orderReadback = field("#order-readback");
    const dockToggle = field("#toggle-orders"), operationalWorkspace = field("#operational-workspace");
    const workspaceSections = ["map", "orders", "history"];
    const workspaceFragments = { map: "#operations-title", orders: "#order-form", history: "#history-title" };
    const sectionFromFragment = () => workspaceSections.find(section => workspaceFragments[section] === platform.location.hash)
      ?? (platform.location.hash === "#map-selection-title" ? "map" : undefined);
    const fragmentForSection = section => sectionFromFragment() === section ? platform.location.hash : workspaceFragments[section];
    let initialWorkspaceFragment = sectionFromFragment() ? platform.location.hash : undefined;
    let workspaceSection = sectionFromFragment() ?? "map";
    // Initial Map layout precedes the attention-box initialization. Subsequent
    // navigation must resynchronize it immediately without waiting for polling.
    let alertUiReady = false;
    // Sensitive map children are reconstructed on authentication/control change.
    // Delegate through the stable parent; detached descendants lose listeners.
    const mapInspectLink = () => operationsMap.querySelector(".map-selection-bar a");
    function focusVisibleMapAction() {
      const link=mapInspectLink();
      if(link && !link.closest(".map-selection-bar")?.hidden)link.focus({preventScroll:true});
      else operationsMap.focus?.({preventScroll:true});
    }
    const quickPanel = () => operationsMap.querySelector(".map-selection-bar");
    let mapQuickAnchor, mapPinchSuppressUntil = 0;
    // Local planning cursor belongs to this device/authority observation,
    // NOT a discovered object or a server-confirmed waypoint. Nothing about
    // it enters the shared operations picture or durable history.
    let localCoordinate;
    function renderLocalCoordinateMarker(){
      const marker=operationsMap.querySelector("#map-picked-coordinate-marker");
      if(!marker)return;
      if(localCoordinate){
        marker.removeAttribute("hidden");
        marker.setAttribute("transform",
          `translate(${localCoordinate.svgX} ${localCoordinate.svgY})`);
      }else marker.setAttribute("hidden","");
    }
    function selectLocalCoordinate(event){
      if(!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY)
        || terminal || projection?.control.status!=="active" || workspaceSection!=="map")return;
      const svg=operationsMap.querySelector(".synthetic-range svg");
      const matrix=svg?.getScreenCTM?.();
      if(!matrix || typeof svg.createSVGPoint!=="function")return;
      const click=svg.createSVGPoint();
      click.x=event.clientX;click.y=event.clientY;
      const point=click.matrixTransform(matrix.inverse());
      // The 1000×1000 authored square maps to 10×10km of synthetic local
      // metres, Y increasing north; never infer real-world geolocation.
      if(point.x<0||point.x>1000||point.y<0||point.y>1000)return;
      const x=Math.round(point.x)*10,y=Math.round(1000-point.y)*10;
      localCoordinate={x,y,svgX:point.x,svgY:point.y};
      renderLocalCoordinateMarker();
      const panel=quickPanel();
      if(!panel)return;
      panel.dataset.selected="local-coordinate";
      delete panel.dataset.feedback;
      mapActionStatus.textContent="";
      const label=field("#map-selection-label");
      label.textContent=`X ${x} · Y ${y} m`;
      label.setAttribute("aria-label",`Synthetic local coordinates east ${x} metres, north ${y} metres`);
      field("#map-quick-inspect").hidden=true;
      field("#map-quick-prepare").hidden=true;
      field("#map-quick-add-point").hidden=false;
      panel.setAttribute("aria-label","Selected synthetic local planning coordinate. Not a confirmed waypoint.");
      panel.hidden=false;
      mapQuickAnchor={x:event.clientX,y:event.clientY};
      positionMapQuickActions();
    }
    function hideMapQuickActions() {
      mapQuickAnchor = undefined;
      const panel=quickPanel();
      if (!panel)return;
      const ownedFocus=panel.contains(platform.document.activeElement);
      panel.hidden=true;panel.removeAttribute("data-selected");
      delete panel.dataset.feedback;
      if (ownedFocus) {
        const marker=operationsMap.querySelector('[data-map-id="'+selectedMapId+'"]');
        const target=marker?.getAttribute("aria-disabled")==="false"
          && marker.getClientRects?.().length ? marker : operationsMap;
        target.focus?.({preventScroll:true});
      }
    }
    function positionMapQuickActions() {
      const panel=quickPanel();
      if (!panel || panel.hidden || !mapQuickAnchor
        || typeof panel.getBoundingClientRect !== "function"
        || typeof operationsMap.getBoundingClientRect !== "function") return;
      const region=operationsMap.getBoundingClientRect();
      const size=panel.getBoundingClientRect();
      if (!(region.width>0 && region.height>0 && size.width>0 && size.height>0)) return;
      const x=mapQuickAnchor.x, y=mapQuickAnchor.y, offset=12, margin=6;
      const blockers=["#field-alert-box","#map-report-layer","#orders-panel","#map-scale-hud"]
        .map(sel=>field(sel)).filter(node=>node && !node.hidden && typeof node.getBoundingClientRect==="function")
        .map(node=>node.getBoundingClientRect()).filter(r=>r.width>0 && r.height>0);
      const candidates=[
        [x+offset,y-size.height/2],[x-size.width-offset,y-size.height/2],
        [x-size.width/2,y-size.height-offset],[x-size.width/2,y+offset]
      ];
      const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
      const leftMin=region.left+margin,leftMax=Math.max(leftMin,region.right-size.width-margin);
      const topMin=region.top+margin,topMax=Math.max(topMin,region.bottom-size.height-margin);
      const scored=candidates.map(([cx,cy],i)=>{
        const left=clamp(cx,leftMin,leftMax),top=clamp(cy,topMin,topMax);
        const overlap=blockers.reduce((total,r)=>{
          const w=Math.max(0,Math.min(left+size.width,r.right)-Math.max(left,r.left));
          const h=Math.max(0,Math.min(top+size.height,r.bottom)-Math.max(top,r.top));
          return total+w*h;
        },0);
        const clipping=Math.abs(cx-left)+Math.abs(cy-top);
        return {left,top,penalty:overlap*10+clipping*.3+i};
      }).sort((a,b)=>a.penalty-b.penalty)[0];
      panel.style.left=Math.round(scored.left-region.left)+"px";
      panel.style.top=Math.round(scored.top-region.top)+"px";
    }
    function showMapQuickActions(id, anchor) {
      const panel=quickPanel();
      if (!panel || workspaceSection!=="map")return;
      const target=operationsMap.querySelector('[data-map-id="'+id+'"]');
      if (!target || target.getAttribute("aria-disabled")==="true" || !target.getBoundingClientRect) {
        hideMapQuickActions();return;
      }
      const r=target.getBoundingClientRect();
      const x=Number.isFinite(anchor?.x)?anchor.x:r.left+r.width/2;
      const y=Number.isFinite(anchor?.y)?anchor.y:r.top+r.height/2;
      mapQuickAnchor={x,y};panel.hidden=false;panel.dataset.selected=id;
      delete panel.dataset.feedback;
      field("#map-quick-inspect").hidden=false;
      field("#map-quick-prepare").hidden=false;
      field("#map-quick-add-point").hidden=true;
      field("#map-selection-label").removeAttribute("aria-label");
      panel.setAttribute("aria-label","Selected map point quick actions");
      positionMapQuickActions();
    }
    function showLocalCoordinateOutcome(shortLabel,message,success=false){
      // #map-action-status is source/audit readback inside the inspector,
      // which is deliberately hidden on mobile. Also show the result on the
      // SAME small anchored popup the player just used. Its label is already
      // an aria-live status; preserve full coordinate and outcome for AT.
      mapActionStatus.textContent=message;
      const panel=quickPanel();
      if(!panel || panel.hidden || panel.dataset.selected!=="local-coordinate")return;
      const label=field("#map-selection-label");
      const location=localCoordinate
        ? `local X ${localCoordinate.x}m Y ${localCoordinate.y}m`
        : "selected local planning coordinate";
      label.textContent=shortLabel;
      label.setAttribute("aria-label",location+". "+message);
      panel.dataset.feedback=success?"success":"error";
      panel.setAttribute("aria-label","Local planning coordinate. "+message);
      if(success)field("#map-quick-add-point").hidden=true;
      positionMapQuickActions();
    }
    const mapEvidenceClose = field("#close-map-evidence");
    function closeMapEvidence() {
      delete operationalWorkspace.dataset.evidenceOpen;
    }
    operationsMap.addEventListener("click", event => {
      const link = event.target.closest?.(".map-selection-bar a");
      if (!link || !operationsMap.contains(link)
        || mobileWorkspace?.matches !== true || workspaceSection !== "map") return;
      event.preventDefault();
      hideMapQuickActions();
      operationalWorkspace.dataset.evidenceOpen = "true";
      field("#map-selection-title").focus({ preventScroll: true });
    });
    operationsMap.addEventListener("click", event=>{
      const close=event.target.closest?.("#map-quick-close");
      if (close) {event.preventDefault();hideMapQuickActions();return;}
      const add=event.target.closest?.("#map-quick-add-point");
      if(add && !quickPanel()?.hidden && quickPanel()?.dataset.selected==="local-coordinate"){
        event.preventDefault();
        if(!localCoordinate || !canEditDraft()){
          showLocalCoordinateOutcome("Unavailable",
            "Draft editing is unavailable while control or an order attempt is pending.");
          return;
        }
        const phrase=`local X ${localCoordinate.x}m Y ${localCoordinate.y}m`;
        const proposed=[composer.value.trim(),phrase].filter(Boolean).join(" ");
        if(proposed.length>280){
          showLocalCoordinateOutcome("Too long",
            "Existing draft kept: coordinate text exceeds the 280-character order limit.");
          return;
        }
        if(mutateDraft(proposed)){
          // A minimized dock has display:none. Updating its hidden textarea
          // and focusing it strands the player without visible draft or Send.
          // Restore using the EXISTING vetted handler; do not synthesize a
          // second editor, issue an order or navigate away from Map.
          if(dockMinimized)field("#field-restore-dock").click();
          showLocalCoordinateOutcome("Added",
            "Planning coordinates inserted as text only; not a validated waypoint or executable route.",true);
          composer.focus({preventScroll:true});
        }
        return;
      }
      const prepare=event.target.closest?.("#map-quick-prepare");
      if (prepare && !quickPanel()?.hidden && quickPanel()?.dataset.selected===selectedMapId) {
        event.preventDefault();field("#prepare-map-order")?.click();return;
      }
    });
    mapEvidenceClose?.addEventListener("click", () => {
      closeMapEvidence();
      focusVisibleMapAction();
    });
    platform.addEventListener("keydown", event => {
      if (event.key === "Escape" && quickPanel() && !quickPanel().hidden && operationalWorkspace.dataset.evidenceOpen !== "true") {
        event.preventDefault(); hideMapQuickActions();
        return;
      }
      if (event.key === "Escape" && operationalWorkspace.dataset.evidenceOpen === "true"
        && !field("#people")?.open && !field("#notifications")?.open) {
        event.preventDefault(); closeMapEvidence();
        focusVisibleMapAction();
      }
    });
    function sizeMapTargets() {
      const svg = operationsMap.querySelector(".synthetic-range svg");
      if (!svg) return;
      const box = svg.getBoundingClientRect();
      // Short maps retain geography, with selection through Places or typing.
      // Zoom may also clip a source marker; never retain an invisible tab stop.
      const compact = Math.min(box.width, box.height) < 220;
      for (const target of operationsMap.querySelectorAll("g[data-map-id]")) {
        const marker = target.querySelector(".range-place-hit")?.getBoundingClientRect();
        const clipped = marker && (marker.left + marker.width / 2 < box.left + 22
          || marker.right - marker.width / 2 > box.right - 22
          || marker.top + marker.height / 2 < box.top + 22
          || marker.bottom - marker.height / 2 > box.bottom - 22);
        const disabled = compact || !!clipped;
        target.setAttribute("tabindex", disabled ? "-1" : "0");
        target.setAttribute("aria-disabled", String(disabled));
        if (disabled && target.contains(platform.document.activeElement)) focusVisibleMapAction();
      }
    }
    // 100 SVG units = one kilometre on the authored 1000-unit square map.
    // SVG defaults to xMidYMid meet, so the smaller rendered dimension sets
    // the physical world-to-screen ratio on portrait and landscape alike.
    function mapScaleForViewport(viewBoxSize, svgWidth, svgHeight) {
      if (![viewBoxSize,svgWidth,svgHeight].every(Number.isFinite)
        || viewBoxSize<=0 || svgWidth<=0 || svgHeight<=0) return null;
      const pixelsPerKm=100*Math.min(svgWidth,svgHeight)/viewBoxSize;
      const choices=[.1,.2,.25,.5,1,2,2.5,5,10];
      const candidates=choices.map(km=>({km,pixels:km*pixelsPerKm}));
      const preferred=candidates.filter(item=>item.pixels>=54&&item.pixels<=125);
      const chosen=(preferred.length?preferred:candidates).sort((a,b)=>
        Math.abs(a.pixels-90)-Math.abs(b.pixels-90)||a.km-b.km)[0];
      return {kilometres:chosen.km,label:chosen.km+" km",pixels:chosen.pixels};
    }
    let mapZoom = 0;
    function renderMapScale(viewBoxSize=1000/Math.pow(1.35,mapZoom)) {
      const svg=operationsMap.querySelector(".synthetic-range svg");
      const hud=operationsMap.querySelector("#map-scale-hud");
      if (!svg || !hud || typeof svg.getBoundingClientRect!=="function")return;
      const bounds=svg.getBoundingClientRect();
      const value=mapScaleForViewport(viewBoxSize,bounds.width,bounds.height);
      if (!value)return;
      const rule=hud.querySelector("#map-scale-rule"), label=hud.querySelector("#map-scale-label");
      if (!rule||!label)return;
      rule.style.width=value.pixels.toFixed(2)+"px";
      label.textContent=value.label;
      hud.setAttribute("aria-label",`Map scale: ${value.label}`);
    }
    function renderMapZoom() {
      const mapSvg = operationsMap.querySelector(".synthetic-range svg");
      if (!mapSvg) return;
      // The PUBLIC synthetic test range is the only cartographic source.
      const size = 1000 / Math.pow(1.35, mapZoom);
      const origin = (1000 - size) / 2;
      mapSvg.setAttribute("viewBox", [origin, origin, size, size].join(" "));
      const zoomLabel = field("#field-map-zoom-readout");
      if (zoomLabel) zoomLabel.textContent =
        `ZOOM ${Math.round(Math.pow(1.35, mapZoom)*100)}% · TAP TO SELECT`;
      sizeMapTargets();
      renderMapScale(size);
    }
    platform.addEventListener("resize",()=>renderMapScale());
    platform.visualViewport?.addEventListener?.("resize",()=>renderMapScale());
    // The fixed command dock can change the map element's size WITHOUT a
    // window/visualViewport event (minimize/restore, readback, etc.).
    // Observe the stable map container, not the transient SVG child which
    // is rebuilt during authority scrubs. The HUD is absolute, so adjusting
    // its bar cannot feed back into the observed map dimensions.
    if (platform.ResizeObserver) {
      const mapScaleObserver = new platform.ResizeObserver(()=>renderMapScale());
      mapScaleObserver.observe(operationsMap);
    }
    // A real two-pointer pinch replaces the removed +, minus and reset
    // buttons. Gestures change only the bounded SVG viewBox; no order or
    // gameplay mutation occurs. Keyboard +/- and Home remain available.
    const mapTouches=new Map();
    let pinchBase;
    // Android long press should never invoke browser text selection, drag
    // preview, search or a native copy-callout over the map surface. This
    // does not affect selectable evidence/report text outside the map.
    for(const name of ["contextmenu","selectstart","dragstart"]){
      operationsMap.addEventListener(name,event=>{
        if(event.target.closest?.(".synthetic-range svg"))event.preventDefault();
      });
    }
    const pinchDistance=()=> {
      const points=[...mapTouches.values()];
      return points.length<2?0:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
    };
    operationsMap.addEventListener("pointerdown",event=>{
      if(event.pointerType!=="touch" || !event.target.closest?.(".synthetic-range svg"))return;
      mapTouches.set(event.pointerId,{x:event.clientX,y:event.clientY});
      // A fresh single-finger contact after a pinch is a NEW tap, not the
      // compatibility click from the finished two-finger gesture.
      if(mapTouches.size===1 && !pinchBase)mapPinchSuppressUntil=0;
      if(mapTouches.size===2){
        const distance=pinchDistance();
        pinchBase=distance>4?{distance,zoom:mapZoom}:undefined;
        mapPinchSuppressUntil=Date.now()+750;
        hideMapQuickActions();
      }
    });
    operationsMap.addEventListener("pointermove",event=>{
      if(!mapTouches.has(event.pointerId))return;
      mapTouches.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(!pinchBase || mapTouches.size!==2)return;
      const distance=pinchDistance();
      if(distance<=3)return;
      event.preventDefault();
      const next=pinchBase.zoom+Math.log(distance/pinchBase.distance)/Math.log(1.35);
      mapZoom=Math.max(0,Math.min(3,next));
      mapPinchSuppressUntil=Date.now()+750;
      renderMapZoom();
    });
    const endMapTouch=event=>{
      if(!mapTouches.has(event.pointerId))return;
      mapTouches.delete(event.pointerId);
      if(pinchBase)mapPinchSuppressUntil=Date.now()+750;
      if(mapTouches.size<2)pinchBase=undefined;
    };
    for(const eventName of ["pointerup","pointercancel","lostpointercapture"])
      operationsMap.addEventListener(eventName,endMapTouch);
    operationsMap.addEventListener("keydown",event=>{
      if(event.target!==operationsMap || !["+", "=","-","_","Home"].includes(event.key))return;
      event.preventDefault();
      mapZoom=event.key==="Home"?0:Math.max(0,Math.min(3,mapZoom+(["+", "="].includes(event.key)?1:-1)));
      hideMapQuickActions();
      renderMapZoom();
    });
    renderMapZoom();
    // The visible v0.7-style Reports tab navigates to the REAL received
    // history, never a fake demo conversation or a server write.
    field("#field-read-reports")?.addEventListener("click", () => {
      selectWorkspaceSection("history");
      const reports = field("#received-reports");
      if (reports) {
        reports.open = true;
        const destination=reports.querySelector("summary");
        destination?.focus({ preventScroll: true });
        revealWorkspaceTarget(destination);
      }
    });
    const fieldCommandPreview = field("#field-command-preview"), issuedReadback = field("#ortega-response");
    const fieldReportPreview = field("#field-report-preview"), receivedReadback = field("#ortega-report");
    if (fieldCommandPreview && fieldReportPreview && issuedReadback && receivedReadback && platform.MutationObserver) {
      const updatePreview = () => {
        // Both rows are projections of EXISTING authenticated records, not
        // invented conversation messages. Keep the order/report distinction.
        // Only an authenticated issued-order identity permits an Issued
        // preview. Generic "Refresh history" fallback text is NOT evidence.
        const issued = field("#ortega-response-label")?.dataset.orderId
          ? issuedReadback.textContent?.trim() : "";
        const received = receivedReadback.textContent?.trim();
        fieldCommandPreview.textContent = issued
          ? "Issued · " + issued.slice(0, 180)
          : "No recorded order. Draft stays local until Send.";
        fieldReportPreview.textContent = received && received !== "No outing report received."
          ? "Received · " + received.slice(0, 180)
          : "No received field report.";
      };
      for (const source of [issuedReadback, receivedReadback])
        new platform.MutationObserver(updatePreview).observe(source, {
          subtree: true, characterData: true, childList: true
        });
      updatePreview();
    }
    function revealWorkspaceTarget(target) {
      if (!target || mobileWorkspace?.matches === true || !operationalVisible
        || typeof target.getBoundingClientRect !== "function"
        || typeof target.scrollIntoView !== "function") return;
      const rect=target.getBoundingClientRect();
      const nav=field(".workspace-nav")?.getBoundingClientRect();
      const safeTop=(nav?.bottom && nav.top <= platform.innerHeight && nav.bottom>0
        ? nav.bottom : 0)+8;
      if (rect.bottom<=safeTop || rect.top>=platform.innerHeight-12
        || rect.left>=platform.innerWidth || rect.right<=0)
        target.scrollIntoView({block:"start",inline:"nearest",behavior:"instant"});
    }
    function visibleSectionFocusTarget() {
      return field(workspaceSection==="orders"?"#order-form":
        workspaceSection==="history"?"#history-title":"#operations-title");
    }
    function syncBottomNavSelection() {
      // People/Items/Places are workspace sheets over Map, not simultaneous
      // destinations. One visible selection is shared by visual styling and
      // aria-current; aria-expanded independently describes each disclosure.
      const selectedSheet = [["people","#people"],["items","#field-items"],
        ["places","#field-places"]].find(([,selector])=>field(selector)?.open);
      const selected = selectedSheet?.[0] ?? workspaceSection;
      for (const destination of ["map","orders","history","people","items","places"]) {
        const link = field("#nav-"+destination);
        if (!link) continue;
        if (destination===selected) link.setAttribute("aria-current","location");
        else link.removeAttribute("aria-current");
      }
    }
    function renderWorkspaceSection() {
      const mobile = mobileWorkspace?.matches === true;
      if (!mobile || workspaceSection !== "map") {
        closeMapEvidence();
        hideMapQuickActions();
      }
      if (mapEvidenceClose) mapEvidenceClose.hidden = !mobile;
      const viewLabel = field("#field-view-label");
      if (viewLabel) viewLabel.textContent = workspaceSection.toUpperCase();
      const compact = mobile && workspaceSection === "map";
      operationalWorkspace.dataset.section = workspaceSection;
      ordersPanel.dataset.dock = compact ? "compact" : "expanded";
      const minimizeControl=field("#field-minimize-dock");
      if (minimizeControl) minimizeControl.hidden=!compact;
      if (alertUiReady && !compact) {
        // A stale minimized state must not survive entry to Orders/desktop.
        dockMinimized=false;
        ordersPanel.dataset.minimized="false";
        miniTray.hidden=true;
      }
      orderReadback.hidden = compact;
      dockToggle.hidden = !mobile;
      dockToggle.setAttribute("aria-expanded", String(!compact));
      // One real button with a compact panel icon or a small close X.
      // No visible Back-to-map sentence or cheap caret, and no duplicate
      // click target. Announce the action semantically on both states.
      dockToggle.setAttribute("aria-label", compact ? "Open order details" : "Close order details and return to map");
      dockToggle.title = compact ? "Open order details" : "Close order details and return to map";
      for (const section of workspaceSections) {
        field(`#${section}-panel`).hidden = mobile && section !== workspaceSection && !(section === "orders" && compact);
      }
      syncBottomNavSelection();
      sizeMapTargets();
      if (alertUiReady) updateAttentionBox();
    }
    function selectWorkspaceSection(section, navigate = true) {
      // One navigation contract owns auxiliary-sheet cleanup. Direct Reports,
      // dock expansion, menu links, hashchange Back/Forward, and programmatic
      // commands all enter HERE; per-button cleanup missed valid routes.
      // At initial mounting, there cannot be open private sheets.
      if (operationalVisible) closeWorkspaceSheets(null);
      if (section !== "map") closeMapEvidence();
      workspaceSection = section; renderWorkspaceSection();
      sizeMobileWorkspace();
      mainMenu?.removeAttribute("open");
      if (navigate && mobileWorkspace?.matches && platform.location.hash !== workspaceFragments[section])
        platform.location.hash = workspaceFragments[section];
      if (navigate && mobileWorkspace?.matches !== true)
        revealWorkspaceTarget(visibleSectionFocusTarget());
    }
    function resetWorkspaceSection() {
      selectWorkspaceSection("map", false);
      // Authority changes are not navigation. Replace only the current fragment;
      // Back/Forward may select a panel but can never restore scrubbed records.
      if (mobileWorkspace?.matches && sectionFromFragment())
        platform.history.replaceState(platform.history.state, "", workspaceFragments.map);
    }
    dockToggle.addEventListener("click", () => {
      const section = workspaceSection === "orders" ? "map" : "orders";
      selectWorkspaceSection(section);
      field(section === "orders" ? "#order-text" : "#operations-title").focus();
      positionToast();
    });
    for (const section of workspaceSections) {
      field(`#nav-${section}`).addEventListener("click", event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        // Reveal and focus synchronously at every width, even for the current fragment.
        // Native anchor navigation still owns the URL, history and scrolling.
        selectWorkspaceSection(section, false);
        field(section === "orders" ? "#order-form" : section === "map" ? "#operations-title" : "#history-title").focus();
        positionToast();
      });
    }
    platform.addEventListener("hashchange", () => {
      const next=sectionFromFragment()??"map";
      // Programmatically opening a People sheet can also move the underlying
      // mobile workspace back to Map. The resulting same-section hashchange
      // is NOT a second user navigation, and must not close that new sheet
      // OR steal keyboard focus from its Close/Inspect controls.
      const unchanged=next===workspaceSection;
      if (!unchanged)selectWorkspaceSection(next,false);
      const sheetFocused=unchanged && (field("#people")?.open
        || field("#field-items")?.open || field("#field-places")?.open
        || !field("#field-context-tools")?.hidden);
      if (!sheetFocused && operationalVisible
        && !field(`#${workspaceSection}-panel`).contains(platform.document.activeElement))
        field(fragmentForSection(workspaceSection)).focus();
    });
    mobileWorkspace?.addEventListener("change", () => {
      // The chosen section is user intent, NOT an inference from the focused
      // element. Map includes a live composer; focusing it must never switch
      // Map to Orders when a screen rotates or a breakpoint is crossed.
      const previousFocus=platform.document.activeElement;
      const focusedInTray=field("#field-mini-tray")?.contains(previousFocus);
      renderWorkspaceSection();
      sizeMobileWorkspace();
      // A desktop/expanded layout can leave the same valid focused control
      // far down a scrolling document. Reveal it without changing sections
      // or draft/authority identity. The next frame owns the final geometry.
      platform.requestAnimationFrame?.(()=>{
        if (!operationalVisible) return;
        const focused=focusedInTray ? visibleSectionFocusTarget() : previousFocus;
        if (focusedInTray || (focused && !focused.getClientRects?.().length)) {
          const fallback=visibleSectionFocusTarget();
          fallback?.focus?.({preventScroll:true});
          revealWorkspaceTarget(fallback);
        } else revealWorkspaceTarget(focused);
        positionMapQuickActions();
        renderMapScale();
      });
    });
    function sizeMobileWorkspace() {
      const viewport = platform.visualViewport;
      const height = viewport?.height ?? platform.innerHeight;
      if (!Number.isFinite(height)) return;
      const style = platform.document.documentElement.style;
      const px=(name,value)=>{
        const next=Math.round(value)+"px";
        if (style.getPropertyValue?.(name)!==next)style.setProperty(name,next);
      };
      const visualTop=viewport?.offsetTop??0;
      px("--workspace-height",height);
      px("--workspace-bottom",Math.max(0,platform.innerHeight-height-visualTop));
      // When the IME shrinks visualViewport independently of CSS media
      // queries, preserving the nominal three-button stack leaves NO space
      // above the real dock for a sheet. Compress only unimplemented voice
      // and nonessential readbacks; retain the one real textarea, VIA, Send
      // and four bottom destinations. Also cover physically tiny screens.
      const keyboardReduced=platform.innerHeight-height>110;
      // Insets consume real display height even when a native keyboard has
      // not opened. On a notched short phone the nominal dock can still leave
      // only 50px above it: use the same stable compact presentation rather
      // than deriving layout mode from its OWN adjusted measurements.
      const safeBottom=Number.parseFloat(
        platform.getComputedStyle?.(platform.document.documentElement)
          ?.getPropertyValue("--field-safe-bottom"))||0;
      const constrained=mobileWorkspace?.matches===true
        && (height<=380 || (keyboardReduced && height<490)
          || (height<=445 && safeBottom>=12));
      operationalWorkspace.dataset.visualConstrained=String(constrained);
      const nav=field(".workspace-nav").getBoundingClientRect();
      const dock=ordersPanel.getBoundingClientRect();
      const header=field(".workspace-header")?.getBoundingClientRect();
      operationalWorkspace.dataset.dockFlow=String(height<560||dock.height>height*.55);
      px("--workspace-nav-height",nav.height);
      px("--workspace-dock-height",dock.height);
      px("--workspace-header-height",header?.height??0);
      // Geometry, not --field-dock estimates, owns every sheet's bottom
      // boundary. The actual dock may shrink or move as visualViewport opens
      // the keyboard, as safe-area padding changes, or after minimization.
      // Both edges are FIXED-layout coordinates, adjusted for visualViewport.
      const blockers=[nav.top];
      // display:none minimized dock has a zero rect at (0,0). It MUST NOT
      // collapse sheets above it; the separate Restore tray is the actual
      // live control to keep uncovered.
      // Only Map's compact composer is a bottom obstruction. Expanded
      // Orders is a full page whose top is just beneath the header; treating
      // it as a bottom dock collapses the Orders contextual drawer to zero.
      if (workspaceSection==="map" && ordersPanel.dataset.dock==="compact"
        && dock.height>0 && !ordersPanel.hidden)blockers.push(dock.top);
      const tray=field("#field-mini-tray");
      if (tray && !tray.hidden) {
        const rect=tray.getBoundingClientRect();
        if (rect.height>0)blockers.push(rect.top);
      }
      const boundary=Math.min(...blockers)-8;
      const sheetTop=Math.max(visualTop+4,(header?.bottom??visualTop)+4);
      px("--workspace-sheet-top",sheetTop);
      px("--workspace-sheet-bottom",Math.max(0,platform.innerHeight-boundary));
      sizeMapTargets();
    }
    platform.visualViewport?.addEventListener("resize", sizeMobileWorkspace);
    platform.visualViewport?.addEventListener("scroll", sizeMobileWorkspace);
    platform.addEventListener("resize", sizeMobileWorkspace);
    if(platform.ResizeObserver){
      const shellGeometry=new platform.ResizeObserver(sizeMobileWorkspace);
      shellGeometry.observe(ordersPanel);
      shellGeometry.observe(field(".workspace-nav"));
    }
    sizeMobileWorkspace();
    renderWorkspaceSection();
    sizeMobileWorkspace();
    const mapTemplate = operationsMap.innerHTML;
    const newer = field("#newer-history"), latest = field("#latest-history"), indication = field("#history-new-items");
    const opaque = () => `ortega:${platform.crypto.randomUUID()}`;
    const sameAuthority = (left, right) => left && right && left.accountId === right.accountId
      && left.grantId === right.grantId && left.controlVersion === right.controlVersion;
    const visibleAttempt = attempt => !terminal && latestAttempt === attempt && attempt.accountRevision === accountRevision;
    const replaceDraftIdentity = () => { draftIdentity = {}; };
    function mutateDraft(text, observedInput = false) {
      // Preserve the existing identity fence even for a late input notification.
      // Disabled native inputs cannot be edited; chip mutations still require control.
      if (observedInput) replaceDraftIdentity();
      if (!canEditDraft()) return false;
      cancelDraftDrag();
      composer.value = text;
      if (!observedInput) replaceDraftIdentity();
      renderContextualActions(contextualActions(selectedMapId, picture), mapItems().get(selectedMapId)?.title);
      sizeMobileWorkspace();
      return true;
    }
    composer.addEventListener("input", () => mutateDraft(composer.value, true));
    // Pointer VIA menu sits beside the real native select, not an alternative
    // delivery contract. The native select stays available to keyboard and
    // assistive technology, including the same form serialization.
    const viaChoices=platform.document.createElement("div");
    viaChoices.id="field-via-choices";
    viaChoices.className="field-via-choices";
    viaChoices.setAttribute("role","group");
    viaChoices.setAttribute("aria-label","Choose delivery method");
    viaChoices.hidden=true;
    for(const [value,label] of [["in-person","Person"],["radio","Radio"]]){
      const button=platform.document.createElement("button");
      button.type="button";button.dataset.method=value;button.textContent=label;
      button.setAttribute("aria-label",label+" delivery method");
      button.setAttribute("aria-pressed","false");
      viaChoices.append(button);
    }
    platform.document.body.append(viaChoices);
    function closeViaChoices(returnFocus=false){
      if(viaChoices.hidden)return;
      viaChoices.hidden=true;viaTouch.setAttribute("aria-expanded","false");
      if(returnFocus&&!methodSelect.disabled)methodSelect.focus({preventScroll:true});
    }
    function positionViaChoices(){
      if(viaChoices.hidden)return;
      const anchor=methodSelect.getBoundingClientRect();
      const height=viaChoices.getBoundingClientRect().height;
      const width=viaChoices.getBoundingClientRect().width;
      const left=Math.max(6,Math.min(platform.innerWidth-width-6,anchor.right-width));
      const bottom=Math.max(6,platform.innerHeight-anchor.top+5);
      const top=Math.max(6,anchor.top-height-5);
      viaChoices.style.left=Math.round(left)+"px";
      viaChoices.style.top=Math.round(top)+"px";
      // In a keyboard-reduced viewport the popup may have to open downward.
      if(top+height>anchor.top-2&&anchor.bottom+height+6<platform.innerHeight)
        viaChoices.style.top=Math.round(anchor.bottom+5)+"px";
    }
    function syncViaChoices(){
      viaTouch.disabled=methodSelect.disabled;
      viaTouch.setAttribute("aria-expanded",String(!viaChoices.hidden));
      for(const button of viaChoices.querySelectorAll("button")){
        button.setAttribute("aria-pressed",String(button.dataset.method===methodSelect.value));
        button.disabled=methodSelect.disabled;
      }
      if(methodSelect.disabled)closeViaChoices();
    }
    viaTouch.addEventListener("click",event=>{
      event.stopPropagation();
      if(methodSelect.disabled)return;
      viaChoices.hidden=!viaChoices.hidden;
      syncViaChoices();
      positionViaChoices();
      if(!viaChoices.hidden){
        const active=viaChoices.querySelector('[aria-pressed="true"]');
        active?.focus({preventScroll:true});
      }
    });
    viaChoices.addEventListener("click",event=>{
      const button=event.target.closest?.("button[data-method]");
      if(!button||methodSelect.disabled)return;
      methodSelect.value=button.dataset.method;
      methodSelect.dispatchEvent(new platform.Event("change",{bubbles:true}));
      closeViaChoices(true);
    });
    platform.document.addEventListener("pointerdown",event=>{
      if(!viaChoices.hidden&&!viaChoices.contains(event.target)&&event.target!==viaTouch)
        closeViaChoices();
    },true);
    platform.document.addEventListener("keydown",event=>{
      if(event.key==="Escape"&&!viaChoices.hidden){
        event.preventDefault();event.stopPropagation();closeViaChoices(true);
      }
    },true);
    platform.addEventListener("resize",positionViaChoices);
    platform.visualViewport?.addEventListener?.("resize",positionViaChoices);
    methodSelect.addEventListener("change",()=>{
      replaceDraftIdentity();syncViaChoices();
    });
    function retireAttemptDraft(attempt) {
      // Draft identity survives privacy scrubs, but not edits or account round trips.
      // Definitive headers can retire it without admitting any old private body.
      if (terminal || attempt.accountRevision !== accountRevision || attempt.draftIdentity !== draftIdentity) return;
      localDraft = ""; composer.value = ""; replaceDraftIdentity();
    }

    const alertBox = field("#field-alert-box"), alertToggle = field("#field-alert-toggle"),
      alertPeek = field("#field-alert-peek"), alertList = field("#field-alert-list");
    const miniTray = field("#field-mini-tray");
    alertUiReady = true;
    let dockMinimized = false, alertExpanded = false;
    // Remember each orientation's placement independently. The initial portrait
    // placement is immediately above the dock on the right; rotated phones
    // start to the left of the narrower landscape command dock.
    const alertPositions = {portrait:{x:1,y:1},landscape:{x:0,y:.55}};
    const alertOrientation = () => platform.innerWidth > platform.innerHeight ? "landscape" : "portrait";
    const alertPosition = () => alertPositions[alertOrientation()];
    const assignAlertPosition = point => { alertPositions[alertOrientation()] = point; };
    let alertGesture, alertHoldTimer, suppressAlertClickUntil = 0;
    const notificationDialog = field("#notifications"), notificationList = field("#notification-list");
    const notificationButton = field("#open-notifications"), toast = field("#notification-toast");
    let notificationFeed = createNotificationFeed(), notificationOrders = [], notificationReports = [];
    let notificationOrderState = "Loading order records…", notificationReportState = "Loading delivered reports…";
    let notificationSignature = "", toastQueue = [], toastTimer, pollTimer, pollRunning = false, pageActive = true, connected = platform.navigator.onLine !== false;
    let toastRemaining = 8000, toastStarted = 0, returnNotificationFocus = false;
    let notificationReturnTarget;
    function clearToasts() {
      platform.clearTimeout(toastTimer); toastStarted = 0; toastQueue = []; toast.hidden = true;
      field("#open-notification-toast").textContent = "";
      field("#notification-announcement").textContent = "";
    }
    function quietNotifications() { notificationFeed.quiet(); clearToasts(); }
    function positionToast() {
      // Clear the whole dock, including readback/outcome, and bottom navigation.
      const height = platform.visualViewport?.height ?? platform.innerHeight;
      const offset = platform.visualViewport?.offsetTop ?? 0;
      const nav = field(".workspace-nav").getBoundingClientRect();
      const bottomNav = mobileWorkspace?.matches === true;
      const safeTop = Math.max(offset + 12, !bottomNav && nav.bottom > offset && nav.top < offset + height ? nav.bottom + 12 : 0);
      const dock = ordersPanel.getBoundingClientRect();
      const availableBottom = bottomNav ? Math.min(offset + height, nav.top) : offset + height;
      const safeBottom = dock.bottom > offset && dock.top < availableBottom
        ? Math.min(availableBottom, dock.top) : availableBottom;
      toast.style.setProperty("--notification-bottom", `${Math.max(0, platform.innerHeight - safeBottom)}px`);
      toast.hidden = !toastQueue.length || notificationDialog.open || !notificationsActive();
      if (!toast.hidden && toast.getBoundingClientRect().top < safeTop) toast.hidden = true;
    }
    function notificationsActive() {
      return !terminal && pageActive && connected && !platform.document.hidden && projection?.control.status === "active";
    }
    function showToast() {
      platform.clearTimeout(toastTimer); toastStarted = 0;
      const entry = toastQueue[0];
      if (!entry) { toast.hidden = true; field("#open-notification-toast").textContent = ""; return; }
      field("#open-notification-toast").textContent = `Report received · ${[...entry.text].slice(0, 140).join("")}${[...entry.text].length > 140 ? "…" : ""}`;
      positionToast();
      if (!toast.hidden) field("#notification-announcement").textContent = "New report received. Open Updates to read it.";
      toastRemaining = 8000; resumeToast();
    }
    function pauseToast() {
      platform.clearTimeout(toastTimer);
      if (toastStarted) toastRemaining = Math.max(0, toastRemaining - (Date.now() - toastStarted));
      toastStarted = 0;
    }
    function resumeToast() {
      if (!toastQueue.length || toast.contains(platform.document.activeElement) || toast.matches(":hover")) return;
      platform.clearTimeout(toastTimer); toastStarted = Date.now();
      toastTimer = platform.setTimeout(dismissToast, toastRemaining);
    }
    toast.addEventListener("pointerenter", pauseToast);
    toast.addEventListener("pointerleave", resumeToast);
    toast.addEventListener("focusin", pauseToast);
    toast.addEventListener("focusout", () => platform.setTimeout(resumeToast, 0));
    function dismissToast() {
      if (toast.contains(platform.document.activeElement)) notificationButton.focus({ preventScroll: true });
      toastQueue.shift(); field("#notification-announcement").textContent = ""; showToast();
    }
    function alertBounds() {
      // Restrict dragging to the owned map footprint; an open peek is clamped
      // separately and never becomes a document-sized floating overlay.
      const map = field("#map-panel").getBoundingClientRect();
      const nav = field(".workspace-nav").getBoundingClientRect();
      const header = field(".workspace-header").getBoundingClientRect();
      const bottom = Math.min(nav.top, map.bottom);
      const top = Math.max(header.bottom + 6, map.top + 6);
      return {left:map.left+7, top,
        width:Math.max(0,map.width-alertBox.offsetWidth-14),
        height:Math.max(0,bottom-top-alertBox.offsetHeight-7)};
    }
    function positionAlert() {
      if (alertBox.hidden || typeof field("#map-panel")?.getBoundingClientRect !== "function"
        || typeof field(".workspace-nav")?.getBoundingClientRect !== "function"
        || typeof field(".workspace-header")?.getBoundingClientRect !== "function") return;
      const b=alertBounds();
      const selected=alertPosition();
      const left=b.left+b.width*selected.x, top=b.top+b.height*selected.y;
      alertBox.style.left=Math.round(left)+"px";
      alertBox.style.top=Math.round(top)+"px";
      const peekWidth=Math.min(300,platform.innerWidth-18);
      const inset=Math.max(9,Math.min(platform.innerWidth-peekWidth-9,left+alertBox.offsetWidth-peekWidth));
      alertBox.style.setProperty("--field-alert-peek-left",Math.round(inset-left)+"px");
      const header=field(".workspace-header").getBoundingClientRect();
      const nav=field(".workspace-nav").getBoundingClientRect();
      const map=field("#map-panel").getBoundingClientRect();
      const above=Math.max(0,top-header.bottom-9);
      const below=Math.max(0,Math.min(nav.top,map.bottom)-(top+alertBox.offsetHeight)-9);
      const openBelow=below>above;
      alertBox.classList.toggle("peek-below",openBelow);
      alertBox.style.setProperty("--field-alert-peek-limit",Math.max(18,Math.min(250,openBelow?below:above))+"px");
    }
    function moveAlert(dx,dy,start) {
      const b=alertBounds();
      assignAlertPosition({x:b.width?Math.max(0,Math.min(1,start.x+dx/b.width)):0,
        y:b.height?Math.max(0,Math.min(1,start.y+dy/b.height)):0});
      positionAlert();
    }
    function updateAttentionBox() {
      const available=notificationsActive() && operationalVisible
        && workspaceSection==="map" && mobileWorkspace?.matches === true;
      alertBox.hidden=!available;
      if (!available) { alertExpanded=false;alertPeek.hidden=true;alertToggle.setAttribute("aria-expanded","false");return; }
      const entries=attentionReports(picture?.reports);
      field("#field-alert-count").textContent=String(entries.length);
      field("#field-alert-caption").textContent=entries.length
        ? "Route obstruction · review" : "No priority updates";
      alertList.replaceChildren();
      for (const entry of entries) {
        const item=platform.document.createElement("li"),label=platform.document.createElement("strong"),
          summary=platform.document.createElement("span");
        label.textContent=entry.label;
        summary.textContent=entry.text;
        item.append(label,summary);alertList.append(item);
      }
      if (!entries.length) {
        const empty=platform.document.createElement("li");
        empty.textContent="Nothing currently requires attention. Open the command log for all communications.";
        alertList.append(empty);
      }
      alertPeek.hidden=!alertExpanded;
      alertToggle.setAttribute("aria-expanded",String(alertExpanded));
      positionAlert();
    }
    alertToggle.addEventListener("pointerdown",e=>{
      if (e.button!==0 || e.isPrimary===false) return;
      const g=alertGesture={pointerId:e.pointerId,clientX:e.clientX,clientY:e.clientY,
        start:{...alertPosition()},active:false,cancelled:false,moved:false};
      alertToggle.setPointerCapture(e.pointerId);
      platform.clearTimeout(alertHoldTimer);
      alertHoldTimer=platform.setTimeout(()=>{
        if (alertGesture===g && !g.cancelled) {
          g.active=true;alertToggle.classList.add("repositioning");
        }
      },410);
    });
    alertToggle.addEventListener("pointermove",e=>{
      const g=alertGesture;if (!g || g.pointerId!==e.pointerId) return;
      const dx=e.clientX-g.clientX,dy=e.clientY-g.clientY;
      if (!g.active) {
        if(Math.hypot(dx,dy)>9){g.cancelled=true;platform.clearTimeout(alertHoldTimer);}
        return;
      }
      e.preventDefault();if(Math.hypot(dx,dy)>2){g.moved=true;moveAlert(dx,dy,g.start);}
    });
    function finishAlertGesture(e) {
      const g=alertGesture;if(!g||g.pointerId!==e.pointerId)return;
      platform.clearTimeout(alertHoldTimer);alertToggle.classList.remove("repositioning");
      if(e.type==="pointercancel"&&g.active){assignAlertPosition(g.start);positionAlert();}
      if(g.active||g.cancelled)suppressAlertClickUntil=Date.now()+750;
      alertGesture=undefined;
    }
    alertToggle.addEventListener("pointerup",finishAlertGesture);
    alertToggle.addEventListener("pointercancel",finishAlertGesture);
    alertToggle.addEventListener("lostpointercapture",e=>{
      if(!alertGesture||alertGesture.pointerId!==e.pointerId)return;
      platform.clearTimeout(alertHoldTimer);alertToggle.classList.remove("repositioning");
      if(alertGesture.active){assignAlertPosition(alertGesture.start);positionAlert();}
      alertGesture=undefined;
    });
    alertToggle.addEventListener("click",e=>{
      if(e.detail!==0 && Date.now()<suppressAlertClickUntil){e.preventDefault();return;}
      if(!notificationsActive())return;
      alertExpanded=!alertExpanded;updateAttentionBox();
    });
    alertToggle.addEventListener("contextmenu",e=>e.preventDefault());
    alertToggle.addEventListener("keydown",e=>{
      if(!e.shiftKey)return;
      const direction=({ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]})[e.key];
      if(!direction)return;
      e.preventDefault();moveAlert(direction[0],direction[1],alertPosition());
    });
    field("#field-alert-full").addEventListener("click",()=>{
      alertExpanded=false;updateAttentionBox();openNotifications();
    });
    field("#field-minimize-dock").addEventListener("click",()=>{
      if(!operationalVisible || !notificationsActive() || workspaceSection!=="map"
        || ordersPanel.dataset.dock!=="compact")return;
      dockMinimized=true;ordersPanel.dataset.minimized="true";miniTray.hidden=false;
      sizeMobileWorkspace();renderMapScale();positionAlert();
      field("#field-restore-dock").focus({preventScroll:true});
    });
    field("#field-restore-dock").addEventListener("click",()=>{
      dockMinimized=false;ordersPanel.dataset.minimized="false";miniTray.hidden=true;
      sizeMobileWorkspace();renderMapScale();positionAlert();
      composer.focus({preventScroll:true});
    });
    platform.addEventListener("resize",positionAlert);
    platform.visualViewport?.addEventListener("resize",positionAlert);
    function renderNotifications() {
      const entries = [...notificationOrders, ...notificationReports].sort((a, b) =>
        (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0) || a.id.localeCompare(b.id));
      notificationButton.disabled = !notificationsActive();
      updateAttentionBox();
      field("#notification-availability").textContent = [notificationOrderState, notificationReportState].filter(Boolean).join(" ");
      const signature = JSON.stringify(entries.map(entry => [entry, orderVersions.get(entry.orderId)]));
      if (signature === notificationSignature) return;
      notificationSignature = signature;
      const scroll = notificationList.scrollTop;
      const expanded = new Set([...notificationList.querySelectorAll("details[open]")].map(node => node.parentElement.dataset.eventId));
      const active = platform.document.activeElement;
      const focusedId = active?.closest("#notification-list li")?.dataset.eventId;
      const focusedSummary = active?.tagName === "SUMMARY";
      notificationList.replaceChildren();
      if (!entries.length) {
        const empty = platform.document.createElement("li"); empty.textContent = "No recent notifications available.";
        notificationList.append(empty);
      }
      for (const entry of entries) {
        const item = platform.document.createElement("li");
        item.dataset.eventId = entry.id; item.dataset.orderId = entry.orderId; item.dataset.outcome = entry.state; item.tabIndex = -1;
        const label = platform.document.createElement("strong"); label.textContent = entry.label;
        const text = platform.document.createElement("span"); text.textContent = entry.text;
        const timing = notificationTime(entry.timestamp), time = platform.document.createElement(timing ? "time" : "span");
        if (timing) { time.dateTime = timing.datetime; time.textContent = `${entry.state === "received" ? "Received" : "Recorded"} ${timing.text}`; }
        else time.textContent = "Server timestamp unavailable";
        const details = platform.document.createElement("details"), summary = platform.document.createElement("summary");
        const version = entry.version ?? orderVersions.get(entry.orderId);
        summary.textContent = version ? `Order #${version - 1} · details` : "Originating order & details";
        const detail = platform.document.createElement("p"); detail.textContent = entry.detail;
        const identity = platform.document.createElement("p");
        identity.textContent = `Originating order: ${entry.orderId ?? "unavailable"}${version ? ` · version ${version}` : ""}.`;
        details.open = expanded.has(entry.id); details.append(summary, detail, identity);
        item.append(label, text, time, details); notificationList.append(item);
        if (focusedId === entry.id) (focusedSummary ? summary : item).focus({ preventScroll: true });
      }
      if (focusedId && !entries.some(entry => entry.id === focusedId)) field("#close-notifications").focus({ preventScroll: true });
      notificationList.scrollTop = scroll;
    }
    const peopleDialog = field("#people"), navPeople = field("#nav-people"), peopleButton = navPeople;
    const contextButton=field("#open-context-tools"), contextPanel=field("#field-context-tools");
    const contextClose=field("#close-context-tools");
    const itemsDialog = field("#field-items"), navItems = field("#nav-items");
    const placesDialog = field("#field-places"), navPlaces = field("#nav-places");
    const mainMenu = field("#field-main-menu");
    let peopleReturnFocus = peopleButton;
    function focusPublicRecovery(hadFocus) {
      if(!hadFocus || platform.document.hidden)return;
      // Scrubbing runs before the authenticated shell is hidden; wait until
      // render has exposed the public recovery surface before moving focus.
      Promise.resolve().then(()=>{
        const target=field("#inactive-device");
        if (!operationalVisible && target && !target.hidden){
          const control=!claimButton.hidden&&!claimButton.disabled?claimButton:target;
          control.focus?.({preventScroll:true});
        }
      });
    }
    function closeWorkspaceSheets(except) {
      if(except!==peopleDialog && peopleDialog.open) returnPeopleFocus=false;
      for(const [trigger,sheet] of [[navPeople,peopleDialog],[navItems,itemsDialog],[navPlaces,placesDialog]]) {
        if (sheet!==except && sheet.open) sheet.close();
        if (sheet!==except) trigger.setAttribute("aria-expanded","false");
      }
      if (contextPanel!==except) {contextPanel.hidden=true;contextButton.setAttribute("aria-expanded","false");}
      syncBottomNavSelection();
    }
    function openFieldDialog(button, dialog) {
      if (!operationalVisible || button.disabled || dialog.open) return;
      mainMenu.open = false;
      if (mobileWorkspace?.matches === true && workspaceSection!=="map")
        selectWorkspaceSection("map");
      closeWorkspaceSheets(dialog);
      // Non-modal, dock-aware workspace sheet: the actual composer and bottom
      // navigation remain usable at all times, including while typing.
      dialog.show();
      button.setAttribute("aria-expanded", "true");
      syncBottomNavSelection();
      field("#field-view-label").textContent=dialog===itemsDialog?"ITEMS":"PLACES";
      dialog.querySelector(".notification-heading button")?.focus({preventScroll:true});
    }
    function closeFieldDialog(button, dialog) {
      if (dialog.open) dialog.close();
      button.setAttribute("aria-expanded", "false");
      syncBottomNavSelection();
      if (operationalVisible && !button.disabled) button.focus({preventScroll:true});
      if (!peopleDialog.open&&!itemsDialog.open&&!placesDialog.open&&contextPanel.hidden)
        field("#field-view-label").textContent=workspaceSection.toUpperCase();
    }
    function contextualDestination(){
      if(peopleDialog.open)return "people";
      if(itemsDialog.open)return "items";
      if(placesDialog.open)return "places";
      return workspaceSection;
    }
    function renderContextualDrawer(){
      const section=contextualDestination();
      field("#context-tools-title").textContent=section[0].toUpperCase()+section.slice(1)+" / Tools";
      for(const node of contextPanel.querySelectorAll("[data-context-for]"))
        node.hidden=node.dataset.contextFor!==section;
      const permitted={
        "inspect-contact": !peopleInspect.disabled,
        "write-order": !peopleWrite.disabled,
        "people-reports": !peopleViewReports.disabled
      };
      for(const control of contextPanel.querySelectorAll("button[data-context-action]")){
        if(Object.hasOwn(permitted,control.dataset.contextAction))
          control.disabled=!permitted[control.dataset.contextAction];
      }
    }
    contextButton.addEventListener("click",()=>{
      if(!operationalVisible||contextButton.disabled)return;
      const opening=contextPanel.hidden;
      if(opening){
        // Context belongs to the *selected bottom destination*. Never close
        // People/Items/Places or silently navigate back to Map for tools.
        mainMenu.open=false;
        renderContextualDrawer();
        contextPanel.hidden=false;contextButton.setAttribute("aria-expanded","true");
        contextClose.focus({preventScroll:true});
      }else contextClose.click();
    });
    contextPanel.addEventListener("click",event=>{
      const button=event.target.closest?.("button[data-context-action]");
      if(!button||button.disabled)return;
      const action=button.dataset.contextAction;
      const targets={
        "inspect-contact":peopleInspect,"write-order":peopleWrite,
        "people-reports":peopleViewReports,
        "items-focus":field("#field-items-title"),
        "places-focus":field("#field-places .field-place-options button"),
        "orders-focus":composer,
        "history-reports":field("#received-reports")
      };
      const destination=targets[action];
      if(!destination)return;
      contextClose.click();
      if(["inspect-contact","write-order","people-reports"].includes(action)){
        destination.click();return;
      }
      if(action==="history-reports")destination.open=true;
      const focus=action==="history-reports"?destination.querySelector("summary"):destination;
      focus?.focus?.({preventScroll:true});
      revealWorkspaceTarget(focus);
    });
    contextClose.addEventListener("click",()=>{
      contextPanel.hidden=true;contextButton.setAttribute("aria-expanded","false");
      if(operationalVisible&&!contextButton.disabled) contextButton.focus({preventScroll:true});
    });
    contextPanel.addEventListener("keydown",event=>{
      if(event.key==="Escape"){
        event.preventDefault();contextClose.click();
      }
    });
    for(const [name,selector] of [["contours",".range-contour, .range-height-cell"],
      ["routes",".range-route"],["labels",".synthetic-range svg text"]]){
      const control=field("#context-"+name);
      control.addEventListener("change",()=> {
        operationsMap.classList.toggle("hide-context-"+name,!control.checked);
      });
    }
    navItems.addEventListener("click", () => openFieldDialog(navItems, itemsDialog));
    navPlaces.addEventListener("click", () => openFieldDialog(navPlaces, placesDialog));
    field("#close-field-items").addEventListener("click", () => closeFieldDialog(navItems, itemsDialog));
    field("#close-field-places").addEventListener("click", () => closeFieldDialog(navPlaces, placesDialog));
    for (const [trigger,dialog] of [[navItems,itemsDialog],[navPlaces,placesDialog]]) {
      dialog.addEventListener("close", () => {
        trigger.setAttribute("aria-expanded","false");
        syncBottomNavSelection();
      });
    }
    placesDialog.addEventListener("click", event => {
      const target = event.target.closest?.("button[data-place-focus]");
      if (!target || !placesDialog.contains(target) || !operationalVisible) return;
      const item = operationsMap.querySelector('[data-map-id="' + target.dataset.placeFocus + '"]');
      if (!item) return;
      closeFieldDialog(navPlaces, placesDialog);
      selectWorkspaceSection("map");
      selectMapObject(target.dataset.placeFocus);
      if (item.getAttribute("tabindex") === "0" && item.getAttribute("aria-disabled")!=="true") {
        item.focus({preventScroll:true});
        revealWorkspaceTarget(item);
      } else if (mobileWorkspace?.matches === true) {
        // Source-based Places selection remains inspectable even when the
        // projected SVG marker has been clipped or disabled on a short map.
        hideMapQuickActions();
        operationalWorkspace.dataset.evidenceOpen="true";
        field("#map-selection-title").focus({preventScroll:true});
      } else {
        // A disabled/clipped SVG marker is not a viable desktop navigation
        // destination. Reveal its truthful source-backed inspector instead.
        hideMapQuickActions();
        operationalWorkspace.dataset.evidenceOpen="true";
        const inspector=field("#map-selection-title");
        inspector?.focus({preventScroll:true});
        revealWorkspaceTarget(inspector);
      }
    });
    const peopleInspect = field("#people-inspect"), peopleWrite = field("#people-write");
    const peopleReports = field("#people-reports"), peopleViewReports = field("#people-view-reports");
    let returnPeopleFocus = false;
    function peopleActive() { return notificationsActive() && !!mercenary; }
    function scrubPeople() {
      const hadFocus = peopleDialog.open || peopleDialog.contains(platform.document.activeElement);
      returnPeopleFocus = false; peopleButton.disabled = true; navPeople.disabled = true;
      if (itemsDialog.open) itemsDialog.close();
      if (placesDialog.open) placesDialog.close();
      navItems.setAttribute("aria-expanded", "false");
      navPlaces.setAttribute("aria-expanded", "false");
      if (peopleDialog.open) peopleDialog.close();
      contextPanel.hidden=true;contextButton.setAttribute("aria-expanded","false");contextButton.disabled=true;
      peopleButton.setAttribute("aria-expanded", "false");
      for (const id of ["name", "status", "assignment", "location", "order-reason"]) field(`#people-${id}`).textContent = "";
      peopleInspect.disabled = true; peopleWrite.disabled = true;
      peopleReports.replaceChildren(); field("#people-reports-empty").textContent = "";
      peopleReports.tabIndex = -1;
      peopleViewReports.disabled = true;
      focusPublicRecovery(hadFocus);
    }
    function renderPeople() {
      if (!peopleActive()) { scrubPeople(); return; }
      peopleButton.disabled = false; navPeople.disabled = false;contextButton.disabled=false;
      const person = personnelPresentation(mercenary, knowledge, [...observedOrders.values()], picture);
      for (const id of ["name", "status", "assignment", "location"]) field(`#people-${id}`).textContent = person[id];
      const reports = peopleReportPreview(picture);
      peopleReports.replaceChildren();
      for (const report of reports) {
        const item = platform.document.createElement("li"), label = platform.document.createElement("strong");
        label.textContent = report.label;
        const summary = platform.document.createElement("span"); summary.textContent = report.summary;
        const source = platform.document.createElement("span"); source.textContent = report.source;
        const time = platform.document.createElement("time");
        time.dateTime = report.receivedAt; time.textContent = `Received ${report.receivedAt}`;
        const uncertainty = platform.document.createElement("span"); uncertainty.textContent = report.uncertainty;
        item.append(label, summary, source, time, uncertainty); peopleReports.append(item);
      }
      field("#people-reports-empty").textContent = reports.length ? ""
        : picture ? "No received reports in the current picture." : "Received reports unavailable until the current picture is confirmed.";
      peopleViewReports.disabled = !reports.length;
      peopleReports.tabIndex = reports.length ? 0 : -1;
      peopleInspect.disabled = false;
      peopleWrite.disabled = !canPlanMapOrder() || mercenary.version < minimumVersion;
      field("#people-order-reason").textContent = peopleWrite.disabled
        ? "Writing is unavailable while command control or an order attempt is pending. Preserve the exact retry."
        : "Opens your existing draft. Review VIA and send when ready.";
    }
    peopleButton.addEventListener("click", () => {
      if (!peopleActive()) return;
      // Unlike modal dialogs, workspace sheets cannot obscure an open
      // hamburger. Dismiss the menu before selecting the People sheet.
      mainMenu.open = false;
      if (mobileWorkspace?.matches===true && workspaceSection!=="map")
        selectWorkspaceSection("map");
      renderPeople(); returnPeopleFocus = true;
      closeWorkspaceSheets(peopleDialog);
      if (!peopleDialog.open) peopleDialog.show();
      peopleButton.setAttribute("aria-expanded", "true");
      navPeople.setAttribute("aria-expanded", "true");
      syncBottomNavSelection();
      field("#field-view-label").textContent="PEOPLE";
      field("#close-people").focus({preventScroll:true});
    });
    field("#close-people").addEventListener("click", () => peopleDialog.close());
    for (const [trigger,dialog] of [[navPeople,peopleDialog],[navItems,itemsDialog],[navPlaces,placesDialog]]) {
      dialog.addEventListener("keydown",event=>{
        if(event.key!=="Escape")return;
        event.preventDefault();
        closeFieldDialog(trigger,dialog);
      });
    }
    peopleViewReports.addEventListener("click", () => {
      if (!peopleActive() || !picture?.reports.length || peopleViewReports.disabled) return;
      returnPeopleFocus = false; peopleDialog.close(); selectWorkspaceSection("history");
      const reports = field("#received-reports"); reports.open = true;
      const destination=reports.querySelector("summary");
      destination?.focus({preventScroll:true});
      revealWorkspaceTarget(destination);
    });
    peopleDialog.addEventListener("close", () => {
      peopleButton.setAttribute("aria-expanded", "false");
      navPeople.setAttribute("aria-expanded", "false");
      syncBottomNavSelection();
      if (returnPeopleFocus && peopleActive()) peopleReturnFocus.focus({ preventScroll: true });
      if (!itemsDialog.open&&!placesDialog.open&&contextPanel.hidden)
        field("#field-view-label").textContent=workspaceSection.toUpperCase();
      peopleReturnFocus=peopleButton;
      returnPeopleFocus = false;
    });
    peopleDialog.addEventListener("keydown", event => {
      if (event.key !== "Tab" || !peopleDialog.matches(":modal")) return;
      const controls = [...peopleDialog.querySelectorAll("button:not(:disabled), [tabindex]")]
        .filter(node => node.tabIndex >= 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (platform.document.activeElement === (event.shiftKey ? first : last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    });
    peopleInspect.addEventListener("click", () => {
      if (!peopleActive() || peopleInspect.disabled) return;
      returnPeopleFocus = false; peopleDialog.close(); selectWorkspaceSection("map");
      selectMapObject("ortega");
      hideMapQuickActions();
      operationalWorkspace.dataset.evidenceOpen = "true";
      const inspector=field("#map-selection-title");
      inspector?.focus({preventScroll:true});
      revealWorkspaceTarget(inspector);
    });
    peopleWrite.addEventListener("click", () => {
      if (!peopleActive() || peopleWrite.disabled || !canPlanMapOrder()) return;
      returnPeopleFocus = false; peopleDialog.close(); selectWorkspaceSection("orders");
      composer.focus({preventScroll:true}); revealWorkspaceTarget(composer);
    });
    function openNotifications(entry) {
      if (!notificationsActive()) return;
      // The approved v0.7 keeps Updates in a native hamburger disclosure.
      // A modal opened through that menu must return focus to the visible
      // menu summary, never a hidden action beneath a closed disclosure.
      const menu=field("#field-main-menu");
      const menuSummary=menu?.querySelector("summary");
      notificationReturnTarget=menu?.open ? menuSummary : notificationButton;
      menu?.removeAttribute("open");
      returnNotificationFocus = true;
      renderNotifications(); notificationDialog.showModal(); notificationButton.setAttribute("aria-expanded", "true");
      if (entry) {
        const item = [...notificationList.children].find(node => node.dataset.eventId === entry.id);
        if (item) { item.querySelector("details").open = true; item.focus({ preventScroll: true }); item.scrollIntoView({ block: "nearest" }); }
      }
      clearToasts();
    }
    notificationButton.addEventListener("click", () => openNotifications());
    field("#close-notifications").addEventListener("click", () => notificationDialog.close());
    notificationDialog.addEventListener("keydown", event => {
      if (event.key !== "Tab" || !notificationDialog.open) return;
      // Wrap only the drawer's boundary; native navigation handles interior stops
      // and the programmatically focused preview row (tabindex="-1").
      const controls = [...notificationDialog.querySelectorAll("button, summary, [tabindex]")]
        .filter(node => node.tabIndex >= 0 && !node.matches(":disabled") && node.getClientRects().length && platform.getComputedStyle(node).visibility !== "hidden");
      const first = controls[0], last = controls[controls.length - 1];
      const boundary = event.shiftKey ? first : last;
      if (boundary && platform.document.activeElement === boundary) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    });
    notificationDialog.addEventListener("close", () => {
      notificationButton.setAttribute("aria-expanded", "false");
      if (returnNotificationFocus && notificationsActive()) {
        const menu=field("#field-main-menu");
        const visibleTarget=notificationReturnTarget===notificationButton && !menu?.open
          ? menu?.querySelector("summary") ?? notificationButton
          : notificationReturnTarget ?? notificationButton;
        visibleTarget.focus({ preventScroll: true });
      }
      notificationReturnTarget=undefined;
      returnNotificationFocus = false;
    });
    field("#open-notification-toast").addEventListener("click", () => openNotifications(toastQueue[0]));
    field("#dismiss-notification-toast").addEventListener("click", dismissToast);
    platform.addEventListener("scroll", positionToast, { passive: true });
    platform.addEventListener("resize", positionToast);
    platform.visualViewport?.addEventListener("resize", positionToast);
    platform.visualViewport?.addEventListener("scroll", positionToast);
    if (platform.ResizeObserver) {
      const dockResize = new platform.ResizeObserver(() => { sizeMobileWorkspace(); positionToast(); });
      dockResize.observe(ordersPanel); dockResize.observe(field(".workspace-nav"));
      dockResize.observe(field(".workspace-header"));
    }
    function scrubNotifications() {
      const hadFocus = notificationDialog.open || notificationDialog.contains(platform.document.activeElement) || toast.contains(platform.document.activeElement);
      notificationButton.disabled = true; returnNotificationFocus = false; notificationReturnTarget=undefined;
      if (notificationDialog.open) notificationDialog.close();
      notificationButton.setAttribute("aria-expanded", "false");
      notificationFeed = createNotificationFeed(); notificationOrders = []; notificationReports = [];
      notificationSignature = ""; notificationOrderState = "Loading order records…"; notificationReportState = "Loading delivered reports…";
      notificationList.replaceChildren(); field("#notification-availability").textContent = "";
      alertExpanded=false;alertPeek.hidden=true;alertBox.hidden=true;alertList.replaceChildren();
      dockMinimized=false;ordersPanel.dataset.minimized="false";miniTray.hidden=true;
      platform.clearTimeout(alertHoldTimer);alertGesture=undefined;
      clearToasts(); platform.clearTimeout(pollTimer);
      focusPublicRecovery(hadFocus);
    }
    function scheduleReportPoll() {
      platform.clearTimeout(pollTimer);
      if (notificationsActive()) pollTimer = platform.setTimeout(pollReports, 12000);
    }
    async function pollReports() {
      if (!notificationsActive() || pollRunning) return;
      if (busy || claiming || commanderReads) { scheduleReportPoll(); return; }
      pollRunning = true;
      try {
        const read = await refreshPicture();
        // Picture and knowledge share the public knowledge revision. Compare to
        // the admitted floor, but also recover a projection lost to a scrub.
        // refreshKnowledge still rejects revisions below that retained floor.
        if (read && currentObservation(read, pictureRevision) && (!knowledge || picture.revision > knowledgeFloor))
          await refreshKnowledge();
      }
      catch { /* Authority failures scrub; transport failures remain eligible next poll. */ }
      finally { pollRunning = false; scheduleReportPoll(); }
    }

    function rememberOrder(order) {
      orderVersions.set(order.orderId, order.resultingMercenaryVersion);
      observedOrders.set(order.orderId, order);
      if (!latestOrder || order.resultingMercenaryVersion > latestOrder.resultingMercenaryVersion) latestOrder = order;
    }
    function orderLabel(id) {
      const version = orderVersions.get(id);
      return version ? `order #${version - 1} (v${version})` : `order ${id}`;
    }
    function reportLabel(id) {
      if (!id) return "No received report";
      // Independent projections may arrive out of order; a different UUID alone
      // does not prove that the report predates the latest known order.
      const relation = id === latestOrder?.orderId ? "LATEST"
        : orderVersions.get(id) < latestOrder?.resultingMercenaryVersion ? "PREVIOUS" : "related";
      return `Received report from ${relation} ${orderLabel(id)}`;
    }
    function identifyOrder(element, id) {
      element.dataset.orderId = id ?? "";
      element.title = id ? `Full order ID: ${id}` : "";
      if (id) element.setAttribute("aria-label", `${element.textContent}; full order ID ${id}`);
      else element.removeAttribute("aria-label");
    }

    async function api(path, body, onHeaders) {
      // Capture dispatch authority, not an immutable retry's original grant.
      const read = observation(), authority = authorityContext;
      return requestWithDeadline(platform, path, {
        method: body === undefined ? "GET" : "POST",
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      }, async response => {
        // Decide before invalidation advances the barrier. Obsolete headers may
        // settle their own attempt, but cannot revoke a newer authorization.
        const current = currentObservation(read) && sameAuthority(authority, authorityContext);
        if (current && [401, 403].includes(response.status)) {
          resetWorkspaceSection(); invalidateControl();
        }
        // HTTP outcome exists before its optional representation. Known order
        // rejection bodies are never a prerequisite for local revocation/readback.
        if ((onHeaders && onHeaders(response.status, current) === false) || !current) {
          response.body?.cancel().catch(() => {});
          return { status: response.status };
        }
        return { status: response.status, body: await response.json() };
      });
    }
    function renderHistory() {
      if (terminal || projection?.control.status !== "active") { historyList.replaceChildren(); return; }
      const scroll = historyScroll ?? historyList.scrollTop;
      historyList.replaceChildren();
      if (historyLoaded && historyEntries.length === 0) {
        const item = platform.document.createElement("li"); item.textContent = "No orders yet."; historyList.append(item);
      }
      for (const entry of historyEntries) {
        const item = platform.document.createElement("li"), text = platform.document.createElement("strong");
        const presentation = orderLifecycle(entry, knowledge, [...observedOrders.values()], picture);
        item.dataset.outcome = presentation.state;
        item.dataset.orderId = entry.orderId;
        item.dataset.latest = String(entry.orderId === latestOrder?.orderId);
        const identity = platform.document.createElement("span");
        identity.className = "order-identity";
        identity.textContent = `${entry.orderId === latestOrder?.orderId ? "LATEST ORDER" : "OLDER ORDER"} · ${orderLabel(entry.orderId)}`;
        identifyOrder(identity, entry.orderId);
        text.textContent = entry.text;
        const response = platform.document.createElement("span");
        response.textContent = `At issue: ${orderPresentation(entry).label}. ${orderFeedback(entry)}`;
        const detail = platform.document.createElement("span"); detail.textContent = `${methodSummary(entry)} · ${presentation.label}`;
        const time = platform.document.createElement("time"); time.dateTime = entry.createdAt;
        time.textContent = `Issued ${new Date(entry.createdAt).toLocaleString()}`;
        item.append(identity, text, detail, response, time); historyList.append(item);
      }
      // Consume a scrubbed offset only when authorized history has reloaded.
      // Knowledge/picture renders can arrive first, while the list is empty.
      if (historyLoaded) { historyList.scrollTop = scroll; historyScroll = undefined; }
    }
    function mapItems() {
      const contact = picture?.contact;
      const items = new Map([
        ["staging-area", { title: picture?.reference.label ?? "Staging Area",
          known: "Local command reference supplied by the briefing.", source: "Local briefing",
          received: "Available briefing", observed: "Not supplied", precision: "Authored local geography",
          order: "None", unknown: "Static briefing geography; live position and passage are unconfirmed.", prepareOrder: "observe here" }],
        ["ridge", { title: picture?.objective.label ?? "Ridge",
          known: "Named objective supplied as planning context.", source: "Local briefing",
          received: "Available briefing", observed: "Not supplied", precision: "Authored objective area",
          order: "None", unknown: "Authored objective area; no live actor or object position is shown.", prepareOrder: "move to ridge and hold" }],
        ["short", { title: picture?.routes.find(route => route.id === "short")?.label ?? "Short path",
          known: "Named route choice supplied as planning context.", source: "Local briefing",
          received: "Available briefing", observed: "Not supplied", precision: "Authored route geometry",
          order: "None", unknown: "Authored route shown; travel time, effort and current clearance are not derived from this map.", prepareOrder: "scout ridge via short path" }],
        ["long", { title: picture?.routes.find(route => route.id === "long")?.label ?? "Lower path",
          known: "Named route choice supplied as planning context.", source: "Local briefing",
          received: "Available briefing", observed: "Not supplied", precision: "Authored route geometry",
          order: "None", unknown: "Authored route shown; travel time, effort and current clearance are not derived from this map.", prepareOrder: "scout ridge via lower path" }],
        ["ortega", contact?.state !== "present" && contact?.state !== "last-known" ? {
          title: "Ortega", known: "Contact state unavailable; current location is unknown.",
          source: "Unavailable", received: "No contact state available", observed: "Not supplied",
          precision: "Unknown location", order: "None",
          unknown: "Contact state remains unknown until an operations picture is available.", prepareOrder: "status",
        } : { title: "Ortega", known: contact.state === "last-known"
          ? `Last known at ${contact.area}${contact.source === "local radio" ? "; reported holding" : ""}; no live position is available.`
          : "Present at Staging Area by the available local contact state.",
          source: contact?.source ?? "Local contact", received: "Available contact state", observed: "Not supplied",
          precision: contact?.state === "last-known" ? "Last-known area" : "Present at command reference",
          order: "None", unknown: contact?.state === "last-known"
            ? "Ortega does not move on this picture without a delivered update."
            : "No private activity or internal position is shown.", prepareOrder: "status" }],
      ]);
      for (const report of picture?.reports ?? []) items.set(report.id, {
        title: report.label, known: `${report.summary} Exact position not reported.`,
        source: `${report.source.label} · ${report.source.means}`,
        received: `${report.delivery.kind} · ${new Date(report.delivery.receivedAt).toLocaleString()}`,
        observed: "Not supplied", precision: report.precision === "unlocated" ? `${report.area}. Exact position not reported.` : report.precision,
        order: report.relatedOrderId, unknown: `${report.unknown.join(" · ")}. ${report.retention}.`,
        prepareOrder: report.prepareOrder,
      });
      return items;
    }
    function canEditDraft() {
      return !terminal && projection?.control.status === "active" && !busy && !claiming && !pending && !composer.disabled;
    }
    // The active chip is a floating, noninteractive copy. Original DOM nodes
    // stay mounted until release so pointer capture, retry identity, focus and
    // keyboard reorder keep their established meaning. Neighbors use a
    // lightweight animated displacement rather than rewriting the draft
    // mid-gesture (the actual order changes only on pointerup).
    function clearDraftDragPreview(drag) {
      // Nothing was lifted during normal render, poll or authority scrubs.
      // Avoid touching presentation APIs on every ordinary cancellation.
      if (!drag) return;
      drag.ghost?.remove?.();
      drag.origin?.classList?.remove?.("chip-drag-origin");
      draftList.classList?.remove?.("chip-reorder-active");
      for (const chip of draftList.querySelectorAll?.(".draft-chip") ?? [])
        chip.style?.removeProperty?.("transform");
      field(".composer-tokens")?.classList?.remove?.("chip-drop-preview");
    }
    function showDraftDragPreview(drag, x = drag.x, y = drag.y) {
      if (drag.ghost || !canEditDraft() || drag.identity !== draftIdentity) return;
      const origin=drag.source === "draft" ? draftList.children[drag.edit]
        : drag.target;
      if (!origin || !origin.isConnected) return;
      const box=origin.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const ghost=origin.cloneNode(true);
      ghost.removeAttribute("id");
      ghost.setAttribute("aria-hidden","true");
      // Suggestions inherit most of their visual styling from a dock-scoped
      // selector. The floating copy lives on body to avoid clipping, so
      // transfer only safe, read-only computed presentation properties.
      const style=platform.getComputedStyle(origin);
      for(const property of ["background","border","borderRadius","color",
        "font","letterSpacing","lineHeight","padding","display","alignItems"])
        ghost.style[property]=style[property];
      ghost.classList.add("chip-drag-ghost");
      for (const control of ghost.querySelectorAll("button,[tabindex]")) {
        control.removeAttribute("id");
        control.tabIndex=-1;
      }
      ghost.style.left=box.left+"px";
      ghost.style.top=box.top+"px";
      ghost.style.width=box.width+"px";
      ghost.style.height=box.height+"px";
      // Detached suggestion buttons otherwise recover the generic
      // .quiet-button 44px minimum instead of the dock's 26px chip rule.
      // Freeze all intrinsic size constraints to the actual source geometry.
      ghost.style.minWidth=ghost.style.maxWidth=box.width+"px";
      ghost.style.minHeight=ghost.style.maxHeight=box.height+"px";
      platform.document.body.append(ghost);
      drag.ghost=ghost;
      drag.origin=origin;
      drag.sourceWidth=box.width;
      drag.gap=Number.parseFloat(platform.getComputedStyle(draftList).columnGap)||3;
      if (drag.source === "draft") {
        drag.originalRects=[...draftList.children].map(node=>{
          // Use the center of the actual draggable word, not the X/remove
          // portion of the chip. Dropping onto the word's center must work.
          const r=(node.querySelector(".draft-word")??node).getBoundingClientRect();
          return {center:(r.left+r.right)/2};
        });
        drag.originalScroll=draftList.scrollLeft;
        draftList.classList.add("chip-reorder-active");
        origin.classList.add("chip-drag-origin");
      }
      updateDraftDragPreview(drag,x,y);
    }
    function updateDraftDragPreview(drag, x, y) {
      if (!drag.ghost) return;
      drag.ghost.style.transform=`translate3d(${x-drag.x}px,${y-drag.y}px,0) scale(1.05)`;
      const row=draftList.getBoundingClientRect();
      const inRow=x>=row.left-20 && x<=row.right+20
        && y>=row.top-18 && y<=row.bottom+18;
      field(".composer-tokens")?.classList.toggle("chip-drop-preview",inRow);
      if (drag.source!=="draft") return;
      // Horizontal scrolling remains supported even during a long drag.
      if (inRow && x>=row.right-19 && draftList.scrollLeft<draftList.scrollWidth-draftList.clientWidth)
        draftList.scrollLeft=Math.min(draftList.scrollWidth-draftList.clientWidth,draftList.scrollLeft+9);
      else if (inRow && x<=row.left+19 && draftList.scrollLeft>0)
        draftList.scrollLeft=Math.max(0,draftList.scrollLeft-9);
      const siblings=[...draftList.children];
      const shift=drag.sourceWidth+drag.gap;
      let proposed=drag.edit;
      if (inRow) {
        const scrollDelta=draftList.scrollLeft-drag.originalScroll;
        for(let i=drag.edit+1;i<siblings.length;i++)
          if (x>=drag.originalRects[i].center-scrollDelta) proposed=i;
        for(let i=drag.edit-1;i>=0;i--)
          if (x<=drag.originalRects[i].center-scrollDelta) proposed=i;
      }
      drag.hoverIndex=inRow?proposed:undefined;
      for(let i=0;i<siblings.length;i++) {
        const delta=inRow && proposed>drag.edit && i>drag.edit && i<=proposed?-shift
          :inRow && proposed<drag.edit && i>=proposed && i<drag.edit?shift:0;
        siblings[i].style.transform=delta?`translate3d(${delta}px,0,0)`:"";
      }
    }
    function cancelDraftDrag() {
      const drag = draftDrag; draftDrag = undefined;
      if (drag) platform.clearTimeout(drag.holdTimer);
      clearDraftDragPreview(drag);
      delete orderForm.dataset.chipDragging;
      if (drag && orderForm.hasPointerCapture?.(drag.pointerId)) orderForm.releasePointerCapture(drag.pointerId);
    }
    function startDraftDrag(event, source, edit) {
      if (!canEditDraft() || event.button !== 0 || event.isPrimary === false) return;
      cancelDraftDrag(); suppressPointerClick = false;
      draftDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        identity: draftIdentity, source, edit, target:event.currentTarget, moved: false,
        mode: event.pointerType === "touch" ? "pending" : "drag",
        host: source === "draft" ? draftList : field("#contextual-actions") };
      const drag = draftDrag;
      drag.scrollLeft = drag.host.scrollLeft;
      // touch-action is fixed at pointerdown: arbitrate scrolling here so a
      // stationary hold can still drag across rows in the same gesture.
      if (drag.mode === "pending") drag.holdTimer = platform.setTimeout(() => {
        if (draftDrag !== drag) return;
        if (!canEditDraft() || drag.identity !== draftIdentity) return cancelDraftDrag();
        drag.mode = "drag"; suppressPointerClick = true;
        orderForm.setPointerCapture?.(drag.pointerId);
        orderForm.dataset.chipDragging = drag.source;
        showDraftDragPreview(drag);
      }, 400);
    }
    orderForm.addEventListener("pointermove", event => {
      if (!draftDrag || draftDrag.pointerId !== event.pointerId) return;
      if (!canEditDraft() || draftDrag.identity !== draftIdentity) return cancelDraftDrag();
      if (!draftDrag.moved && Math.hypot(event.clientX - draftDrag.x, event.clientY - draftDrag.y) < 7) return;
      if (draftDrag.mode === "pending") {
        platform.clearTimeout(draftDrag.holdTimer);
        draftDrag.mode = "scroll";
      }
      draftDrag.moved = true; suppressPointerClick = true;
      orderForm.setPointerCapture?.(event.pointerId);
      if (draftDrag.mode === "scroll") {
        draftDrag.host.scrollLeft = draftDrag.scrollLeft + draftDrag.x - event.clientX;
        event.preventDefault();
        return;
      }
      orderForm.dataset.chipDragging = draftDrag.source;
      if (!draftDrag.ghost) showDraftDragPreview(draftDrag,event.clientX,event.clientY);
      else updateDraftDragPreview(draftDrag,event.clientX,event.clientY);
      event.preventDefault();
    });
    orderForm.addEventListener("pointerup", event => {
      const drag = draftDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const valid = canEditDraft() && drag.identity === draftIdentity;
      const hoverIndex=drag.hoverIndex;
      cancelDraftDrag();
      if (!drag.moved || !valid || drag.mode !== "drag") return;
      event.preventDefault();
      const target = platform.document.elementFromPoint(event.clientX, event.clientY);
      const inDraft = field(".composer-tokens").contains(target) || target === composer;
      if (drag.source === "suggestion") {
        if (inDraft) drag.edit();
      } else if (field("#contextual-actions").contains(target)) {
        mutateDraft(editDraftTokens(composer.value, drag.edit));
      } else if (inDraft) {
        const chip = target?.closest?.("[data-draft-index]");
        const to = Number.isInteger(hoverIndex) ? hoverIndex
          : chip ? Number(chip.dataset.draftIndex) : draftTokens(composer.value).length - 1;
        if (mutateDraft(editDraftTokens(composer.value, drag.edit, to))) focusDraftToken(to);
      }
    });
    orderForm.addEventListener("pointercancel", cancelDraftDrag);
    orderForm.addEventListener("lostpointercapture", event => {
      // Touch begins with implicit capture on the touched suggestion. When
      // transferring capture to the stable form, the child's loss bubbles
      // through the form. That is NOT a cancelled drag. Only the form's own
      // capture loss is terminal.
      if (event.target === orderForm) cancelDraftDrag();
    });
    platform.addEventListener("blur", cancelDraftDrag);
    orderForm.addEventListener("keydown", event => { if (event.key === "Escape") cancelDraftDrag(); });
    // Pointer capture targets the stable form. Suppress the compatibility click
    // after a drag (including cancelled drops), but never a keyboard activation.
    orderForm.addEventListener("click", event => {
      if (suppressPointerClick && event.detail) { event.preventDefault(); event.stopPropagation(); }
      suppressPointerClick = false;
    }, true);
    orderForm.addEventListener("pointerdown", () => { suppressPointerClick = false; }, true);
    function focusDraftToken(index, remove = false) {
      const token = draftList.children[index];
      (token?.children[remove ? 1 : 0] ?? composer).focus({ preventScroll: true });
      token?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
    // A thin rail and fade appear only when real words exceed the available
    // horizontal space. Both rows stay native overflow scrollports; no arrows,
    // fake words or intrusive gesture interception.
    function updateChipScrollAffordance() {
      const proposal=field("#contextual-actions"),rail=field(".contextual-action-strip");
      for(const row of [proposal,draftList]) {
        if(!row)return;
        const width=Number(row.clientWidth),total=Number(row.scrollWidth),left=Number(row.scrollLeft)||0;
        const overflow=width>0&&total>width+2;
        row.dataset.canScroll=String(overflow);
        row.dataset.atEnd=String(!overflow || left>=total-width-2);
        if(row===proposal && rail){
          rail.dataset.overflow=String(overflow);
          const thumb=rail.querySelector(".chip-scroll-progress");
          if(thumb && overflow){
            const fraction=Math.max(.16,Math.min(1,width/total));
            const track=rail.clientWidth || width;
            thumb.style.width=Math.round(track*fraction)+"px";
            thumb.style.marginLeft=Math.round((track-track*fraction)*Math.max(0,Math.min(1,left/(total-width))))+"px";
          }
        }
      }
    }
    const scheduleChipAffordance=()=>{
      updateChipScrollAffordance();
      platform.requestAnimationFrame?.(updateChipScrollAffordance);
    };
    for(const row of [field("#contextual-actions"),draftList])
      row?.addEventListener?.("scroll",updateChipScrollAffordance,{passive:true});
    platform.addEventListener?.("resize",scheduleChipAffordance);
    platform.addEventListener?.("resize",positionMapQuickActions);
    if(platform.ResizeObserver){
      const observer=new platform.ResizeObserver(updateChipScrollAffordance);
      for(const row of [field("#contextual-actions"),draftList]) if(row)observer.observe(row);
    }
    function renderDraftTokens() {
      const focused = platform.document.activeElement;
      const focusedIndex = draftList.contains(focused) ? Number(focused.dataset.draftIndex) : undefined;
      const removeFocus = focused?.dataset.draftRemove === "true";
      draftList.replaceChildren();
      draftTokens(composer.value).forEach((token, index) => {
        const chip = platform.document.createElement("span"), word = platform.document.createElement("button"), remove = platform.document.createElement("button");
        chip.className = "draft-chip";
        word.type = remove.type = "button";
        word.dataset.draftIndex = remove.dataset.draftIndex = String(index);
        remove.dataset.draftRemove = "true";
        word.className = "draft-word"; remove.className = "draft-remove";
        word.textContent = token.text; remove.textContent = "×";
        word.setAttribute("aria-label", `Draft word ${index + 1}: ${token.text}. Left or right arrow to reorder.`);
        remove.setAttribute("aria-label", `Remove draft word ${index + 1}: ${token.text}`);
        word.disabled = remove.disabled = !canEditDraft();
        const current = () => draftList.contains(chip) && canEditDraft();
        const removeToken = () => {
          if (current() && mutateDraft(editDraftTokens(composer.value, index)))
            focusDraftToken(Math.min(index, draftList.children.length - 1), true);
        };
        // Chromium may suppress the compatibility click after a successful
        // touch long-press drag. A fresh, stationary touch of the X must
        // still erase the chip. Reordering and pointer scrolling never
        // trigger this handler; keyboard and mouse retain normal clicks.
        let removeTouch;
        remove.addEventListener("pointerdown", event => {
          if (event.pointerType === "touch" && event.isPrimary !== false)
            removeTouch = { id:event.pointerId, x:event.clientX, y:event.clientY };
        });
        remove.addEventListener("pointercancel", () => { removeTouch = undefined; });
        remove.addEventListener("pointerup", event => {
          if (event.pointerType !== "touch" || !removeTouch
            || event.pointerId !== removeTouch.id) return;
          const distance = Math.hypot(event.clientX - removeTouch.x, event.clientY - removeTouch.y);
          removeTouch = undefined;
          if (distance < 8) { event.preventDefault(); removeToken(); }
        });
        remove.addEventListener("click", removeToken);
        word.addEventListener("keydown", event => {
          if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !current()) return;
          event.preventDefault();
          const to = index + (event.key === "ArrowLeft" ? -1 : 1);
          if (to >= 0 && to < draftList.children.length && mutateDraft(editDraftTokens(composer.value, index, to))) focusDraftToken(to);
        });
        word.addEventListener("pointerdown", event => { if (current()) startDraftDrag(event, "draft", index); });
        chip.append(word, remove); draftList.append(chip);
      });
      if (focusedIndex !== undefined) focusDraftToken(focusedIndex, removeFocus);
      scheduleChipAffordance();
    }
    let renderedChipSignature;
    function renderContextualActions(options, selectedTitle = "selected map object") {
      const list = field("#contextual-actions"), status = field("#contextual-action-status");
      const locked = !canEditDraft();
      const suggestions = progressiveSuggestions(composer.value, options);
      // Identity is based on the actual current view, lock and complete
      // source-backed option catalogue, not an assumed immutable revision.
      // An unchanged poll MUST NOT destroy active touch capture, native
      // scrolling, DOM chip identity or the unsent draft. Meaningful updates
      // and authority/lock changes still trigger the ordinary safe rerender.
      const signature = JSON.stringify([selectedMapId,selectedTitle,composer.value,locked,
        options.map(option=>[option.id,option.text,option.evidence,option.guidance,
          option.notice,option.disabledReason,option.disabled]),suggestions.map(x=>[x.phrase,x.text])]);
      if (signature === renderedChipSignature) return;
      renderedChipSignature = signature;
      const focusedId = list.contains(platform.document.activeElement) ? platform.document.activeElement.dataset.actionId : undefined;
      const scroll = list.scrollLeft;
      cancelDraftDrag(); renderDraftTokens();
      list.replaceChildren();
      const message = locked ? "Action proposals locked while an order attempt is pending. Preserve the exact retry."
        : suggestions.length ? `Next words for ${selectedTitle}. ${suggestions[0].option.notice} ${suggestions[0].option.evidence} Review VIA; Send is explicit.`
        : "No action proposals for this prefix and received picture. Draft words are editable text, not validated commands.";
      if (status.textContent !== message) status.textContent = message;
      if (locked) {scheduleChipAffordance();return;}
      if (!suggestions.length && composer.value) {
        const hint = platform.document.createElement("span");
        hint.className = "draft-drop-hint"; hint.textContent = "Drop draft words here to remove"; list.append(hint);
      }
      for (const suggestion of suggestions) {
        const option = suggestion.option;
        const button = platform.document.createElement("button");
        button.type = "button"; button.className = "quiet-button contextual-action cmdchip";
        button.dataset.actionId = option.id;
        button.textContent = suggestion.phrase;
        button.title = `${option.evidence} ${option.guidance} ${option.notice} ${option.disabledReason}`.trim();
        // Keep the spoken control name as compact as the 1–2-word chip.
        // Evidence/guidance remain in the title and contextual status,
        // not appended to every action's accessible name.
        button.setAttribute("aria-label", `Add ${suggestion.phrase} to draft`);
        const apply = () => {
          const current = progressiveSuggestions(composer.value, contextualActions(selectedMapId, picture))
            .find(item => item.text === suggestion.text && item.phrase === suggestion.phrase);
          if (!list.contains(button) || !current || !mutateDraft(current.text)) return;
          status.textContent = `Draft updated. ${current.option.evidence} ${current.option.guidance} ${current.option.notice} Send is explicit.`;
          (list.querySelector("button") ?? composer).focus({ preventScroll: true });
        };
        button.addEventListener("click", apply);
        button.addEventListener("pointerdown", event => startDraftDrag(event, "suggestion", apply));
        list.append(button);
        if (focusedId === option.id) button.focus({ preventScroll: true });
      }
      list.scrollLeft = scroll;
      scheduleChipAffordance();
    }
    function renderOperations() {
      if (terminal || projection?.control.status !== "active") return;
      if (!operationsMap.firstElementChild) {
        operationsMap.innerHTML = mapTemplate;
        reportedMapItems = field("#reported-map-items");
        renderMapZoom();
      }
      const reportLayer = field("#map-report-layer");
      const hasReports = !!picture?.reports.length;
      // The approved field map remains visible on newly delivered reports.
      // Reports remain source-derived and can be expanded deliberately.
      if (!hasReports || reportLayer.hidden) reportLayer.open = false;
      reportLayer.hidden = !hasReports;
      const items = mapItems();
      const routeReport = routeKnowledge(picture);
      const routeStatus = field("#route-knowledge");
      if (routeStatus.textContent !== routeReport.text) routeStatus.textContent = routeReport.text;
      for (const route of operationsMap.querySelectorAll("[data-range-route]")) {
        route.setAttribute("data-selected", String(route.dataset.rangeRoute === selectedMapId));
        route.setAttribute("data-knowledge", route.dataset.rangeRoute === "short" ? routeReport.state : "unconfirmed");
      }
      if (!items.has(selectedMapId)) selectedMapId = "staging-area";
      const focused = platform.document.activeElement;
      const focusedReport = focused && reportedMapItems.contains(focused) ? focused.dataset.mapId : undefined;
      let restoreFocus;
      reportedMapItems.replaceChildren();
      for (const report of picture?.reports ?? []) {
        const button = platform.document.createElement("button");
        button.type = "button"; button.dataset.mapId = report.id;
        button.className = `map-item map-report map-report-${report.id === "fallen-trunk-cleared" ? "cleared" : report.id === "fallen-trunk" ? "trunk" : report.id === "ridge-marker" ? "marker" : "limited"}`;
        const qualifier = platform.document.createElement("span"); qualifier.textContent = `Reported · ${report.area}`;
        button.title = `${report.label} — ${report.area}. Exact position not reported.`;
        button.setAttribute("aria-label", button.title);
        button.append(qualifier, report.label); reportedMapItems.append(button);
        if (report.id === focusedReport) restoreFocus = button;
      }
      restoreFocus?.focus({ preventScroll: true });
      for (const button of operationsMap.querySelectorAll("[data-map-id]"))
        button.setAttribute("aria-pressed", String(button.dataset.mapId === selectedMapId));
      const reportHistory = field("#received-report-history");
      reportHistory.replaceChildren();
      for (const report of [...(picture?.reports ?? [])].sort((a, b) => a.delivery.receivedAt.localeCompare(b.delivery.receivedAt))) {
        const item = platform.document.createElement("li"), summary = platform.document.createElement("strong");
        summary.textContent = report.summary;
        const source = platform.document.createElement("span");
        source.textContent = `${report.source.label} · ${report.source.means} · ${report.delivery.kind}`;
        const time = platform.document.createElement("time");
        time.dateTime = report.delivery.receivedAt; time.textContent = `Received ${new Date(report.delivery.receivedAt).toLocaleString()}; observation time not supplied`;
        const uncertainty = platform.document.createElement("span"); uncertainty.textContent = `${report.retention}. Unknown: ${report.unknown.join(" · ")}.`;
        const order = platform.document.createElement("span"); order.textContent = reportLabel(report.relatedOrderId);
        order.className = "order-identity";
        identifyOrder(order, report.relatedOrderId); item.dataset.orderId = report.relatedOrderId;
        item.append(order, summary, source, time, uncertainty); reportHistory.append(item);
      }
      const actions = contextualActions(selectedMapId, picture);
      renderContextualActions(actions, items.get(selectedMapId).title);
      field("#prepare-clear-trunk").hidden = !actions.some(action => action.id === "clear-trunk");
      field("#prepare-clear-trunk").disabled = composer.disabled;
      const selected = items.get(selectedMapId);
      field("#map-selection-title").textContent = selected.title;
      const selectionLabel = field("#map-selection-label");
      // A report poll updates received knowledge, not the device's planning
      // cursor. Keep its X/Y label and action aligned until another feature
      // is selected or the cursor is explicitly dismissed; otherwise the
      // popup can falsely say Staging Area while inserting unrelated X/Y.
      const isPlanningCoordinate=localCoordinate && !quickPanel()?.hidden
        && quickPanel()?.dataset.selected==="local-coordinate";
      // Add feedback owns both readbacks for this visible selection. Keep
      // refreshing received facts below without replacing its outcome.
      if(!isPlanningCoordinate || !quickPanel()?.hasAttribute("data-feedback")){
        const selectionText=isPlanningCoordinate
          ? `X ${localCoordinate.x} · Y ${localCoordinate.y} m` : selected.title;
        if (selectionLabel.textContent !== selectionText) selectionLabel.textContent = selectionText;
        if(isPlanningCoordinate) selectionLabel.setAttribute("aria-label",
          `Synthetic local coordinates east ${localCoordinate.x} metres, north ${localCoordinate.y} metres`);
      }
      field("#map-known").textContent = selected.known;
      field("#map-source").textContent = selected.source;
      field("#map-received").textContent = selected.received;
      field("#map-observed").textContent = selected.observed;
      field("#map-precision").textContent = selected.precision;
      field("#map-order").textContent = selected.order;
      field("#map-unknown").textContent = selected.unknown;
      prepareMapOrder.disabled = !picture || composer.disabled;
      prepareMapOrder.dataset.order = selected.prepareOrder;
      prepareMapOrder.textContent = selectedMapId === "ridge" ? "Move & hold" : `Prepare “${selected.prepareOrder}”`;
      field("#prepare-scout-ridge").hidden = selectedMapId !== "ridge" || !picture;
      const reportedHolding = picture?.contact?.area === "Ridge" && picture?.contact?.source === "local radio";
      for (const id of ["#prepare-observe-held", "#prepare-return-base"]) {
        field(id).hidden = !reportedHolding || !["ridge", "ortega"].includes(selectedMapId);
        field(id).disabled = !!picture?.radioOrder;
      }
      field("#map-radio-state").textContent = picture?.radioOrder ? "Radio order transmitted; awaiting report."
        : reportedHolding ? "Remote observe/return: select VIA Radio yourself. Preparation keeps your chosen method; delivery is not guaranteed." : "";
      sizeMapTargets();
      renderLocalCoordinateMarker();
      const quick=quickPanel();
      if(quick && !quick.hidden){
        if(quick.dataset.selected==="local-coordinate" && localCoordinate)
          positionMapQuickActions();
        else if(!mapItems().has(quick.dataset.selected))hideMapQuickActions();
        else positionMapQuickActions();
      }
      scheduleChipAffordance();
    }
    function render() {
      field("#commander-name").textContent = terminal ? "" : projection?.commander.displayName ?? "";
      const controlStatus = terminal ? undefined : projection?.control.status;
      const presentation = controlPresentation(controlStatus);
      const canClaim = controlStatus === "inactive" || controlStatus === "available";
      field("#control-state").textContent = presentation.warningText;
      field("#control-warning").hidden = presentation.warningHidden;
      claimButton.hidden = !canClaim;
      claimButton.disabled = busy || claiming || commanderReads > 0 || !canClaim;
      claimButton.textContent = controlStatus === "available" ? "Claim command control" : "Move command control here";
      const active = controlStatus === "active";
      notificationButton.disabled = !notificationsActive();
      // Capture device-local view state while its scrolling box still exists.
      if (!active) scrubOperations();
      field("#operational-workspace").hidden = !active;
      field("#inactive-device").hidden = active;
      updateAttentionBox();
      miniTray.hidden = !active || workspaceSection !== "map" || !dockMinimized;
      field("#connection-status").textContent = terminal ? terminalMessage : controlStatus === "available"
        ? "Command control is available. Claim control to send orders."
        : projection ? "Connected. Control required to view operations." : controlMessage;
      if (!active) {
        closeViaChoices();
        const draftNotice = pending ? "An unconfirmed order is preserved on this device."
          : localDraft ? "A local draft is preserved on this device." : "";
        field("#local-draft-status").textContent = [localOutcome, draftNotice].filter(Boolean).join(" ");
        return;
      }
      if (!operationalVisible) {
        composer.value = localDraft; methodSelect.value = localMethod; operationalVisible = true;
      }
      // Direct/reloaded fragments could not receive focus while authority hid the workspace.
      if (initialWorkspaceFragment) {
        const fragment = initialWorkspaceFragment; initialWorkspaceFragment = undefined;
        if (platform.location.hash === fragment) field(fragment).focus();
      }
      const orders = [...observedOrders.values()];
      const assignment = assignmentPresentation(mercenary, knowledge, orders, picture);
      field("#ortega-status").textContent = mercenary ? assignment.status : "";
      field("#ortega-location").textContent = knowledge?.location ?? mercenary?.location ?? "";
      field("#ortega-report").textContent = knowledge?.report ?? "No outing report received.";
      const targets = [];
      if (knowledge?.facts.some(f => f.kind === "obstruction" && f.name === "fallen trunk" && f.route === "short")) targets.push("inspect the fallen trunk");
      if (knowledge?.facts.some(f => f.kind === "object" && f.id === "ridge-marker")) targets.push("inspect the stone marker");
      field("#known-targets").textContent = targets.length ? `Known targets: ${targets.join(" · ")}` : "";
      field("#ortega-version").textContent = mercenary ? String(mercenary.version) : "";
      field("#ortega-current-order").textContent = assignment.text;
      const replyLabel = field("#ortega-response-label");
      const replyOrder = latestOrder?.resultingMercenaryVersion === mercenary?.version ? latestOrder : undefined;
      replyLabel.textContent = replyOrder ? `Latest issued command · ${orderLabel(replyOrder.orderId)}: ${replyOrder.text}`
        : "Latest issued command unavailable";
      const lifecycle = replyOrder && orderLifecycle(replyOrder, knowledge, orders, picture);
      field("#ortega-response").textContent = replyOrder
        ? `${methodSummary(replyOrder)} · ${lifecycle.label}. ${["completed", "concluded", "holding-reported"].includes(lifecycle.state)
          ? `Evidence: received ${knowledge.source}.` : `At issue: ${orderFeedback(replyOrder)}`}`
        : "Refresh history for command feedback.";
      identifyOrder(replyLabel, replyOrder?.orderId);
      const brief = deliveredStatusBrief(replyOrder, picture, pictureFloor);
      renderDeliveredStatusBrief(platform.document, brief);
      field("#status-attribution").hidden = !mercenary?.lastResponse?.startsWith("Known facts:");
      const reportAttribution = field("#ortega-report-label");
      reportAttribution.textContent = reportLabel(knowledge?.report ? knowledge.orderId : null);
      identifyOrder(reportAttribution, knowledge?.report ? knowledge.orderId : null);
      commandButton.disabled = busy || claiming || controlStatus !== "active" || (!pending && (!mercenary || mercenary.version < minimumVersion));
      labelCommandButton(pending ? "Retry exact order" : "Send order");
      composer.disabled = busy || Boolean(pending);
      if (pending) methodSelect.value = pending.request.via;
      methodSelect.disabled = busy || Boolean(pending);
      syncViaChoices();
      if (older) { older.hidden = beforeVersion === null; older.disabled = busy || historyLoading || !historyLoaded || !historyEntries.length; }
      if (newer) { newer.hidden = pageIndex === 0; newer.disabled = busy || historyLoading || !historyLoaded; }
      if (latest) { latest.hidden = pageIndex === 0 && pageCursors[0] === null; latest.disabled = busy || historyLoading || !historyLoaded; }
      if (indication) indication.textContent = newItems ? "New orders available. Select Latest to see them." : "";
      status.textContent = [orderMessage, refreshMessage].filter(Boolean).join(" ");
      const latestLifecycle = latestOrder && orderLifecycle(latestOrder, knowledge, orders, picture);
      // A settled attempt may have been discarded by an authority scrub. Only
      // recovered, current history can promote its generic receipt; keep the
      // local acknowledgement for the next control loss or failed refresh.
      const recoveredReceipt = orderMessage === recordedAcknowledgement && historyLoaded
        && latestOrder?.resultingMercenaryVersion === mercenary?.version
        && latestOrder?.resultingMercenaryVersion >= minimumVersion;
      // Historical records cannot confirm this immutable, still-unknown attempt.
      if (pending?.outcome === "unknown" && !busy) {
        status.textContent = [outcomeMessage(pending), refreshMessage].filter(Boolean).join(" ");
      } else if (!pending && latestOrder && (!orderMessage || recoveredReceipt || (latestAttempt?.outcome === "recorded" && !latestAttempt.result
        && latestOrder.resultingMercenaryVersion === latestAttempt.request.expectedMercenaryVersion + 1) || (orderMessage.startsWith("At issue: ")
        && ["completed", "concluded", "holding-reported"].includes(latestLifecycle.state)))) {
        const presentation = latestLifecycle;
        status.textContent = `${presentation.label} · ${orderLabel(latestOrder.orderId)}. ${refreshMessage}`.trim();
        status.dataset.outcome = presentation.state;
      }
      renderOperations();
      renderPeople();
    }
    function fenceObservations() {
      observationBarrier++; mercenaryRevision++; historyRevision++;
      historyLoading = false; knowledgeRevision++; pictureRevision++;
    }
    function scrubOperations() {
      cancelDraftDrag(); renderedChipSignature=undefined;draftList.replaceChildren();
      scrubNotifications();
      scrubPeople();
      field("#contextual-actions").replaceChildren();
      field("#contextual-action-status").textContent = "";
      scheduleChipAffordance();
      if (operationalVisible) {
        localDraft = composer.value; localMethod = methodSelect.value;
        if (historyLoaded) historyScroll = historyList.scrollTop;
      }
      operationalVisible = false;
      mercenary = undefined; knowledge = undefined; picture = undefined; latestOrder = undefined;
      historyEntries = []; historyLoaded = false; orderVersions.clear(); observedOrders.clear();
      // Only a generic local outcome survives scrubbing. It contains no order,
      // actor, authority identity or server response, and is cleared on account change.
      orderMessage = localOutcome;
      if (!busy && latestAttempt && latestAttempt !== pending) latestAttempt = undefined;
      if (pending) delete pending.result;
      composer.value = ""; composer.disabled = true; methodSelect.value = "in-person"; methodSelect.disabled = true;
      syncViaChoices();
      for (const id of ["older-history", "newer-history", "latest-history", "prepare-clear-trunk",
        "prepare-observe-held", "prepare-return-base", "prepare-scout-ridge", "status-attribution", "delivered-status-brief"]) field(`#${id}`).hidden = true;
      commandButton.disabled = true; labelCommandButton("Send order");
      for (const id of ["ortega-status", "ortega-location", "ortega-report", "known-targets", "ortega-version",
        "ortega-current-order", "ortega-response-label", "ortega-response", "ortega-report-label", "access-status",
        "history-new-items", "map-selection-title", "map-known", "map-source", "map-received",
        "map-observed", "map-precision", "map-order", "map-unknown", "map-radio-state", "map-action-status",
        "delivered-status-contact", "delivered-status-label", "prepare-map-order"]) {
        const node = field(`#${id}`); if (node) node.textContent = "";
      }
      for (const node of field("#operational-workspace").querySelectorAll("[data-order-id], [data-order], [data-outcome]")) {
        node.removeAttribute("data-order-id"); node.removeAttribute("data-order"); node.removeAttribute("data-outcome");
        node.removeAttribute("title"); node.removeAttribute("aria-label");
      }
      hideMapQuickActions();localCoordinate=undefined;
      mapTouches.clear();pinchBase=undefined;mapZoom=0;
      historyList.replaceChildren(); reportedMapItems.replaceChildren(); operationsMap.replaceChildren();
      field("#received-report-history").replaceChildren(); field("#delivered-status-reports").replaceChildren();
      selectedMapId = "staging-area";
      // The section is non-sensitive view state. Only confirmed account/control
      // transitions reset it; every transient check still scrubs all records.
    }
    function changeAccount(next) {
      cancelDraftDrag(); draftList.replaceChildren();
      scrubPeople();
      if (accountId !== undefined || authorityContext) resetWorkspaceSection();
      accountRevision++; accountId = next; authorityContext = undefined;
      pending = undefined; latestAttempt = undefined; localDraft = ""; localMethod = "in-person"; localOutcome = "";
      replaceDraftIdentity();
      operationalVisible = false; historyScroll = undefined; mercenary = undefined; minimumVersion = 1;
      historyEntries = []; historyLoaded = false; orderMessage = "";
      latestOrder = undefined; orderVersions.clear(); observedOrders.clear(); status.dataset.outcome = "";
      pageCursors = [null]; pageIndex = 0; beforeVersion = null; newItems = false; knownNewest = 1;
      knowledge = undefined; knowledgeFloor = 0; picture = undefined; pictureFloor = 0;
      selectedMapId = "staging-area"; localCoordinate=undefined;
      composer.value = ""; fenceObservations(); renderHistory();
    }
    function invalidateControl() {
      commanderRevision++; projection = undefined; fenceObservations();
      controlMessage = "Checking command control…"; render();
    }
    function endWorkspace(message = "Returning to sign-in…") {
      terminal = true; terminalMessage = message;
      platform.clearTimeout(controlTimer);
      changeAccount(undefined);
      invalidateControl();
    }
    async function observeCommander(readCommander) {
      if (terminal) return false;
      invalidateControl();
      const revision = commanderRevision;
      commanderReads++;
      try {
        const result = await readCommander(() => !terminal && revision === commanderRevision && !platform.document.hidden);
        if (terminal || revision !== commanderRevision || platform.document.hidden) return false;
        if (result.status === 401) {
          endWorkspace();
          platform.location.assign("/play"); return false;
        }
        if (result.status !== 200 || !result.body?.commander || !result.body?.control)
          throw new Error("Commander is unavailable.");
        const next = result.body;
        if (!ACCOUNT_PATTERN.test(next.commander.id)
          || !["active", "inactive", "available"].includes(next.control.status)
          || !Number.isSafeInteger(next.control.version) || next.control.version < 0
          || (next.control.status === "active" && (next.control.version < 1 || !GRANT_PATTERN.test(next.control.grantId)))
          || (accountId === next.commander.id && authorityContext && next.control.version < authorityContext.controlVersion))
          throw new Error("Commander observation is invalid or superseded.");
        if (accountId !== next.commander.id) changeAccount(next.commander.id);
        const context = { accountId, grantId: next.control.grantId, controlVersion: next.control.version };
        if (authorityContext && !sameAuthority(authorityContext, context)) {
          resetWorkspaceSection();
          fenceObservations();
          refreshMessage = "Control changed. Check history before submitting a new order.";
        }
        if (next.control.status !== "active") resetWorkspaceSection();
        authorityContext = Object.freeze(context); projection = next;
        render(); return revision;
      } catch (error) {
        if (revision === commanderRevision) {
          projection = undefined;
          controlMessage = "Control state could not be refreshed. Use Refresh workspace before continuing.";
          render();
        }
        throw error;
      } finally { commanderReads--; render(); }
    }
    const bootstrapCommander = () => observeCommander(isCurrent => client.commanderForWorkspace(isCurrent));
    const refreshCommander = () => observeCommander(() => client.commander());
    const observation = revision => ({ accountId, accountRevision, barrier: observationBarrier, revision });
    const currentObservation = (read, revision) => !terminal && read.accountId === accountId && read.accountRevision === accountRevision
      && read.barrier === observationBarrier && read.revision === revision && projection?.control.status === "active";
    function requireAccount(result, read) {
      if (result.status === 401 || (result.status === 200 && result.body?.accountId !== read.accountId)) {
        if (result.status === 401) endWorkspace();
        else { changeAccount(undefined); invalidateControl(); }
        if (result.status === 401) platform.location.assign("/play");
        throw new Error("Workspace account changed.");
      }
      if (result.status !== 200) {
        invalidateControl();
        controlMessage = "Workspace could not be refreshed. Use Refresh workspace before continuing.";
        render(); throw new Error("Workspace is unavailable.");
      }
    }
    function applyMercenary(value) {
      if (!value || !Number.isSafeInteger(value.version) || value.version < minimumVersion) return false;
      minimumVersion = value.version; mercenary = value; render(); return true;
    }
    async function refreshMercenary() {
      if (terminal || !accountId || projection?.control.status !== "active") return;
      const read = observation(++mercenaryRevision);
      let result = await api("/api/mercenaries");
      if (!currentObservation(read, mercenaryRevision)) return;
      requireAccount(result, read);
      if (result.body.mercenaries.length === 0) result = await api("/api/mercenaries/initialize", {});
      if (!currentObservation(read, mercenaryRevision)) return;
      requireAccount(result, read);
      if (result.body.mercenaries.length !== 1 || !applyMercenary(result.body.mercenaries[0]))
        throw new Error("Ortega is unavailable or superseded.");
    }
    async function refreshKnowledge() {
      if (terminal || !accountId || projection?.control.status !== "active") return;
      const read = observation(++knowledgeRevision);
      const result = await api("/api/knowledge");
      if (!currentObservation(read, knowledgeRevision)) return;
      requireAccount(result, read);
      const value = result.body.knowledge;
      if (value !== null) {
        if (!Number.isSafeInteger(value.revision) || value.revision < knowledgeFloor) return;
        knowledgeFloor = value.revision; knowledge = value;
      } else if (knowledgeFloor === 0) knowledge = undefined;
      renderHistory(); render();
    }
    async function refreshPicture() {
      if (terminal || !accountId || projection?.control.status !== "active") return;
      const read = observation(++pictureRevision);
      try {
        const result = await api("/api/operations-picture");
        if (!currentObservation(read, pictureRevision)) return;
        requireAccount(result, read);
        const value = result.body.picture;
        if (!value || !Number.isSafeInteger(value.revision) || value.revision < pictureFloor) return;
        pictureFloor = value.revision; picture = value;
        const received = notificationFeed.receive(value.reports);
        notificationReports = received.entries; notificationReportState = ""; renderNotifications();
        // A newer clearing receipt invalidates an old "blocked" attention
        // cue. Do not leave a misleading priority toast after the last
        // credible reported condition has changed.
        const importantIds = new Set(attentionReports(value.reports).map(entry=>entry.id));
        const preserved = toastQueue.filter(entry=>importantIds.has(entry.id));
        if (preserved.length !== toastQueue.length) {
          toastQueue=preserved;
          if (preserved.length) showToast(); else clearToasts();
        }
        if (!notificationDialog.open && notificationsActive()) {
          const wasEmpty = toastQueue.length === 0;
          toastQueue = [...toastQueue, ...received.fresh.filter(entry=>importantIds.has(entry.id))].slice(0, 3);
          if (wasEmpty && toastQueue.length) showToast();
        }
        renderHistory(); render(); scheduleReportPoll();
        return read;
      } catch (error) {
        if (currentObservation(read, pictureRevision)) {
          invalidateControl();
          controlMessage = "Workspace could not be refreshed. Use Refresh workspace before continuing.";
          render();
        }
        throw error;
      }
    }
    async function refreshHistory(navigation) {
      if (terminal || !accountId || projection?.control.status !== "active" || (navigation && (historyLoading || busy || !historyLoaded))) return;
      const targetPage = navigation === "older" ? pageIndex + 1 : navigation === "newer" ? pageIndex - 1 : navigation === "latest" ? 0 : pageIndex;
      if (targetPage < 0 || (navigation === "older" && (beforeVersion === null || !historyEntries.length))) return;
      const pageAnchor = historyEntries[0]?.resultingMercenaryVersion;
      const cursor = navigation === "older" ? beforeVersion : navigation === "newer" ? pageCursors[targetPage] : navigation === "latest" ? null : pageCursors[pageIndex];
      const read = observation(++historyRevision);
      historyLoading = true; render();
      try {
        // A pinned page is reloaded after scrubbing; first observe the latest
        // immutable records so assignment labels and new-item notices stay fresh.
        if (!navigation && cursor !== null) {
          const newest = await api("/api/orders/history", { limit: 20, beforeVersion: null });
          if (!currentObservation(read, historyRevision)) return;
          requireAccount(newest, read);
          for (const entry of newest.body.entries) rememberOrder(entry);
          notificationOrders = orderNotifications(newest.body.entries); notificationOrderState = ""; renderNotifications();
          newItems ||= (newest.body.entries[0]?.resultingMercenaryVersion ?? 1) > knownNewest;
          if (newest.body.entries.length) applyMercenary(newest.body.entries[0].mercenary);
        }
        const result = await api("/api/orders/history", { limit: 20, beforeVersion: cursor });
        if (!currentObservation(read, historyRevision)) return;
        requireAccount(result, read);
        const entries = result.body.entries;
        if (cursor === null && (entries[0]?.resultingMercenaryVersion ?? 1) < minimumVersion)
          throw new Error("History observation was superseded.");
        if (new Set(entries.map(entry => entry.orderId)).size !== entries.length
          || new Set(entries.map(entry => entry.resultingMercenaryVersion)).size !== entries.length)
          throw new Error("History page was superseded.");
        for (const entry of entries) rememberOrder(entry);
        if (cursor === null) { notificationOrders = orderNotifications(entries); notificationOrderState = ""; renderNotifications(); }
        if (cursor === null && entries.length) applyMercenary(entries[0].mercenary);
        if (navigation === "older") {
          // Pin the page we actually visited only after navigation succeeds.
          // A null cursor would turn Newer into a jump past later arrivals.
          pageCursors[pageIndex] ??= pageAnchor + 1;
          pageCursors[targetPage] = cursor;
        }
        pageIndex = targetPage;
        if (cursor === null) {
          pageCursors = [null]; newItems = false; knownNewest = entries[0]?.resultingMercenaryVersion ?? 1;
        }
        historyEntries = entries; historyLoaded = true; beforeVersion = result.body.nextBeforeVersion;
        renderHistory();
        if (navigation) { historyScroll = undefined; historyList.scrollTop = 0; historyList.focus({ preventScroll: true }); }
      } catch (error) {
        // A superseded body/transport failure must not reach navigation's UI catch.
        if (currentObservation(read, historyRevision)) throw error;
      } finally {
        if (currentObservation(read, historyRevision)) { historyLoading = false; render(); }
      }
    }
    async function refreshLifecycleDependencies() {
      // Separate evidence readback from the displayed page. Two extra pages at
      // most; api() retains its native ten-second deadline for each request.
      if (!knowledge?.report || !mercenary?.currentOrder || !historyLoaded) return;
      const read = observation(historyRevision);
      for (let page = 0; page < 2; page++) {
        if (!currentObservation(read, historyRevision)
          || !assignmentPresentation(mercenary, knowledge, [...observedOrders.values()], picture).incomplete) return;
        const versions = new Set([...observedOrders.values()].map(entry => entry.resultingMercenaryVersion));
        let cursor = mercenary.version + 1;
        while (versions.has(cursor - 1)) cursor--;
        if (cursor <= 2) return;
        const result = await api("/api/orders/history", { limit: 20, beforeVersion: cursor });
        if (!currentObservation(read, historyRevision)) return;
        requireAccount(result, read);
        const entries = result.body.entries;
        if (!entries.length) return;
        if (entries[0].resultingMercenaryVersion !== cursor - 1
          || !coveredOrderSpan(entries, entries.at(-1).resultingMercenaryVersion, cursor - 1))
          throw new Error("Lifecycle history coverage is incomplete.");
        for (const entry of entries) rememberOrder(entry);
        renderHistory(); render();
        if (result.body.nextBeforeVersion === null) return;
      }
    }
    async function refreshWorkspace(readCommander = refreshCommander) {
      if (terminal) return;
      // Operational reads require a fresh positive authority observation.
      const commander = await Promise.allSettled([readCommander()]);
      if (commander[0].status !== "fulfilled" || commander[0].value !== commanderRevision
        || projection?.control.status !== "active") { render(); return; }
      const scope = accountRevision, barrier = observationBarrier;
      // Picture requires initialized Ortega. Independent history/knowledge reads
      // share the same authority barrier; none may revive a superseded refresh.
      const results = await Promise.allSettled([(async () => {
        await refreshMercenary();
        if (terminal || scope !== accountRevision || barrier !== observationBarrier) return;
        await refreshPicture();
      })(), refreshHistory(), refreshKnowledge()]);
      if (scope !== accountRevision || barrier !== observationBarrier) return;
      refreshMessage = [...commander, ...results].some(result => result.status === "rejected")
        ? "Some workspace refreshes are unavailable. Refresh before continuing." : "";
      render();
      // Evidence readback must not delay bootstrap polling or hold a settled
      // command/claim busy. Its own observation fence still governs every page.
      const lifecycleRevision = historyRevision;
      refreshLifecycleDependencies().catch(() => {
        if (scope !== accountRevision || barrier !== observationBarrier || lifecycleRevision !== historyRevision) return;
        refreshMessage = "Lifecycle history is unavailable. Outcome not confirmed from available records.";
        render();
      });
      if (results.every(result => result.status === "fulfilled") && picture && historyLoaded && mercenary)
        return observation(commander[0].value);
    }
    claimButton.addEventListener("click", async () => {
      if (terminal || busy || claiming || commanderReads || !["inactive", "available"].includes(projection?.control.status)) return;
      const version = projection.control.version;
      claiming = true; fenceObservations(); invalidateControl();
      try { await client.claimControl(version); }
      catch { refreshMessage = "Control could not be confirmed. Refresh to retry."; }
      finally { await refreshWorkspace(); claiming = false; render(); }
    });
    function canPlanMapOrder() {
      return !terminal && connected && !busy && !claiming && !pending && !composer.disabled
        && projection?.control.status === "active" && !platform.document.hidden;
    }
    function selectMapObject(id, anchor) {
      if (terminal || projection?.control.status !== "active" || !mapItems().has(id)) return;
      selectedMapId = id; localCoordinate=undefined;renderLocalCoordinateMarker();
      mapActionStatus.textContent = ""; renderOperations();
      showMapQuickActions(id,anchor);
    }
    operationsMap.addEventListener("click", event => {
      if(Date.now()<mapPinchSuppressUntil)return;
      const target = event.target.closest?.("[data-map-id]");
      if(target){
        if(!operationsMap.contains(target)||target.getAttribute("aria-disabled")==="true")return;
        selectMapObject(target.dataset.mapId,{x:event.clientX,y:event.clientY});
        return;
      }
      // Background, grid and contours all belong to the SVG. A single
      // intentional tap is a selectable planning coordinate, not an object.
      if(event.target.closest?.(".synthetic-range svg"))
        selectLocalCoordinate(event);
    });
    operationsMap.addEventListener("keydown", event => {
      const target = event.target.closest?.('g[data-map-id]');
      if (!target || !operationsMap.contains(target) || target.getAttribute("aria-disabled") === "true"
        || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      if (!event.repeat) selectMapObject(target.dataset.mapId);
    });
    function revealMapPreparationBlocker() {
      // A quick Prepare can be used while the evidence panel is hidden.
      // Never focus a hidden status: reveal the same source-backed inspector
      // and dismiss its map popup so neither steals taps or masks the warning.
      if (mobileWorkspace?.matches === true && workspaceSection === "map") {
        hideMapQuickActions();
        operationalWorkspace.dataset.evidenceOpen = "true";
      }
      mapActionStatus.focus({preventScroll:true});
    }
    function prepareOrderText(text) {
      if (!text || !picture || terminal || projection?.control.status !== "active") return;
      if (composer.disabled) {
        mapActionStatus.textContent = "The composer is locked while an order attempt is pending.";
        revealMapPreparationBlocker();
      } else if (composer.value.length > 0 && composer.value !== text) {
        mapActionStatus.textContent = "Existing draft kept. Clear it before preparing this map action.";
        revealMapPreparationBlocker();
      } else {
        if (!mutateDraft(text)) return;
        selectWorkspaceSection("orders"); composer.focus();
        mapActionStatus.textContent = "Order prepared. Review it, then use Send order.";
      }
    }
    field("#prepare-clear-trunk").addEventListener("click", () => {
      if (contextualActions(selectedMapId, picture).some(action => action.id === "clear-trunk")) prepareOrderText("clear the fallen trunk");
    });
    prepareMapOrder.addEventListener("click", () => prepareOrderText(prepareMapOrder.dataset.order));
    field("#prepare-scout-ridge").addEventListener("click", () => {
      if (selectedMapId === "ridge") prepareOrderText("Ortega, please explore the ridge quickly if blocked, reroute then come back and report.");
    });
    field("#prepare-observe-held").addEventListener("click", () => prepareOrderText("observe here"));
    field("#prepare-return-base").addEventListener("click", () => prepareOrderText("return to base"));
    function outcomeMessage(attempt) {
      status.dataset.outcome = attempt.result ? orderPresentation(attempt.result).state
        : attempt.outcome === "unknown" ? "unconfirmed" : attempt.outcome;
      if (attempt.outcome === "recorded") return attempt.result
        ? `At issue: ${orderPresentation(attempt.result).label} · ${orderLabel(attempt.result.orderId)}. ${orderFeedback(attempt.result)}`
        : recordedAcknowledgement;
      if (attempt.outcome === "rejected") return "Order was rejected. State or control changed; review history before submitting again.";
      if (attempt.dispatched) return pending === attempt
        ? "Order outcome is unconfirmed. Retry the exact order, or reload and check server history."
        : "Order outcome is unconfirmed. Control changed; check server history before a new order.";
      return "Order was not sent. Refresh workspace and check command control before continuing.";
    }
    orderForm.addEventListener("submit", async event => {
      event.preventDefault();
      if (terminal || busy || claiming || projection?.control.status !== "active" || (!pending && (!mercenary || mercenary.version < minimumVersion))) return;
      // Normalize only a new draft. A dispatched retry always uses its frozen request.
      let text;
      try { text = pending ? pending.request.text : normalizeOrderDraft(composer.value); }
      catch (error) {
        status.dataset.outcome = "input-error";
        orderMessage = error.message; render(); return;
      }
      // Keep the immutable attempt in this device closure across control loss.
      // Only explicit submission after reacquisition may reconcile its old key.
      const attempt = pending ?? { accountRevision, draftIdentity, dispatched: false, outcome: "not-dispatched",
        request: Object.freeze({ idempotencyKey: opaque(), mercenaryId: "ortega", expectedMercenaryVersion: mercenary.version,
          text, via: methodSelect.value, expectedAuthority: Object.freeze({ ...authorityContext }) }) };
      latestAttempt = attempt; localOutcome = ""; busy = true; refreshMessage = ""; render();
      let reconciliation;
      try {
        const controlRevision = await refreshCommander();
        if (controlRevision !== commanderRevision || !visibleAttempt(attempt)
          || projection?.control.status !== "active" || (!pending && !sameAuthority(attempt.request.expectedAuthority, authorityContext))) {
          return;
        }
        fenceObservations(); attempt.dispatched = true; attempt.outcome = "unknown"; pending = attempt;
        status.dataset.outcome = "pending";
        orderMessage = "Submitting order · awaiting server confirmation…"; render();
        let responseBarrier;
        const result = await api("/api/method-orders", attempt.request, (statusCode, current) => {
          attempt.outcome = statusCode === 201 ? "recorded"
            : [400, 401, 403, 409, 413, 415].includes(statusCode) ? "rejected" : "unknown";
          if (attempt.outcome === "recorded") retireAttemptDraft(attempt);
          if (!visibleAttempt(attempt)) return false;
          if (attempt.outcome !== "unknown") {
            if (attempt.outcome === "recorded") localOutcome = recordedAcknowledgement;
            if (attempt.outcome === "rejected") localOutcome = outcomeMessage(attempt);
            if (pending === attempt) pending = undefined;
            // Definitive 201 headers establish a version floor even when a
            // same-grant refresh has superseded the dispatch observation.
            // Only fresh reads may recover the private outcome in that case.
            const confirmedAuthority = attempt.outcome === "recorded" && projection?.control.status === "active"
              && sameAuthority(attempt.request.expectedAuthority, authorityContext);
            if (!current && !confirmedAuthority) return false;
            fenceObservations();
            if (attempt.outcome === "recorded") {
              minimumVersion = Math.max(minimumVersion, attempt.request.expectedMercenaryVersion + 1);
            }
            orderMessage = outcomeMessage(attempt); render();
            reconciliation = refreshWorkspace();
            if (!current) return false;
          }
          responseBarrier = observationBarrier;
          return statusCode === 201;
        });
        if (visibleAttempt(attempt) && responseBarrier === observationBarrier
          && sameAuthority(attempt.request.expectedAuthority, authorityContext)
          && projection?.control.status === "active" && result.status === 201 && result.body?.mercenary) {
          attempt.result = result.body;
          rememberOrder(result.body); renderHistory();
          orderMessage = outcomeMessage(attempt);
          applyMercenary(result.body.mercenary);
        }
      } catch {
        // The immutable attempt's known outcome wins over body/transport errors.
      } finally {
        if (visibleAttempt(attempt)) orderMessage = outcomeMessage(attempt);
        if (reconciliation) await reconciliation;
        busy = false; render();
      }
    });
    // Initial load is the sole automatic acquisition path. Every later refresh
    // observes authority and starts account-bound, version-fenced projections.
    const bootstrap = refreshWorkspace(bootstrapCommander);
    async function refresh() { await bootstrap; return refreshWorkspace(); }
    let focusRevision = 0;
    platform.document.addEventListener("focusin", () => { focusRevision++; });
    async function refreshWithReportFocus() {
      // Retain only an opaque identity across the mandatory privacy scrub.
      const mapId = reportedMapItems.contains(platform.document.activeElement)
        ? platform.document.activeElement?.dataset.mapId : undefined;
      const intent = mapId && !terminal && projection?.control.status === "active"
        ? { mapId, authority: authorityContext, accountRevision, focusRevision } : undefined;
      const refreshed = await refresh();
      if (!intent || !refreshed || platform.document.hidden
        || !currentObservation(refreshed, commanderRevision)
        || intent.accountRevision !== accountRevision || !sameAuthority(intent.authority, authorityContext)
        || intent.focusRevision !== focusRevision
        || ![platform.document.body, platform.document.documentElement].includes(platform.document.activeElement)) return;
      const button = [...reportedMapItems.querySelectorAll("button[data-map-id]")]
        .find(node => node.dataset.mapId === intent.mapId);
      button?.focus({ preventScroll: true });
    }
    // Observe only the small, no-store authority projection, never the operational
    // dashboard. Serialize polls and fence responses against foreground refreshes.
    // A failed/expired observation fails closed; it never claims control or retries.
    let controlTimer, observingControl = false;
    function scheduleControlObservation() {
      platform.clearTimeout(controlTimer);
      if (!terminal && !platform.document.hidden) controlTimer = platform.setTimeout(observeControl, 2000);
    }
    async function observeControl() {
      if (terminal || observingControl || platform.document.hidden) return;
      // Foreground checks own the unknown state until their bounded read settles.
      if (commanderReads) { scheduleControlObservation(); return; }
      observingControl = true;
      const revision = commanderRevision;
      try {
        const result = await client.commander();
        if (terminal || revision !== commanderRevision || commanderReads || platform.document.hidden) return;
        const next = result.body;
        const context = { accountId: next?.commander?.id, grantId: next?.control?.grantId, controlVersion: next?.control?.version };
        if (result.status === 200 && projection && next?.commander && next?.control
          && next.control.status === projection.control.status && sameAuthority(authorityContext, context)) return;
        await refreshWorkspace(() => observeCommander(async () => result));
      } catch {
        if (revision === commanderRevision) {
          invalidateControl();
          controlMessage = "Control state could not be refreshed. Use Refresh workspace before continuing.";
          render();
        }
      } finally {
        observingControl = false; scheduleControlObservation();
      }
    }
    bootstrap.finally(scheduleControlObservation);
    refreshButton.addEventListener("click", refreshWithReportFocus);
    older?.addEventListener("click", () => refreshHistory("older").catch(() => {
      refreshMessage = "Older history is unavailable. Refresh workspace to continue."; render();
    }));
    newer?.addEventListener("click", () => refreshHistory("newer").catch(() => { refreshMessage = "History unavailable."; render(); }));
    latest?.addEventListener("click", () => refreshHistory("latest").catch(() => { refreshMessage = "History unavailable."; render(); }));
    platform.addEventListener("offline", () => {
      connected = false; quietNotifications(); platform.clearTimeout(pollTimer);
      scrubPeople();
      notificationButton.disabled = true;
    });
    platform.addEventListener("online", () => { connected = true; quietNotifications(); refresh(); });
    platform.addEventListener("pageshow", event => {
      // A new document already bootstraps once. BFCache restoration and explicit
      // refresh events must reobserve; initial pageshow must not scrub ready UI.
      pageActive = true;
      if (event.persisted === false) return;
      refresh().finally(scheduleControlObservation);
    });
    platform.addEventListener("pagehide", () => { pageActive = false; platform.clearTimeout(controlTimer); invalidateControl(); });
    platform.document.addEventListener("visibilitychange", () => {
      if (platform.document.hidden) { platform.clearTimeout(controlTimer); invalidateControl(); }
      else { refresh().finally(scheduleControlObservation); }
    });
  }

  if (typeof module === "object" && module?.exports) module.exports = {
    ATTEMPT_KEY,
    COMMAND_HISTORY_KEY,
    COMMAND_PENDING_KEY,
    controlPresentation,
    createClient,
    contextualActions, routeKnowledge, draftTokens, editDraftTokens, progressiveSuggestions,
    notificationTime, orderNotifications, reportNotifications, attentionReports, createNotificationFeed,
    normalizeOrderDraft,
    orderPresentation,
    orderFeedback,
    methodSummary,
    orderLifecycle,
    assignmentPresentation,
    personnelPresentation,
    peopleReportPreview,
    deliveredStatusBrief,
    renderDeliveredStatusBrief,
  };
  if (typeof document === "object") mount(globalThis);
})();
