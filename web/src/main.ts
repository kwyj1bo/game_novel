import "./style.css";
import { Engine } from "./engine/Engine";
import { parseStory } from "./engine/story/schema";
import { LOCATIONS } from "./locations";
import storyJson from "./content/hp/trapdoor.story.json";

// URL flags (for testing and debugging):
//   ?fast      instant text and short holds
//   ?mute      no audio
//   ?scene=id  skip the title and start at a scene
const params = new URLSearchParams(location.search);
const host = document.getElementById("app")!;

try {
  const story = parseStory(storyJson);
  const engine = new Engine({
    host,
    story,
    locations: LOCATIONS,
    fast: params.has("fast"),
    muted: params.has("mute"),
  });
  (window as unknown as { __engine: Engine }).__engine = engine;
  const from = params.get("scene") ?? undefined;
  engine.start({ skipTitle: !!from, from }).catch(showError);
} catch (e) {
  showError(e);
}

function showError(e: unknown) {
  console.error(e);
  const box = document.createElement("pre");
  box.className = "error-box";
  box.textContent = e instanceof Error ? `${e.message}\n\n${e.stack ?? ""}` : String(e);
  document.body.appendChild(box);
}
