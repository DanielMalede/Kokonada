# Kokonada Project Explorer — Control Room Design

> Approved by Daniel on 2026-10-05 after visual exploration. The selected direction is a
> Control Room dashboard with an optional Learning Mode. This document defines an internal,
> repository-owned onboarding surface for understanding the POC, current project state,
> architecture, and professional contribution workflow.

## 1. Purpose

The Project Explorer gives a developer entering Kokonada one visual place to answer four
questions:

1. What does Kokonada do?
2. Where does the project stand now?
3. How does the technical system fit together?
4. How should a new contributor start working safely?

The immediate audience is Daniel. The page is an internal learning and project-orientation tool,
not a customer acquisition page.

## 2. Product boundary

This surface is deliberately separate from the future public landing/privacy/store-support site.

- It lives in the private Kokonada repository.
- It may contain internal engineering status, test baselines, open risks, and deployment guidance.
- It is not deployed publicly in this phase.
- It does not replace public privacy URLs, store listings, legal disclosures, or marketing copy.
- It must never expose secrets, credentials, production user data, or private operational URLs.

The implementation is a dependency-free static site that can be opened locally. It does not call
the production backend and does not mutate any project or account state.

## 3. Chosen experience

### 3.1 Control Room

The primary composition is a dark, technical dashboard rather than a long marketing page. It uses:

- a persistent project header with snapshot metadata;
- a section navigator;
- concise status cards;
- a product flow diagram;
- a system architecture map;
- deployment and risk callouts;
- a contributor workflow;
- short links from summary cards into deeper sections.

The dashboard must remain approachable: important information is grouped by the question it
answers, not by repository folder or team ownership.

### 3.2 Learning Mode

Learning Mode is enabled on the first visit and can be switched off at any time. It adds a guided
five-step path:

1. Understand the idea.
2. See the user journey.
3. Open the technical engine.
4. Understand current status and risk.
5. Start working with the repository.

When enabled, each section includes:

- a visible step number;
- a one-sentence explanation of why the section matters;
- a small “what to understand here” callout;
- a next-step action;
- contextual definitions for unfamiliar terms.

When disabled, the same content remains available in a denser dashboard layout. The preference is
stored only in local browser storage. The page remains fully usable if JavaScript or local storage
is unavailable.

## 4. Information architecture

### 4.1 Overview

The first viewport communicates the POC in one sentence and one flow:

`Mind input + Body signals -> State interpretation -> Music targets -> Spotify playback`

Supporting copy explains that Kokonada combines explicit emotional/activity input with available
physiological signals, interprets the current state, and translates it into music-selection goals.
It must not claim medical diagnosis or treatment. Kokonada is presented as a wellness experience,
not a medical device.

### 4.2 User journey

Show the user-facing sequence:

1. Express an emotion, activity, or intent.
2. Connect or provide available body signals.
3. Receive a state interpretation.
4. Generate and play a matching set through Spotify.
5. Control consent, privacy, history, and learning.

The page must distinguish shipped behavior, planned behavior, and constrained integrations. YouTube
must not appear as an active playback path. Spotify limitations and tester constraints must be
described honestly rather than hidden.

### 4.3 Technical system

Present the architecture as a readable layered map:

- **Client:** React Native mobile application and device/health integration boundaries.
- **API:** Node.js backend, authentication, consent, session, recommendation, and playback
  orchestration endpoints.
- **Runtime processing:** the runtime agents and state/selection pipeline, clearly distinguished
  from development assistants.
- **Data and jobs:** MongoDB Atlas, Redis, and BullMQ.
- **External services:** Spotify and other explicitly active providers only.
- **Hosting:** Railway for the backend, labelled as the current deployment surface where verified.

The map includes a second “data journey” view showing where input enters, where derived state is
created, where work queues participate, and where privacy/erasure controls apply.

### 4.4 Current project state

Status is a dated snapshot, never presented as live telemetry. Every status panel shows:

- snapshot date and time zone;
- source commit SHA;
- whether evidence was verified locally, read from CI, or remains unverified;
- a visible stale-data warning when the snapshot no longer matches the checked-out commit.

The initial snapshot records the 2026-10-05 review:

- `main` at `55d68cc` is the safe baseline considered for the next deployment;
- backend verification passed 285 suites and 4,658 tests, with 3 suites and 38 tests skipped and
  1 todo;
- mobile verification passed 200 suites and 2,689 tests, with 1 skipped test, plus an open-handle
  warning;
- backend lint has 0 errors and 21 warnings;
- mobile lint has 72 errors and 75 warnings;
- production dependency audits reported 6 backend findings and 53 mobile findings, with no
  critical findings in either set;
- PR #217 is marked **HOLD / do not merge or deploy** until its privacy, queue, scheduling,
  real-Redis, production-snapshot, and external deployment gates are resolved and re-reviewed.

Counts are evidence, not a blanket “healthy” claim. Skipped tests, warnings, audit findings, and
unverified production configuration remain visible.

