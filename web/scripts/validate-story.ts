import { readFileSync } from "node:fs";
import { parseStory } from "../src/engine/story/schema";
import { validateStory } from "../src/engine/story/validate";
import { LOCATION_INFO } from "../src/locations";

// Usage: npm run validate [-- path/to/story.json]
const path = process.argv[2] ?? "src/content/hp/trapdoor.story.json";
const story = parseStory(JSON.parse(readFileSync(path, "utf8")));
const issues = validateStory(story, LOCATION_INFO);
for (const i of issues) console.log(`${i.scene ?? "-"}: ${i.message}`);
console.log(issues.length ? `${issues.length} issue(s)` : `${path}: OK (${Object.keys(story.scenes).length} scenes)`);
process.exit(issues.length ? 1 : 0);
