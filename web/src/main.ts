import "./style.css";
import { Engine, type Chapter } from "./engine/Engine";
import { parseStory } from "./engine/story/schema";
import { ACTIONS, LOCATIONS, storyLocations } from "./locations";
import trollJson from "./content/hp/troll.story.json";
import trapdoorJson from "./content/hp/trapdoor.story.json";

// URL flags (for testing and debugging):
//   ?fast      instant text and short holds
//   ?mute      no audio
//   ?scene=id  skip the menu and start at a scene
//   ?story=url play a story file (e.g. one made by the novel pipeline)
//   ?demos     include the hand-made demo chapters in the menu
//   ?showcase=id  preview one scenery from the asset manifest
const params = new URLSearchParams(location.search);
const host = document.getElementById("app")!;

async function boot() {
  // The start screen is your library: books you upload become chapters.
  // The hand-made demo chapters show only with ?demos.
  const chapters: Chapter[] = params.has("demos")
    ? [
        { number: "Demo · Chapter Ten", story: parseStory(trollJson) },
        { number: "Demo · Chapters Sixteen & Seventeen", story: parseStory(trapdoorJson) },
      ]
    : [];
  const storyUrl = params.get("story");
  let from = params.get("scene") ?? undefined;
  if (storyUrl) {
    const res = await fetch(storyUrl);
    if (!res.ok) throw new Error(`could not load ${storyUrl}: ${res.status}`);
    const story = parseStory(await res.json());
    chapters.unshift({ number: "Generated from the text", story });
    from ??= story.start;
  }
  if (from && !storyUrl && !chapters.some((c) => c.story && from! in c.story.scenes)) {
    // ?scene= for a demo scene works without also passing ?demos.
    chapters.push({ number: "Demo · Chapter Ten", story: parseStory(trollJson) }, { number: "Demo · Chapters Sixteen & Seventeen", story: parseStory(trapdoorJson) });
  }
  const engine = new Engine({
    host,
    title: "Novel Engine",
    chapters,
    locations: LOCATIONS,
    actions: ACTIONS,
    storyLocations,
    menuScenery: "great_hall",
    uploadUrl: "/api/build",
    libraryUrl: "/api/library",
    fast: params.has("fast"),
    muted: params.has("mute"),
  });
  (window as unknown as { __engine: Engine }).__engine = engine;
  const preview = params.get("showcase");
  if (preview) return engine.preview(preview);
  await engine.start({ from });
}

boot().catch(showError);

function showError(e: unknown) {
  console.error(e);
  const box = document.createElement("pre");
  box.className = "error-box";
  box.textContent = e instanceof Error ? `${e.message}\n\n${e.stack ?? ""}` : String(e);
  document.body.appendChild(box);
}
