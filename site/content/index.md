---
layout: home

hero:
  name: Realm
  text: The home of AI Generated Code
  tagline: Agent sandbox for the GSD-Core USSR Stack
  image:
    src: /assets/brand/logo.svg
    alt: Realm logo
  actions:
    - theme: brand
      text: Read the overview
      link: /overview
    - theme: alt
      text: Repository
      link: https://github.com/swcstudiospace/realm

features:
  - title: Sandboxed execution
    details: Agent execution and file mutations run inside a sandbox. Under the fail-closed policy, every file mutation either lands inside the realm or fails closed. The default advisory mode warns and allows host write and edit calls while disconnected, so containment requires opting into fail-closed.
  - title: Omp, CLI, MCP and ACP
    details: An Omp plugin, a standalone CLI with a long-running local daemon, and MCP and ACP surfaces let other agent hosts use the same sandbox.
  - title: Verification-first docs
    details: Every page is generated from the repository's own markdown, including the docs and planning trees.
  - title: AGPL-3.0-only
    details: Licensed under the GNU Affero General Public License v3.0 only. Copyright (C) 2026 Spectrum Web Co/swcstudiospace.
---
