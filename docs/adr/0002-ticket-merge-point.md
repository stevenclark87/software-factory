# ADR 0002: Tickets merge at the end of their build loop, serialized by the parent

**Status:** Accepted, 2026-11-20

## Context

Tickets in a spec depend on each other's code. In the first pilot spec, three frontend tickets need the
types and routes added by the first ticket, so their sandboxes must branch from something that already
contains it. The first draft of the Phase 1 plan merged ticket branches only at Integrate, after fan-out,
which is too late for dependent tickets.

## Decision

1. **Merge point.** A ticket merges into the integration branch (`factory/feature-<spec>`) as the last
   step of its build loop, once its checks pass and its review approves. Integrate (full CI, DynamoDB
   integration tests) runs afterwards on the integration branch. Dependent tickets branch from the
   integration branch head when their sandbox opens.
2. **Serialized merges.** The child `TicketWorkflow` returns ready-to-merge. The parent `FactoryWorkflow`
   performs merges one at a time through a worker activity, so two tickets never race on the integration
   branch. The ticket branch is pushed for audit; there is no PR per ticket.
3. **Conflicts.** If the integration branch has moved and the merge conflicts, the ticket is rebased in
   its still-warm sandbox and its checks re-run. The rebase counts as one attempt against the retry limit
   (3), then the ticket escalates. The reviewer diffs against the merge-base with the integration branch
   (`git merge-base HEAD factory/feature-<spec>`), not the integration head at sandbox open, so the diff
   stays correct after the rebase.
4. **Commits and pushes.** Each attempt's commits stay in the factory's local clone, and the worker
   commits at the end of every attempt so a sandbox is disposable. The worker pushes to GitHub only at the
   merge point: the ticket branch with every attempt (for audit), then a squash merge into the integration
   branch, one commit per ticket with a conventional-commit message built from the ticket. This keeps the
   acceptance PR readable while the audit trail stays on the ticket branch. One commit per ticket also
   makes the integration branch bisectable.
   - Each squash commit carries a merge trailer, `Factory-Ticket-Run: <ticket-run workflow ID>`. Before
     merging, the merge activity checks the integration branch log for that trailer. If it is already
     there, the push happened earlier and the merge is a no-op, so a retried merge is safe.
   - The trailer is keyed on the ticket-run workflow ID, not the run key, because the run key includes the
     attempt. A reopened ticket is a new ticket run with a new workflow ID, so it can merge again.
5. **Integrate failures.** Integrate runs after the merges, not per ticket. Phase 1 does not attribute an
   Integrate failure to a ticket. Any Integrate failure escalates the whole spec to `factory:needs-human`
   with the failing output attached. The escalation comment lists the ticket commits on the integration
   branch so a human can bisect. Clearing the escalation is a comment on the spec issue by an allowlisted
   user, received by the parent workflow as a signal. Labels stay worker-written.
   - `/factory resume integrate` re-runs Integrate on the current integration head, after a human pushes a
     fix.
   - `/factory resume abandon` abandons the spec.
   - `/factory reopen #N` reopens ticket N. Reopening is a command, not a label. It is accepted only when N
     is a ticket under this spec that has merged or been abandoned. Any other N is refused, and every
     reopen is refused once the spec's acceptance PR has merged. A refusal posts a reply comment and changes
     nothing. An accepted reopen starts a new ticket run that fixes forward: it builds on the current
     integration head and adds a second squash commit with its own `Factory-Ticket-Run` trailer. Nothing is
     reverted. Integrate re-runs automatically after the reopened ticket merges.
   - A human fix pushed straight to the integration branch bypasses per-ticket review. The acceptance PR
     gate is where that change is reviewed.

## Consequences

- Dependent tickets build on code that full CI has not yet verified. If Integrate fails, the spec
  escalates and no dependent is rerun automatically. The fix comes from a human push or a reopened ticket,
  and the next Integrate run verifies the result. A human push bypasses per-ticket review; the acceptance
  PR gate covers it.
- Future option, not in Phase 1: run full CI after each serialized merge. This gives automatic attribution
  of a failure to a ticket and removes the consequence above, at a time cost.
- Merge conflicts consume retry budget, so heavily overlapping tickets escalate sooner. `maxParallel`
  stays low (2) at first.
- Parent workflow history grows with one merge step per ticket; acceptable at pilot size.
