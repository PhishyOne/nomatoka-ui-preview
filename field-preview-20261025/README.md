# Nomatoka — October 25 isolated UI demo

**Synthetic UI only.** Generated from exact canonical game Draft PR #697
head `3ec2fb36fe71a6ff694f820391f2f7ca67579589`, retaining the actual
play DOM, CSS, JS, map evidence and touch handlers.

An interception shim serves only bounded synthetic HTTP fixture responses and
blocks all order submissions. It cannot access production accounts, private
information or live game state. It is not shared-world play, server persistence,
physical Android acceptance or a qualified deployment. The test host is
GitHub Pages in the separate `nomatoka-ui-preview` repository.


October 26 shell update: People, Items and Places are non-modal scrolling workspace sheets; the live draft composer and nav stay accessible. The top-right control opens synthetic map-layer display tools, not People. Touch VIA options open in-place while preserving the one real native delivery selector for keyboard and form identity. The prominent manual report refresh moves behind Connection recovery; automatic report polling remains. These are UI-only behaviors, not confirmed persistence/multiplayer.
