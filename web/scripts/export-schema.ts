import { writeFileSync } from "node:fs";
import { z } from "zod";
import { StorySchema } from "../src/engine/story/schema";

// Writes story.schema.json so editors can autocomplete and check story files.
// Usage: npm run schema
const schema = z.toJSONSchema(StorySchema, { io: "input", unrepresentable: "any" });
writeFileSync("story.schema.json", JSON.stringify({ title: "Novel engine story", ...schema }, null, 2) + "\n");
console.log("wrote story.schema.json");
