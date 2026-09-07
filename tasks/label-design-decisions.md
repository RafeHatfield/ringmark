# Product Label — Design Decisions

Design record for the label sheet redesign. **Not scheduled and not a build plan** — the
current `/markets/[id]/labels` view deliberately reuses `QrCard` unchanged, and stays that
way until this is picked up. What follows is the reasoning, so whoever builds it doesn't
rediscover the constraints the hard way.

Mockups: https://claude.ai/code/artifact/6315091d-d41e-4ad5-9557-fb2ac4c4060a

## What the label is for

A physical label for a finished piece, no larger than a business card, carrying: title, a very
short description, provenance, an optional price, and a QR to the piece's public page. It
replaces today's QR-only card, which is a workshop artefact rather than something you'd put
in front of a buyer.

## The decision: a rim saddle for bowls, a flat card for everything else

A narrow strip folded over the rim of the bowl. The long leg hangs **inside** and carries
everything a buyer reads; the short leg hangs **outside** and carries only the QR.

### Why the reading face is inside — the correction that shaped everything

The first pass put the content on the outside. That was wrong. A bowl on a market table is
looked *into*, not at:

| | presented to a standing eye |
| --- | --- |
| Outer face (hangs vertical) | ~35° — near edge-on, partly behind the bowl's own belly |
| Inner face (rests on the sloped wall) | ~70° — almost square on |

From standing (eye ~1.6 m, table 0.75 m, bowl ~0.5 m out) the sightline arrives at about 55°.
The bowl's wall slopes away from the viewer, which tilts the inner face *back toward the eye*.
The piece presents its own label.

It's also the safer mechanics. The content leg is the heavy one; inside, the tag leans into the
bowl and the short QR leg braces on the outer wall. If it lets go it falls into the piece rather
than on the floor.

### The three hard constraints

**1. Width is fixed at 30 mm — this is geometry, not taste.**
A flat tag across a curved rim touches at one point; the corners lift by
`s = r − √(r² − (w/2)²)`.

| Tag width | Ø90 mm bowl | Ø150 mm | Ø300 mm |
| --- | --- | --- | --- |
| **30 mm** | **2.6 mm** | **1.5 mm** | **0.8 mm** |
| 50 mm | 7.6 mm | 4.3 mm | 2.1 mm |
| 60 mm | 11.5 mm | 6.3 mm | 3.0 mm |

At 30 mm one tag size fits every bowl without visibly perching. Going wider buys layout room
and loses the fit on exactly the small pieces most likely to need a label.

**2. The reading face caps at 34 mm — bowl depth decides it.**
The inside leg must hang clear of the base.

| Piece | Depth | Longest inside leg |
| --- | --- | --- |
| Salad bowl Ø240 | ~100 mm | 94 mm |
| Small bowl Ø90 | ~45 mm | 39 mm |
| Platter Ø300 | ~30 mm | 24 mm — **bottoms out** |

34 mm covers small bowls upward. Shallow platters can't take a saddle at all and use the flat
card instead — no real loss, a platter shows you its face anyway.

**3. The two legs print at 180° to each other.**
Fold a printed strip over a rim and one half inverts. The QR leg is set upside down on the flat
artwork. It looks wrong on the sheet and reads correctly on the bowl. Both faces still print on
**one side of the paper** — the saddle's advantage over a two-sided card, which needs duplex
alignment.

### Consequences for the data

The 34 mm reading face is tight. It holds **title, wood, origin, price — and nothing else.**

- The label pulls from short fields. `public_story` does not fit and should not be attempted;
  the QR is what carries the story.
- **Provenance needs a new public field.** `location_text` is private (never selected in a
  public query, alongside `private_notes`) and typically names a specific tree on someone's
  specific property. The label wants a deliberately coarser line — "Lynn Valley" — which is
  provenance without an address. Reusing the private field for print would quietly undo the
  reason it's private.
- Price is optional and always last; it's the one field that changes between markets and the
  only one whose absence must not break the layout.
- Keep the QR at 20 mm or above. Below that, phone cameras need a second attempt in poor
  light, which at a market is every time.
- The crease is 12 mm of deliberate blank. It sits on the wood, takes the fold, and ink cracks
  along a score.

### What the saddle cannot do

Needs a rim and needs depth. Vases, scoops, hollow forms with small openings, and shallow
platters all fall outside it — so the saddle can never be the only label type. It also *sits*
rather than fastens: pick the bowl up and it comes off in your hand. Fine at a table, useless
for a wrapped piece going out of the door.

## Open, for whoever builds this

- Stock and score: what weight of card takes a 12 mm score without cracking, and does the
  print service score or is it a manual fold?
- Whether the flat card variant is worth keeping in two sizes (85×55 and 85×40) or one.
- Whether the label sheet lets you choose per-piece which variant to print, or picks by
  object type.
