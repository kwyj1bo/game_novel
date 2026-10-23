# game_novel

A game engine that renders a novel as a playable 3D story. The player watches each scene and makes choices at key moments. Each choice has two options. The wrong option plays its consequence and ends the run. The right option continues the story. After a wrong choice, the player can try the same choice again.

You upload a novel (PDF or plain text). The engine splits it into chapters and builds a playable game for each chapter on its own, with no AI model and no manual step. It can stage only the assets that it has. The asset manifest lists them: what each character looks like, every scenery, and which animation and sound each word triggers.

The manifest has the cast and places of *Harry Potter and the Philosopher's Stone*, plus generic sceneries (forest, tavern, street, ship and more) for other books. Characters it does not know get a generated look.

Two hand-made chapters from that book (the troll, and the trapdoor) are kept as reference demos. Open them with `?demos`.

## Run the game

You need Node.js 20 or later.

1. Go to the engine folder: `cd web`
2. Install the dependencies: `npm install`
3. Start the dev server: `npm run dev`
4. Open http://localhost:5173

The start screen is your library. Use the "Upload a novel" card to add a book: each chapter becomes a card. Uploaded books are kept (in `library/`), so they are still there after a reload. The game saves your progress at each choice. "Continue" starts that chapter again from the entrance of the chamber you reached.

Uploading needs the backend. Start it next to the dev server: `uvicorn app.main:app --port 8000` from the repository root.

Controls: click or press Space to advance dialogue. Press 1 or 2 (or the left and right arrow keys) to choose.

URL flags for testing:

- `?scene=<id>` skips the menu and starts at a scene.
- `?demos` adds the hand-made demo chapters to the menu.
- `?showcase=<scenery>` shows one scenery from the manifest, to check an asset.
- `?fast` shows text instantly and gives choices a 30 second timer.
- `?mute` turns off audio.

## Tests

| Command | What it checks |
| --- | --- |
| `npm test` | Unit tests for the story validator and the story runtime. These run without a browser. |
| `npm run test:e2e` | Playwright plays the game in Chromium: a full run of each chapter, every wrong choice followed by a retry, a timer timeout, saved progress and the chapter menu. Run `npx playwright install chromium` once first. |
| `npm run validate` | Checks the story files against the rules below. |
| `npm run typecheck` | TypeScript type check. |

CI (`.github/workflows/web.yml`) runs the type check, unit tests, story validation and build. The e2e suite runs locally only, because it depends on real frame timing.

`scripts/shoot.ts` captures screenshots on a schedule for visual review. For example: `npx vite-node scripts/shoot.ts -- "scene=chess_enter&mute&fast" shots 5000,10000 correct@100`.

## How the engine works

A story is a JSON file in `web/src/content/hp/`. Each story is one chapter. It lists the actors and the scenes. Each scene names a location, places its cast on named marks, and lists its beats. A beat is one action: a line of dialogue, a move, an animation, a camera shot, an effect, a sound or a prop change. Beats in a `together` block run at the same time.

Each scene ends in one of three ways: a `goto` to the next scene, a `choice`, or an `ending`.

`web/story.schema.json` describes the story format for editors: a story file that sets `"$schema"` gets autocomplete and inline errors. Run `npm run schema` after you change the zod schema in `schema.ts`. CI fails when the file is out of date.

The validator (`web/src/engine/story/validate.ts`) enforces the game design:

- A choice has exactly one correct option.
- A wrong option leads to an ending with no further choice.
- A correct option never leads to a losing ending.
- Every scene is reachable, and the story has no loops.
- Every actor, mark and prop state that a beat uses exists.

The engine checks the story when it starts and refuses to run an invalid story.

An `act` beat (`{"act": "pat", "actor": "ron", "target": "harry"}`) performs an action asset. The engine expands it into the asset's steps, and the validator checks the expanded steps too.

### Main parts

| Folder | Contents |
| --- | --- |
| `web/src/engine/story` | Story schema, validator, `Director` (plays the beats of one scene) and `StoryRuntime` (moves between scenes, choices, endings and retries). |
| `web/src/engine/world` | `ThreeStage`, which connects story beats to the 3D scene. |
| `web/src/engine/actors` | Procedural characters: a jointed human with face, hair, outfit and hat variants, a three-headed dog and a troll. Animation clips are code, not keyframe files. |
| `web/src/engine/render` | WebGL renderer with bloom, filmic tone mapping, vignette and grain. The camera rig frames named shots and moves around props that block the view. |
| `web/src/engine/fx` | Particle system and effects: spells, fire, smoke, sparkles, screen fades. |
| `web/src/engine/audio` | Music and sound effects made with the Web Audio API. |
| `web/src/engine/ui` | Subtitles, timed choice cards, title and ending screens. |
| `web/src/locations` | The eight locations. Each location declares its marks and props, then builds its geometry. |

The `Director` talks to the 3D world and the UI only through two interfaces (`Stage` and `Hud` in `ports.ts`). The unit tests use fake versions of both, so the story logic runs without a browser.

A retry rebuilds the room without delay: the runtime replays the scenes since the last location change in instant mode, then asks the choice again.

## Assets

`web/assets/manifest.json` lists every asset. The engine and the pipeline both read it, so adding an asset is an edit to this file, not to code. `web/assets/manifest.schema.json` gives your editor autocomplete for it.

