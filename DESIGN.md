# Apion design direction

Authored by the product owner on 2026-09-13. `antislop.md` filters against this;
it does not replace it. Where this file and a filter rule collide, the collision
is raised, not silently resolved either way.

## Identity

Apion is a **precise instrument**. Dense, quiet, information-first. Confidence
comes from restraint and exactness, not from decoration. Nothing on screen
competes with the contract itself. It reads like a professional tool someone
keeps open all day, not like a product being sold to them.

The people in it are backend, frontend and mobile engineers, tech leads, QA, and
PM/BA stakeholders. It is used for hours, not minutes. Density is a feature.

## Dials

`Dial: ENERGY 1 / RHYTHM 2 / MOTION 1`

- **ENERGY 1**: the tool says hello quietly. A working instrument, not a landing page.
- **RHYTHM 2**: consistent structure with deliberate breaks where a view's job
  genuinely differs: the contract tree, the endpoint editor and the health panel
  are not the same shape, because they are not the same task.
- **MOTION 1**: hover, focus and state transitions only. Nothing animates for
  its own sake. Motion that does exist confirms a state change the user caused.

## Palette

Cool slate surfaces, high-contrast text, **amber as the only accent**. Amber
carries attention and unsaved state, and nothing else. Everything not amber is
slate or a semantic status colour.

Three core colours plus one accent, per R-29. Neutrals do not count toward that.

Two semantic sets sit outside the accent, because both encode meaning the user
must read at a glance and neither may borrow the accent's weight:

- **HTTP method**: GET, POST, PUT, PATCH, DELETE must be distinguishable
  without reading the label.
- **Implementation status**: the seven states of FR-3.1, where the
  implemented/not-implemented boundary is the one that carries the most weight.

Every foreground/background pair ships verified at WCAG 2.2 AA: 4.5:1 for normal
text, 3:1 for large text and for non-text UI boundaries. Status and method are
never signalled by colour alone.

## Typography

**One humanist sans, one mono.**

- Humanist sans for all UI and prose. Readable at small sizes and over long
  sessions, which a grotesque is not.
- Mono strictly where the content is literal: paths, identifiers, JSON Schema,
  examples, headers.

The sans/mono split is itself the signal. Mono means "this is the contract";
sans means "this is commentary about the contract". That distinction is load
bearing, so mono never appears as decoration.

## Theme

**Dark default, with a fully working light mode.** Engineers are the heaviest
users and the reason is theirs, not aesthetics. Light mode is not an
afterthought: both modes are verified, and shipping a broken one is a defect.

The choice persists per person and follows the OS on first visit.

## Identity motif

**The method-and-path line.** `GET /orders/{orderId}` rendered as a single
typographic unit, with the method set in its semantic colour and the path in
mono, path parameters visually distinct from literal segments. It is the one
element repeated everywhere: tree rows, editor headers, search results, diffs,
status history, activity feed. Recognising an endpoint at a glance anywhere in
the product is the whole point of the motif.

## What this rules out

- Gradients, glow, glassmorphism, background grids and blob decoration. ENERGY 1
  leaves no room for them, and none serves a hierarchy the layout cannot.
- Card grids as a default container. Contract data is a tree and a table, not
  a set of marketing cards.
- Any second accent. If something needs attention and is not amber, the layout
  is wrong, not the palette.
