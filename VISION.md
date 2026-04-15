# Onlook Next — Vision

## One-sentence version

Onlook Next is a local-first, visually-driven editor for any frontend or fullstack project on your own machine — desktop today, tablets later — built so that clicking, dragging, and tweaking in a live preview writes back to real source files through a framework-neutral IR.

## Who it's for, honestly

**v1 audience: the owner of this repo, editing the owner's own projects.**

This is stated bluntly on purpose. The first version is a personal tool. It does not have users, a landing page, billing, onboarding, presence avatars, empty states, analytics, SOC2, or a support email. Every decision in the v1 design proposals defers anything that only matters when strangers touch the product. "Would a stranger understand this error?" is not a v1 gate. "Does it unblock me on my own project today?" is.

This is a feature, not a compromise. It lets us ship the editing experience correctly before we decide whether to make it a product, and it frees us from the silent tax of building for imagined users.

**Later audiences, in order of when they earn attention**:
1. **The owner on an iPad**, attaching to their own desktop workspace over LAN. (Couch-coding, review, light tweaks.)
2. **A small circle of friends** the owner wants to share the tool with, still local/LAN.
3. **External users**, only if the tool is so clearly better than the alternatives that not shipping it would be negligent. This audience is not on the roadmap.

## What we're building, precisely

A **visual editor that understands the source code of real frontend and fullstack projects** — not a Figma clone, not a no-code builder, not a WYSIWYG wrapper around a frozen template library. The editor opens your actual codebase, runs your actual dev server, and lets you nudge real components in a real preview while writing changes back to real `.svelte`, `.tsx`, or `.vue` files on disk.

The unlock is the combination of three things:

1. **A framework-neutral IR** (`EditorDocument`) that can parse and regenerate multiple frameworks. Today: Svelte (complete) and React (baseline). Next: Vue. This lives in `packages/framework-engine`.
2. **Live preview attached to your project's real dev server**, not a bundled sandbox. Whatever Vite or Next.js or SvelteKit does for your project, the editor sees. If Convex is in the loop, it's in the loop here too.
3. **Visual interactions that write real code**, not a parallel scene graph that needs syncing. When you drag a card, the editor understands flex vs grid vs absolute, picks the right property to mutate, and writes the source change through the IR. HMR does the rest.

That combination is what separates this from every "visual editor" that starts looking like a toy the moment you point it at a real production codebase.

## The trajectory

### v1 — Desktop, for me, against my own project

**Proposal: `add-desktop-shell`** ([openspec/changes/add-desktop-shell](openspec/changes/add-desktop-shell/))

- Ship a Tauri 2 `.app` on macOS that hosts the existing `apps/editor` SPA in its main WebView.
- Let me open `~/Desktop/portfolio-forever` and edit it visually against a real `bun run dev`.
- Use the existing `framework-engine` via a Bun sidecar so I don't pay the cost of a Rust rewrite before I've proven the idea.
- Zero cloud, zero auth, zero mobile, zero scripting. One WebView for the editor, one child WebView for the preview, one Rust process supervising the dev server.

Success = I replace my current "open VS Code + browser + DevTools" flow with one app I launch, for at least one of my own projects.

### v2 — iPad attach, still for me, still LAN only

**Future proposal: `add-ipad-attach`**

- Tauri 2 mobile build (iPad, possibly Android tablets) running the same SPA.
- Desktop app exposes a LAN WebSocket server with mDNS discovery when the "Allow iPad" toggle is on.
- iPad connects to the desktop's workspace and renders a touch-adapted version of the editor: select, nudge, change text, change classes. No new-component creation on tablet.
- Preview on iPad loads the tunneled dev-server URL from the desktop.

Why this is v2 and not v1: iOS cannot spawn subprocesses, so the iPad build is architecturally *incapable* of running a dev server itself. Building the workspace abstraction is the whole job, and we should not try to build it alongside v1. The moment v1 works, we have a known-good local path to test the workspace protocol against; that's a much better foundation than designing the protocol in a vacuum.

### v3 — Scripting and transforms

**Future proposal: `add-scripting-surface`**

- A first-class TypeScript plugin API built on top of `framework-engine`'s IR, runnable in the same Bun sidecar that already exists.
- Plugins as code transforms: "convert all `<button>` to `<Button>` and swap class names," "extract this selection into a new component," "generate a Storybook story for every component in this directory."
- Optional Lua one-liner REPL for quick in-session transforms if the TypeScript ergonomics feel too heavy. No Ruby — splits the ecosystem for no gain.

Why this is v3 and not earlier: until you've used the visual editor long enough to hit the wall of "I want to do this same thing 50 times," you don't actually know what the plugin API should look like. Shipping it earlier produces the wrong shape.

### v4 — Maybe others use it

**Only if the tool is clearly better than the alternatives.** At that point the questions become real: auth, billing, deployment, cloud workspaces (if anyone wants to edit projects that aren't on their own laptop), pricing, support, SOC2. None of those are today's problems, and this document will not pretend to pre-answer them.

## What we are deliberately not building

- **A no-code builder.** The source of truth is the user's code. The editor is a different way to *write* code, not a replacement for it. If the user deletes Onlook, their project still runs — that's the invariant.
- **A Figma clone.** Figma owns design. Onlook owns the translation between design intent and shipping code.
- **An Electron app.** Explicit aesthetic and performance objection.
- **A cloud-first SaaS.** Local-first is the starting point. Cloud is a future *option*, not a default.
- **A plugin marketplace.** Until there are users, there's no market.
- **A full SwiftUI rewrite of the editor.** The React SPA is the moat. Swift/Catalyst is tempting for native polish but throws away months of UI work. If we ever build a Swift version, it's alongside the web version, not replacing it.

## Product values

1. **Source of truth is the code.** Every visual action resolves to a source file edit via the IR. The editor never owns state that the filesystem doesn't.
2. **Compatibility scales with the ecosystem for free.** We supervise the user's dev server instead of owning a bundler. If Vite adds a feature, we get it for free. If a framework stops running, it stops running here too — honest, not hidden.
3. **Honesty over magic.** If port detection fails, we show the raw dev-server output. If an emit errors, we surface it. No silent fallbacks, no retries-in-a-loop that hide problems, no empty states that pretend nothing is wrong.
4. **Personal tool quality first, product polish later.** A staff engineer using this for themselves should feel it's solid. A stranger seeing it for the first time might find it sharp-edged — that's acceptable until v4.
5. **No premature abstraction.** We do not invent a workspace broker until we need it (v2). We do not invent a plugin host until we need it (v3). We do not invent cloud (maybe never). Every abstraction has to justify itself against a real v-number.
6. **Ship the small thing.** v1 is "open my project, click a button, nudge a div, see the file change." Not "the definitive frontend editor." The next moves are always easier after the small thing works.

## The one test that matters for v1

Launch `Onlook.app`. Open `~/Desktop/portfolio-forever`. See the SvelteKit dev server's preview. Click a heading. Change its text in the inspector. Watch the file on disk update and HMR reload the preview. Close the app. Run `ps` and confirm nothing leaked.

Everything in [`openspec/changes/add-desktop-shell/`](openspec/changes/add-desktop-shell/) exists to make that sequence work on my machine, against my project, this month.
