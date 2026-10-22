import { readFileSync } from "node:fs";
import { parseStory } from "../src/engine/story/schema";
import { validateStory } from "../src/engine/story/validate";
import { LOCATION_INFO } from "../src/locations";

// Usage: npm run validate [-- path/to/story.json ...]
const paths = process.argv.length > 2 ? process.argv.slice(2) : ["src/content/hp/troll.story.json", "src/content/hp/trapdoor.story.json"];
let failed = 0;
for (const path of paths) {
  const story = parseStory(JSON.parse(readFileSync(path, "utf8")));
  const issues = validateStory(story, LOCATION_INFO);
  for (const i of issues) console.log(`${path} ${i.scene ?? "-"}: ${i.message}`);
  console.log(issues.length ? `${path}: ${issues.length} issue(s)` : `${path}: OK (${Object.keys(story.scenes).length} scenes)`);
  failed += issues.length;
}
process.exit(failed ? 1 : 0);
