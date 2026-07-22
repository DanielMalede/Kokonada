---
description: Integrator partitions a set of tasks — only parallelize disjoint file footprints.
argument-hint: [list the tasks you want to run in parallel]
---
Use the integrator agent to decide what's safe to parallelize. Tasks I want to fan out: $ARGUMENTS. ultrathink.
For each task, compute its file/module FOOTPRINT (files it will touch, including transitive blast radius — use Graphify GRAPH_REPORT.md if present, else madge/dependency-cruiser/grep). Then output a safe-to-parallelize partition: which tasks can run together (disjoint footprints, each in its own worktree/branch) and which MUST run sequentially (overlapping footprints — name the shared files). Reject any parallelization of overlapping-footprint tasks. Remind me: conflict-freedom only holds if all parallel work is routed through this partition, one worktree/branch each, and no two sessions touch the same package. Do not start any work — just give me the partition + dispatch order.
