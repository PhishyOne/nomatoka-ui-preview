# Nomatoka interactive UI-only test — October 26 controls update

This GitHub Pages UI build is derived from canonical game Draft PR #697
at exact commit ff5890f66dd43a1d0df570f516e8db290ecb6787.
The frontend JavaScript and CSS are byte-identical to that game tree.
This nested static page uses synthetic mock-api.js as its only API layer.
It blocks Send, Sign out and outside API calls; there is no game database,
real account, multiplayer, or persistent gameplay in this preview.

Includes: icon-only Send, equal-height Ortega/Reports tabs, a small X to
close Orders instead of a Back-to-map banner, a restrained panel icon for
opening Orders instead of the caret, one active bottom destination, contextual
drawer content for Map/People/Items/Places, touch VIA options, nonmodal
workspace sheets, local synthetic X/Y map selection by one tap, and disabled
map text selection on long touch. Coordinate Add-to-draft is only planning
text, not an executable route or verified waypoint.

Real Android keyboard and touch feel still require owner's device testing.
Production game and the current public site are not affected by this Draft
until separately qualified and released.

The Orders drawer is bounded by actual navigation rather than the expanded Orders page; the real Send target remains hittable. Selected local X/Y coordinates keep their original label through automatic received-picture polls. Explicit authority rechecks still scrub local planning state.


October 27 focused review repair: with keyboard-constrained expanded Orders, the unavailable microphone no longer occupies the VIA+Send column; both remain inside the real form at short visual heights. The existing Items heading is programmatically focusable so contextual Items navigation lands on actual visible content. These are UI-only changes and do not add any executable order, account or network behavior.


October 27 coordinate quick-action consolidation: Add failures (locked or 280-character overflow) are visible in the live anchored popup. A successful coordinate text insertion restores a minimized real composer and leaves a visible Added result; coordinate text is local planning only, not a validated waypoint. No real order send, persistence or source-knowledge change.

October 27 contextual drawer reconciliation: when a People, Items or Places
sheet closes by Escape, its close button, or native dialog close, its Tools
drawer closes as well. The next deliberate Tools opening follows the current
workspace, never a hidden sheet. This changes no mock API or Send behavior.

Extreme Android IME geometry: the constrained expanded Orders workspace retains
a real scroll range and a 73px minimum VIA+Send form while the fixed navigation
and document remain stationary. This uses the same native VIA and Send controls;
it does not enable real requests or change the mock API.

October 27 mobile owner playtest: expanded Orders now anchors the existing
single real composer immediately above bottom navigation and removes the
redundant text below it. The source-backed readback remains available above.
The synthetic map now supports a bounded one-finger drag to pan after zoom,
without changing the authored map coordinates, real order authority, pinch
zoom, tap selection, or the truthful distance ruler. This preview still uses
only the synthetic no-write mock API and blocks Send.

Independent review P2 repair: pan camera now clamps using the full rendered
rectangular SVG viewport under xMidYMid meet, not only the square viewBox.
When the viewport is wider than the authored 10 km range on either axis,
that axis stays centered instead of revealing extra unauthored geography.
Scale and genuine tap/zoom behavior remain unchanged.

Mobile contextual menu integration, owner-requested: an explicit map feature
selection drives the first People, Items or Places peek from the admitted
public operations picture. No selection means a general half-height peek.
Second tap on the same tab expands its existing full list; third tap restores
the contextual/general peek. Repeated taps alternate. The non-modal sheet
leaves the map above, the command dock and nav below; private content clears
on authority turnover. Ortega is a truthful area-contact label, not a live GPS
coordinate. Items without received ownership evidence remain unknown.

October 27 independent P2 corrections: Tools -> View known locations
expands a contextual Places peek before focusing the actual location list.
Place-specific People peeks now use admitted contact.area and contact.state:
Ortega recorded present at Staging Area or last-known at Ridge is qualified
precisely without claiming exact position or inventing other people.

October 27 keyboard/touch review P2: Ortega area-contact badge now renders
its keyboard focus ring on a separate visible backdrop, preserves a
finger-sized invisible hit target, and no longer intercepts Staging Area or
Ridge marker taps. Exact reported contact qualification is unchanged.

October 27 disabled contact P2: use the existing range-feature enabled/
disabled pointer-event rules for the Ortega badge, with keyboard focus and
44px touch hit retained on normal phone geometry. A short/zoom-clipped
disabled badge cannot consume map taps or create a dead region.

October 28 Lower path overlap P2: the invisible contact hit target uses
an authored shape that preserves 44px mobile touch coverage while avoiding
the existing Lower-route line below the badge. Area/contact evidence,
keyboard focus, disabled-state and mock no-write behavior are unchanged.


October 28 original-map gesture integration: preserve the present source-backed
map, contextual peeks and single authenticated order composer. Replace the
large Ortega label card with a compact person marker (ring/diamond) and
adjacent area-qualified text; authored place dots and routes retain their
existing geometry. Adapt the preserved root prototype's hold-to-draft
movement gestures into local numbered route waypoints, last-waypoint
extension, selected-point red-X deletion and a clear/use-text control.
Holding empty map ground and dragging selects source-admitted displayed
people by a rectangular marquee, with Shift+Enter keyboard selection.
The current admitted game picture shows only Ortega, not fictitious squad
members. The drawn route starts at a reported AREA reference, never an
asserted exact person coordinate. Text-copy requires a separate explicit
action; no structured waypoint command, implicit Send, durable route
persistence, server mutation or group-order capability is claimed.
Auth-control changes scrub local routes/selections. Existing pinch, pan,
map sources, command authority, privacy and fixed dock are retained.

October 28 final bounded reviewer repairs: route actions recalculate their
HUD position during geometry changes, keeping Use text / Clear in the map
after rotation or keyboard resize; explicit route text copying also restores
the existing minimized command composer and focuses its REAL textarea.
The waypoint red-X after extension is covered by full Chromium regression.
No server command is submitted by any gesture or text-copy action.
