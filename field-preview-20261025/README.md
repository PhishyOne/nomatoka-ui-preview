# Nomatoka interactive UI-only test — October 26 controls update

This GitHub Pages UI build is derived from canonical game Draft PR #697
at exact commit 4d9b7c6b71885cb0ffa6165970f6c8d36fd68746.
The frontend HTML/CSS/JS are copied from that game tree. The existing
synthetic mock-api.js remains the only API layer.
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
