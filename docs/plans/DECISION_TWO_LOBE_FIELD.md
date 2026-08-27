# OPEN DECISION — the two-lobe field, and whether it replaces the shipped aurora

**Raised:** 2026-08-27, from an `architect` pass over the canvas token system.
**Status:** **OPEN. Deliberately not decided.** The canvas has been marked `INTENDED` rather than
left reading as truth, which is the honest holding position — not a resolution.
**Routing when it is picked up:** `architect` (the breath-law reconciliation) → `designer` (it changes
the app's signature gesture) → `developer` + `resilience-auditor` if it is ratified.

---

## What is actually in dispute

**What the app renders today** — `mobile/KokonadaHealth/src/experience/aurora/auroraField.ts`:
four blobs (`sky` / `violet` / `gold` / `pink`) at fixed fractional positions, drifting over
`motion.duration.flow` = 15000ms, pinned by `auroraField.test.ts:48` — *"is exactly PERIODIC over
motion.duration.flow (the loop never seams)."*

**What six canvas boards draw** — `Field`, `Genesis`, `Main`, `NowPlaying`, `Pulse`, `You`: two lobes,
periods 4200ms and 5670ms, under the law stated at `Field.dc.html`: `T = 4200 + 2000 × stress`, with
the second lobe at a fixed `1.35 × T`.

**And `Field.dc.html` does not present this as an alternative.** It says: *"it replaces the tide, and
it never becomes four drifting blobs again."* That is a repudiation of the shipped renderer.

**No ADR, spec section or task authorises it.** `docs/UI_UX_OVERHAUL_SPEC.md:15` requires only "a big,
soft, breathing field" — it ratifies neither implementation. Daniel has no record of approving it.
**Being drawn on six boards is not authorisation**, which is precisely why this file exists.

## The blocker — ratification is not currently possible

**Two contradictory breath-ceiling laws are documented, and neither cites the other:**

| | Law | At full stress |
|---|---|---|
| Canvas — `Field.dc.html` | `T = 4200 + 2000 × stress` (**additive**) | **6200ms** |
| Shipped — `mobile/KokonadaHealth/src/experience/aura/auraBreath.ts:13-14` | `BREATH_CEIL_MS = BREATH_FLOOR_MS × 1.5` (**multiplicative**) | **6300ms** |

You cannot write an ADR that ratifies a breath law while two incompatible ones stand unreconciled.
**Resolving this is a precondition for the ratify path — not a step within it.**

## Why this is not a token question

`--d-field: 5670ms` looks like the field's period. It is not. It is `4200 × 1.35` — the law evaluated
at **stress = 0**. At full stress the correct second lobe is `6200 × 1.35` = **8370ms**.

Promoting 5670 to `tokens.ts` as a duration primitive would freeze a *sample* as a *constant*, and the
primitive it hides — the `1.35` ratio — is the thing that makes the field respond to stress at all.
The field would render identically, every board would pass, every measurement would stay green, and
the regulator ethic would be silently dead. No structural check can catch that; only reading the law can.

`tokens.css` now says this in a comment at the declaration.

## The two paths, costed

| | **Ratify — write the ADR and build it** | **Revert — canvas returns to the shipped design** |
|---|---|---|
| **Precondition** | **Reconcile 6200 vs 6300 first.** Blocking. | none |
| **App change** | Replace the geometry in `auroraField.ts` and the renderer in `LivingAurora.tsx`; implement `T = 4200 + 2000×stress` and the `1.35` second lobe | **none** |
| **Test change** | Rewrites `auroraField.test.ts` — and the **seam test's premise dies**: at a 20:27 ratio the two lobes realign only every **113.4 seconds**, so *"exactly periodic over `flow`"* is no longer the contract. A replacement invariant has to be designed, not just renamed | none |
| **Canvas change** | none — six boards already draw it | Six boards' field CSS back to four radial blobs at the shipped fractional positions; delete `--d-field`; **rewrite `Field.dc.html` entirely**, since the two-lobe field is its whole thesis |
| **Also needs** | Re-verify contrast over a changed field; a `designer` pass, because this is the app's signature gesture | A fresh review of the Field board |
| **Reversibility** | **Low.** Once the four-blob geometry is replaced it is gone | **High** |

## What is not in dispute, and argues against reverting casually

The **113.4-second non-repeat is almost certainly the point.** `Field.dc.html` calls the 1.35 ratio
*"where the drift comes from"* — two lobes at 20:27 produce a field that never visibly loops, which is
a genuinely better answer than a 15-second cycle for an ambient layer someone stares at during a
four-minute track. A partial port that renders one lobe loses the entire gesture.

So this is not "canvas wrong, app right." It is an unratified idea that may well be the better one,
drawn as though it were already the product.

## The holding position, and why it is not the defect we keep finding

The canvas is marked **`INTENDED END-STATE — NOT WHAT THE APP RENDERS TODAY`**, using the same
convention `Connect.dc.html` already uses, plus a note naming the shipped renderer and pointing here.

The recurring defect in this project is *a board promising what the app cannot produce **without
saying so***. A board that says so is the honest version of the same drawing. It is not a resolution
and must not be mistaken for one — six boards still depict a renderer that does not exist.

## Related

- `docs/plans/DEV_AMBIENT_FIELD_SCOPE_AND_DEGRADATION.md` — Now Playing has no field at all, and the degradation ladder has no signal behind it. Same surface, different gap.
- `TASKS.md` `UI-004` — the token half of this.