| Section | An entry has |
| --- | --- |
| `sceneries` | An id, a title, the keywords that place a scene there, and one way to build it: `preset` (a room, hall, tavern, forest, street, shore and 14 more types, with size, time of day, colours and props), `model` (a glTF file; empties named `mark_<name>` become marks), or `code` (one of the hand-built rooms). |
| `characters` | Every name the text may use ("Harry", "Harry Potter", "Potter") and the look: height, robe, skin, hair style, glasses, beard, hat. |
| `creatures` | The words for an unnamed creature ("troll", "owl", "dragon") and its look. Named creatures (Hedwig, Fang, Norbert) are `characters` with a creature `kind`. Creature rigs: three-headed dog, troll, dog, cat, owl, dragon, centaur, unicorn. A human with `ghost: true` is translucent and glows. |
| `actions` | A piece of choreography with parameters (`actor`, `target`, `object`). It has the verbs that trigger it, steps (story beats where `$actor`, `$target` and `$object` stand for the parameters), a narration template, a choice label, its `opposite` action, and whether it is a `decision` (opening a door is; falling is not). For example, `pat(actor, target)` walks the actor to the target, turns them to face each other, plays the pat and the target's nod. Its opposite is `shove`. |
| `sounds` | A sound and the words that trigger it. |
| `defaults.scenery` | Where a chapter goes when no keyword matches. |

Every scenery has generic marks (`auto_1` to `auto_5`, `auto_threat`, `auto_entry`), so a generated story can stage any cast anywhere. After you edit the manifest, run `npm run catalog` in `web/`. This writes `web/catalog.json`, the resolved asset list the pipeline reads. CI fails when it is out of date.

## From novel to game

The pipeline in `pipeline/` turns a novel (PDF or plain text) into one story file per chapter. It uses no AI model. spaCy supplies sentences, part-of-speech tags and the dependency parse. WordNet supplies antonyms. Every other decision is a rule in `pipeline/analyze.py` and `pipeline/build.py`, or a word list in `pipeline/lexicon.py`. The same input always gives the same story.

The steps are:

1. **Text:** split the file into chapters and paragraphs (`text.py`).
2. **Characters:** find names, merge variants ("Professor McGonagall", "McGonagall"), match each person to a manifest character by any of its names ("Mr. Dursley" and "Uncle Vernon" are one asset), detect creatures and unnamed speakers ("the innkeeper"), and work out genders from honorifics and subject pronouns. Names of places ("Gringotts") are not people.
3. **Dialogue:** pull out quotes, attribute each one to a speaker from tags such as "said Ron" or "she whispered", and set the mood from the speech verb.
4. **Actions:** match each verb to an action asset and fill its parameters from the dependency parse. "Ron walked up to Harry and patted him on the head" becomes `approach(ron, harry)` then `pat(ron, harry)`. Sounds and spells are found too. Actions that did not happen ("did not run", "before he went") are ignored. Pronouns are resolved to the most recent character of the right gender.
5. **Scenes:** start a new scene at a scene break, a time jump, or a change of location. Locations come from keyword matches in narration, using the keywords each location declares.
6. **Event chain:** reduce the chapter to its important events. Each paragraph is a candidate. It scores for involving the hero, real actions, decisions, tension, a sudden rise in tension, spells, creatures, sounds, a character's first appearance, a change of location, closeness to the climax, leading straight into a choice or a turn, and TextRank centrality (how many words it shares with the rest of the chapter). Scene openings, choices and the last paragraph are always kept. At most half the paragraphs survive, and never more than 14. The events form a chain: each one names the next. An event shows its key lines and at most two lines of dialogue. Only the chain is played. Narration is written from the actions ("Ron walks over to Harry. Ron gives Harry a pat."), not copied from the book. The book's sentence is used, shortened, only when no action matched.
7. **Choices:** the hero is the character the whole book follows (most named in narration, actions count double). Score the hero's decisions by tension, verb and position. When the action asset has an opposite, both options are actions: picking one plays that action. Pick up to three. The correct option is what the hero did. The wrong option is its direct opposite ("Open the door" against "Keep the door shut"). A wrong choice acts out the opposite action, plays its consequence and ends the run. The ending says what the hero did in the book.
8. **Story:** stage the cast on each location's generic `auto_*` marks, add camera shots, and write story JSON that the engine validator accepts.

### Run it

You need Python 3.12.

1. Install the dependencies: `pip install -r requirements.txt`
2. Get the spaCy model: `python -m spacy download en_core_web_sm`
3. Get WordNet: `python -c "import nltk; nltk.download('wordnet')"`
4. Build a novel: `python -m pipeline build book.pdf --validate`

Each chapter is written to `web/public/generated/`. Open one with `http://localhost:5173/?story=/generated/<file>.story.json`. Add `--debug out/` to write the output of each step for inspection. `5-event-chain.json` is the chapter's outline: each event with its summary, characters, location, score, the reasons for the score, and the next event. The upload API returns the same chain with each chapter.

To upload from the browser, start the backend with `uvicorn app.main:app --port 8000` next to `npm run dev`. The chapter menu then has an "Upload a novel" card.

`python -m pipeline inventory book.pdf` reports what a book needs that the manifest lacks: every character (with mentions, and whether a manifest character covers them) and every on-screen verb (with counts, and whether an action asset covers it). Use it to decide which assets to add next.

`python -m pytest` runs the pipeline tests on original fixture texts in `tests/pipeline/fixtures/`: two single chapters and two whole books, one in the Harry Potter world and one with no known assets.

## Earlier prototype

The rest of the Python code in `app/` is the first prototype: PDF text and chapter extraction. The pipeline replaces its scene and entity detection.
