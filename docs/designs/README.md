# Visualization drafts for the next milestone

These three SVGs are **design drafts**, not finished charts. `scripts/make_design_drafts.mjs` draws them
from the cleaned files in `static/data/`, so every number in them is real (`npm run designs`
regenerates them). PNG renders are in `docs/screenshots/*-draft.png`. The website shows them in
"Explore further", labeled as drafts.

All three reuse the shared state the prototype already has: the brushed tuition range, the in-state or
out-of-state toggle, the searched college and the selected major.

---

## 1. Dollar bill: `dollar-bill-draft.svg`

**Question.** Of the published yearly cost, how much is tuition and how much is room and board, books and
other expenses? How does that change for the schools in my selected tuition range?

**Data.** `schools.csv`: `tuition_in`/`tuition_out`, `roomboard`, `books`, `other` (on-campus published
components, mean of AY2017-18…2021-22, nominal $). Only schools reporting all four items are used:
1,563 of 1,876. Each school counts once. Off-campus housing variables would need to be added for
commuter students.

**Encodings.** Bill length = total published yearly cost, on **one dollar scale shared by every bill**, so a
longer bill always means a higher cost. Segment length = each cost item. Segment hue = cost item (four
validated categorical slots chosen so they do not reuse the public/private/for-profit hues). Direct
dollar labels sit on large segments; small segments are labeled beneath.

**Interactions and links.** Brushing the histogram rebuilds the lower "selection" bill under the fixed
all-schools bill. The in-state/out-of-state toggle swaps the tuition segment. Searching a college adds a
third bill for that school. Hovering a segment shows its amount and the number of schools averaged. Planned:
a one-tick-per-school strip under the bill showing the spread of total cost.

**Place in the story.** It belongs in "What does college cost?", after the histogram. It shows that tuition
leaves out a large share of the published cost (Owen's individual-exploration insight), before the story
turns to earnings. The page must also say that these are published prices, not net price after grants.

---

## 2. Brain of majors: `brain-draft.svg` (proposed novel view)

**Question.** What do students at the selected schools study, and how much do those fields pay one year
out?

**Data.** `programs.csv` + `majors.csv`, rolled up to 2-digit CIP families. Area uses degrees
(`IPEDSCOUNT1 + 2`, weighted by degrees). Color uses the median of program medians in the family (each
program counts once). The 12 largest families get their own region and the rest become "Other (29 fields)".

**Encodings.** Region **area** = share of bachelor's degrees. A weighted Voronoi treemap
(`d3-voronoi-treemap`) clipped to a convex brain outline makes area proportional to share. Region
**color** = median program earnings on a one-hue sequential blue scale ($30K→$80K, quantized into 7 steps)
with gray for "not reported". Every region is labeled with its name and %. The legend explains both
channels.

**Interactions and links.** Hovering a region shows degrees, share, and the middle 50% of program
earnings. Clicking a region selects that field in the earnings-by-major chart. Brushing the histogram
recomputes areas for the selected schools while the outline, the region seeds and the color scale stay
fixed, so changes are comparable. A toggle switches between all schools, the selected range, and the
searched college.

**Design rationale.** The brain metaphor ("what's on students' minds") makes the major mix memorable and
gives the page a distinctive centerpiece. It is the one view that puts **popularity (area) and pay
(color) in the same mark**, which is exactly the popularity-versus-earnings question.

**Known difficulty.** People compare irregular polygon areas poorly. They are much less accurate than with
aligned bar lengths, and the Voronoi layout changes shape when shares change. Mitigations: print the %
in every region, keep region positions stable across filters (seeded layout), show a sorted bar list
beside the brain for exact comparison, and make the earnings chart (not the brain) carry precise
earnings comparisons. (The process book's Dashboard 2 evaluation already noted that "the brain's
irregular regions make exact size comparisons harder than a bar chart.") A "change from all schools"
annotation (e.g. "+5 pts") is proposed for the filtered state.

**Place in the story.** A rising-insight beat between cost and earnings: popularity is not pay. Business is
the largest region but not the darkest, while engineering and computer science are smaller and darker.

---

## 3. Flow diagram: `flow-draft.svg`

**Question.** Where do graduates of differently priced schools end up, in terms of field and early earnings?

**Data.** `programs.csv` joined to `schools.csv`. Left column: school quartiles by published in-state
tuition (each school counts once; edges $9.7K / $18.4K / $33.7K). Middle: the 8 largest fields plus
"Other". Right: degree-weighted quartiles of program median earnings plus "Earnings not reported". Link
width = bachelor's degrees.

**Encodings.** Position = stage. Link width = degrees. Gray = all schools. Ink = the highlighted tuition
group (the draft shows the highest quartile, which is what a brush would highlight). No hue per field,
which keeps the categorical palette free and avoids a nine-hue diagram.

**Interactions and links.** Brushing the histogram highlights flows from schools in the range while all
flows stay visible in gray. Hovering a link shows degrees and share. Clicking a field selects it in the
earnings chart and the brain.

**Place in the story.** The "paying more does not guarantee more" beat. Every tuition group sends degrees
into every earnings band. Its caption must say that the flows are descriptive, not causal.

---

## Shared design notes

- Colors: public/nonprofit/for-profit hues are reserved for school type and are never reused for another
  meaning. The bill uses four other validated slots. The brain uses a single-hue sequential ramp. The flow
  diagram uses ink and gray.
- Each draft states what it weights by (schools, degrees, or programs).
- Open questions for the team: should the brain use 4-digit majors at the school level (as in the earlier
  Harvard sketch) or 2-digit families nationally? Should the bill use on-campus or off-campus costs?
