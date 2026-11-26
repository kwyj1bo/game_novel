# Evaluation: retrieval and the story director

All numbers come from one book, *Harry Potter and the Philosopher's Stone*, because it is the book with hand-made assets to compare against. The model is Claude, reached through Claude Code. Raw scores are in [`retrieval.json`](retrieval.json) and [`director.json`](director.json).

```bash
python -m pipeline.rag.evaluate --book <library folder> --runs 2
python -m pipeline.director.evaluate --book <library folder>
```

## How the model is kept from answering from memory

The model has read this book. Asked what "Harry" looks like, it says glasses and a scar, whatever text it gets. So the evaluation:

1. Replaces every character and world name in the text with an invented one ("Harry Potter" becomes "Kined Punath", "Hogwarts" another invented word).
2. Sends characters under opaque ids (`p1`, `p2`), not the manifest ids. A first run sent `dumbledore` next to the invented name, and the model still scored 86% with no book text at all.
3. Hides the book's hand-made cast and named sceneries from the pipeline, so only generic places remain.
4. Includes a `none` mode, with no book text, as the floor.

## Character looks

49 characters that appear at least 5 times, 2 runs per mode. Most characters have no glasses, beard, hat or scar, so a model that always answers "none" gets most fields right. The score is therefore the mean of four parts that a default answer cannot win:

| Mode | Score | Hair colour (5 colours) | Distinctive features (F1) | Height (child, adult, giant) | Outfit (student, adult) |
| --- | ---: | ---: | ---: | ---: | ---: |
| none (no text) | 54.7% | 49.0% | 27.9% | 54.1% | 87.8% |
| keyword (old rule) | 69.7% | 63.3% | 49.2% | 72.4% | 93.9% |
| hybrid | 74.1% | 67.3% | 46.4% | 86.7% | 95.9% |
| **tree** | **79.9%** | **70.4%** | **65.5%** | **87.8%** | **95.9%** |

The 49 characters have 16 distinctive features (6 pairs of glasses, 4 beards, 5 hats, 1 scar). Per run:

| Mode | Found | Invented | Missed |
| --- | --- | --- | --- |
| none | 6, 6 | 20, 22 | 10, 10 |
| keyword | 9, 8 | 10, 10 | 7, 8 |
| hybrid | 8, 8 | 10, 11 | 8, 8 |
| tree | 10, 13 | 8, 7 | 6, 3 |

Run-to-run spread: none 54.1 to 55.3, keyword 66.4 to 73.1, hybrid 73.7 to 74.5, tree 78.0 to 81.8.

The tree is the default for looks. A character is usually described where they are introduced, and the table of contents lets the model find that scene even when the description never uses the name. Hybrid search helps most with height and age (86.7% against 72.4%), because it reaches sentences such as "a boy of eleven" that the keyword rule skips.

## Places

30 scenes that the full manifest places in one of the book's hand-made sceneries, spread over the book; 2 runs per mode. The model designs a place for each with the sceneries hidden. Its type is compared with the hand-made scenery's type (one of 20, such as room, hall, cellar, forest).

| Mode | Type | Time of day |
| --- | ---: | ---: |
| none (chapter title only) | 16.7% | 65.0% |
| **keyword** (first lines of the scene) | **36.7%** | 73.3% |
| hybrid | 35.0% | 75.0% |
| tree | 25.0% | 76.7% |

The keyword rule and hybrid search are level (one scene apart). The tree is worse: it often opens other scenes, which describe other places. Hybrid stays the default for places, because it also picks the five most similar library places for reuse. The type labels are strict: the hand-made zoo is a `hall` and the train compartment a `room`, so a sensible `shop` or `deck` counts as wrong.

## Plot beats

The two hand-made chapters show what a person kept when adapting the book. Each of their lines is matched to the book paragraph it adapts (11 paragraphs for the troll, 28 for the trapdoor). A method scores the share of those paragraphs its 14 events keep, within one paragraph. Names are invented here too.

| Chapter (paragraphs) | Rules | Director |
| --- | ---: | ---: |
| Halloween (157) | 45.5% | 45.5% |
| Through the Trapdoor (299) | 10.7% | 3.6% |

The director did not beat the rules. On the trapdoor chapter it spent its events on the build-up (the decision to go, Neville, the cloak), while the hand-made chapter spends almost everything on the chambers under the trapdoor. 14 events cannot cover a 299-paragraph chapter either way. Picking beats is therefore off by default (`NOVEL_DIRECTOR_BEATS=1` turns it on). Two chapters are a small test, and a better measure would be players comparing the two versions.

## Staging

The director now runs on Opus at high effort. It reads each scene part's own book text to decide who is really present, acts every line (camera shot, looks, the speaker's gesture and mood, listeners' reactions, walks, runs and exits), and adds a background crowd where the book implies one. Six chapters (1, 5, 7, 10, 12 and 16, 60 scene parts) were built twice: with the rules and with the director.

| | Rules | Director |
| --- | ---: | ---: |
| Stories that pass the engine's validator | 6 of 6 | 6 of 6 |
| Named people placed | 154 | 169 |
| Of those, on named spots (not `auto_1` to `auto_5`) | 0 | 69 |
| Scene parts with a background crowd | 0 | 28 of 60 (195 extras) |
| Entrances | 10 | 18 |
| Story actions played | 26 | 113 |
| Speaker gestures | 0 | 23 |
| Animations (gestures and reactions) | 0 | 105 |

872 of the director's 877 suggestions (99.4%) passed the checks. Only six chapters were rebuilt because a chapter takes about 15 minutes at high effort.

The first version of the director (default model, low effort, only the shown lines, no crowds) was run on all 17 chapters: 17 of 17 stories validated, it placed 268 people against the rules' 442, used named spots 72 times and played 159 actions, and 91% of its suggestions passed the checks. Most of the 9% that failed were not mistakes: an entrance through the door spot was rejected, and every later beat of that person went with it. The checks now send such a person to the next free spot.

These counts show that the director uses the stage. They do not show that the result reads better; that needs people to play both versions.

## Limits

- One book, 2 runs per mode. 49 characters, 30 scenes and 2 reference chapters are small samples: differences of a few points can be noise.
- Invented names hide the book's names, not its plot. A model could still recognise a famous scene from its events.
- Places are scored on type alone, against hand-made labels that are one person's choice.
- Crowds are generic extras on fixed spots behind the group. They stand rather than sit at tables.
