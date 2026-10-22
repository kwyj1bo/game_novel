import "./style.css";
import { Engine, type Chapter } from "./engine/Engine";
import { parseStory } from "./engine/story/schema";
import { LOCATIONS } from "./locations";
import trollJson from "./content/hp/troll.story.json";
import trapdoorJson from "./content/hp/trapdoor.story.json";

// URL flags (for testing and debugging):
//   ?fast      instant text and short holds
//   ?mute      no audio
//   ?scene=id  skip the menu and start at a scene
//   ?story=url play a story file (e.g. one made by the novel pipeline)
const params = new URLSearchParams(location.search);
const host = document.getElementById("app")!;

async function boot() {
  const chapters: Chapter[] = [
    { number: "Chapter Ten", story: parseStory(trollJson) },
    { number: "Chapters Sixteen & Seventeen", story: parseStory(trapdoorJson) },
  ];
  const storyUrl = params.get("story");
  let from = params.get("scene") ?? undefined;
  if (storyUrl) {
    const res = await fetch(storyUrl);
    if (!res.ok) throw new Error(`could not load ${storyUrl}: ${res.status}`);
    const story = parseStory(await res.json());
    chapters.unshift({ number: "Generated from the text", story });
    from ??= story.start;
  }
  const engine = new Engine({
    host,
    title: "Harry Potter and the Philosopher's Stone",
    chapters,
    locations: LOCATIONS,
    uploadUrl: "/api/build",
    fast: params.has("fast"),
    muted: params.has("mute"),
  });
  (window as unknown as { __engine: Engine }).__engine = engine;
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