### 4.5 Deployment decision panel

The page contains one explicit decision card for the planned morning deployment:

- recommended baseline: current `main` at the recorded snapshot;
- excluded change: PR #217 in its reviewed state;
- rule: re-check remote `main`, CI, configuration, and production state immediately before deploy;
- rule: a newer commit or resolved PR requires a fresh review and refreshed snapshot.

This is guidance from the dated review, not an automated deployment authorization. The Explorer
does not deploy anything.

### 4.6 Professional contribution workflow

Show the expected path:

`clean main -> scoped task -> isolated worktree/branch -> tests first -> implementation -> local
verification -> pull request -> independent review/compliance -> green CI -> explicit merge ->
deployment -> production verification`

The onboarding section explains:

- where the authoritative vision, screen catalog, architecture, and orchestration documents live;
- how to create and work inside a dedicated Git worktree;
- how to stage only task-owned paths;
- how to avoid touching another contributor's uncommitted work;
- that merges and deployments require explicit owner approval;
- that provider, store, health, privacy, or legal changes require the appropriate review gates.

Commands shown in the final page must be copied from the repository's current scripts and verified
in the implementation worktree. The page must not invent setup commands.

### 4.7 Glossary

Provide short definitions for at least:

- POC;
- frontend/mobile client;
- backend/API;
- runtime agent;
- MongoDB;
- Redis;
- BullMQ;
- PR;
- CI;
- worktree;
- deploy;
- production verification.

Definitions are contextual and plain-language. A reader should not need prior knowledge of the
repository to understand them.

## 5. Visual system

The approved direction is a calm technical control room:

- near-black/navy foundation rather than pure black;
- teal for guidance, active state, and verified-positive information;
- amber for warnings and incomplete work;
- restrained red only for blocked or unsafe actions;
- compact cards with generous internal spacing;
- strong typographic hierarchy and minimal decoration;
- diagrams built with HTML/CSS, not decorative stock imagery.

The interface is Hebrew-first and naturally RTL. Technical flows that read left-to-right may use an
explicit LTR sub-region. English terms remain secondary labels, not the main navigation language.

The design must meet WCAG 2.2 AA contrast, expose visible focus states, support keyboard navigation,
respect reduced motion, and remain understandable without relying on color alone.

## 6. Responsive behavior

- **Desktop:** fixed-width side navigation and a multi-column dashboard.
- **Tablet:** collapsible navigation and two-column cards.
- **Mobile:** single-column reading order; the learning path becomes a compact progress header;
  technical diagrams become horizontally scrollable only where reflow would destroy meaning.

No critical content is hover-only. Glossary explanations are available through focus/tap and in a
full glossary section.

## 7. Implementation shape

The intended implementation lives under a dedicated `project-explorer/` directory and uses:

- `index.html` for semantic structure;
- `styles.css` for the visual system and responsive rules;
- `app.js` for navigation, Learning Mode, progressive disclosure, and stale-snapshot checks;
- a small structured status/content file so dated facts can be updated without rewriting layout;
- repository-native tests for content contracts and key behavior, with no new runtime dependency.

The page should work from a lightweight local static server. Where practical, core content also
remains readable when `index.html` is opened directly.

## 8. Error and degradation behavior

- If JavaScript fails, all sections remain in the document and are readable.
- If local storage is unavailable, Learning Mode defaults on for the current visit.
- If snapshot metadata is absent, the status area shows “status unavailable” rather than guessed
  health.
- If the checked-out commit differs from the snapshot SHA, the page visibly labels the snapshot as
  potentially stale.
- External links open safely and are never required to understand the core page.

## 9. Verification and acceptance

The implementation is complete only when:

- all five guided steps are present and navigable by keyboard;
- Learning Mode can be enabled/disabled and degrades safely;
- the POC, user journey, architecture, current status, deployment guidance, workflow, and glossary
  are all represented;
- the dated evidence and PR #217 hold are stated exactly and do not imply live monitoring;
- the page is usable at desktop and mobile widths;
- contrast, focus, reduced-motion, and color-independent status checks pass;
- no secrets, user data, private production URLs, or credentials are present;
- no production/backend request is made;
- repository tests, lint relevant to the new surface, and `git diff --check` pass;
- a visual review confirms the approved Control Room direction with Learning Mode;
- the worktree is opened in VS Code for Daniel after implementation.

## 10. Explicit non-goals

- Public deployment or GitHub Pages publication.
- Replacing the future public landing/privacy/support website.
- Real-time CI, GitHub, Railway, MongoDB, Redis, or production monitoring.
- Editing backend, mobile, privacy, or deployment behavior.
- Merging or deploying PR #217.
- Automated deployment actions of any kind.
- Medical claims, diagnosis, treatment guidance, or regulator-style scoring.

## 11. Approval record

Daniel selected the **Control Room** direction, requested **more guidance**, and approved the revised
structure with an optional first-visit Learning Mode on 2026-10-05.
