---
description: Answer structural/dependency questions from the Graphify codebase knowledge graph.
argument-hint: [structural question — e.g. "what depends on biometricHandler"]
---
Use the Graphify codebase knowledge graph to answer: $ARGUMENTS. ultrathink.
First read GRAPH_REPORT.md (Graphify's generated graph report) and any .graphify/ artifacts if present. Answer from the graph — imports, call edges, dependencies, blast radius, god-nodes — rather than blind file searching. If GRAPH_REPORT.md doesn't exist yet, tell me Graphify hasn't been run and give me the exact `graphify` command to generate it for this repo.
