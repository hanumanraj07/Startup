# 01 — Product Requirements

## Product

**OnSite** — someone on the ground, wherever you need them.

## The problem

People regularly need something done at a place they cannot get to.

Someone in Ahmedabad wants to buy a laptop from a specific shop in Kolkata. They want it physically inspected, photographed, its serial number verified, its price negotiated, before committing ₹80,000. Their realistic options today are all bad:

| Option | Why it fails |
|---|---|
| Travel there | Costs more than the saving and takes two days |
| Ask a friend or relative | Only works if you have one there and they are free |
| Hire an agency | Priced for corporate work, not a single errand |
| Find someone online | No verification, no recourse, no reason to trust them |

The gap is a trustworthy way to pay a stranger to be somewhere on your behalf.

## The solution

A marketplace connecting people who need a physical task done at a specific location with verified people already near that location, with the platform providing the three things strangers transacting cannot provide themselves:

1. **Matching** — finding someone genuinely near the task location who is capable and available.
2. **Proof** — structured evidence that the work was actually done, with GPS and timestamps.
3. **Protected payment** — money committed up front, held, and released only against accepted evidence.

## Core users

**Task Requester.** Needs something done somewhere they are not. Creates and funds tasks, reviews evidence, approves or disputes, rates the worker.

**Task Executor.** Is already near the task location and wants to earn. Sets availability and radius, discovers nearby tasks, accepts, executes, submits proof, gets paid, rates the requester.

**Administrator.** Reviews KYC, resolves disputes, enforces prohibited-task rules, monitors marketplace health.

One account can act as both requester and executor. Role is a mode, not a separate registration.

## Value proposition

**To requesters:** get eyes, hands and verified evidence anywhere in India, for a fraction of the cost of travelling or hiring an agency, without having to trust a stranger on faith.

**To executors:** earn money from tasks near where you already are, on your own schedule, with the certainty that the money is already committed before you leave the house.

## What makes this hard, and therefore what makes it defensible

**Trust is the product.** The technology is not the difficult part. Convincing someone in Ahmedabad to send ₹80,000 of intent through a stranger in Kolkata is. Everything, verification levels, proof requirements, escrow, ratings, disputes, exists to make that leap smaller.

**It is a two-sided cold start.** With no workers, tasks go unaccepted. With no tasks, workers leave. This is why launch is deliberately confined to two cities and one category.

## Initial market

India. Launch cities **Ahmedabad and Kolkata only**.

The pairing is deliberate: it matches the founding use case, gives one origin city and one destination city, and keeps worker recruitment to a size one person can do by hand.

## Launch categories

Launch positioning is not "any task anywhere." It is:

> Get someone you trust to verify something anywhere in India.

Only these categories are enabled at launch:

| Category | Example |
|---|---|
| Product inspection | Check a laptop at a shop before buying it remotely |
| Shop and business verification | Confirm a supplier's premises exist and are operating |
| Property inspection | Visit a flat, record a video walkthrough, photograph the condition |
| Document collection | Collect papers from an office and confirm handover |
| Local photography | Photograph a location, a signboard, a site |
| Local research | Visit a place, ask specified questions, report the answers |

Everything else is out of scope at launch. Not because it lacks value, but because a narrow category is one whose fraud modes, safety risks and pricing are all understandable. See `docs/18-future-roadmap.md` for what follows.

## What is explicitly not being built

- Any task category outside the six above
- Cities beyond Ahmedabad and Kolkata
- Cash handling, purchasing on the requester's behalf, or any task where the worker fronts money
- Tasks involving valuables in transit
- Anything on the prohibited list in `docs/12-trust-safety.md`

The purchasing exclusion matters. The founding example ends with "do NOT purchase it" for a reason: the moment a worker carries ₹80,000 of someone else's money, the trust and liability model becomes a different and much harder business.

## Success criteria

Downloads and signups are not the measure. These are:

| Metric | Why it matters | Launch target |
|---|---|---|
| **Task completion rate** | Completed ÷ accepted. The single most important number. Below 90% the product is not trustworthy | ≥ 90% |
| **Time to match** | Posted → accepted. Long waits kill requester confidence | Median under 30 minutes in-city |
| **Worker acceptance rate** | Accepted ÷ shown. Low means matching or pricing is wrong | ≥ 25% |
| **Repeat requester rate** | Someone returning is the strongest signal the product works | ≥ 30% within 60 days |
| **Dispute rate** | Disputes ÷ completed | Under 5% |

## Constraints

- **Regulatory.** A marketplace holding user funds in India requires a nodal or escrow arrangement. See `docs/11-payment-flow.md`.
- **Trust before scale.** Growth beyond two cities before completion rate and dispute rate are healthy would multiply a broken model.
- **Worker safety is a hard limit.** No task that places a worker somewhere unsafe ships, whatever it pays.
