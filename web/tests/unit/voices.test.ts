import { describe, expect, it } from "vitest";
import { pickVoice, voicePool, voiceSettings } from "../../src/engine/audio/Voices";

describe("character voices", () => {
  it("takes the pitch from the character's voice value", () => {
    expect(voiceSettings(0.85).pitch).toBe(0.85);
    expect(voiceSettings(1.35).pitch).toBe(1.35);
    expect(voiceSettings(9).pitch).toBe(2);
  });

  it("lets the mood set speed and loudness", () => {
    expect(voiceSettings(1, "whisper")).toEqual({ pitch: 1, rate: 0.85, volume: 0.45 });
    expect(voiceSettings(1, "urgent").rate).toBeGreaterThan(1);
    expect(voiceSettings(1, "calm")).toEqual({ pitch: 1, rate: 1, volume: 1 });
  });

  it("reads narration in a steady narrator voice", () => {
    expect(voiceSettings(null)).toEqual({ pitch: 1, rate: 0.95, volume: 1 });
  });

  it("gives a character the same voice every time", () => {
    const voices = ["a", "b", "c", "d"];
    expect(pickVoice(voices, "harry")).toBe(pickVoice(voices, "harry"));
    expect(new Set(["harry", "ron", "hermione", "hagrid", "snape"].map((id) => pickVoice(voices, id))).size).toBeGreaterThan(1);
    expect(pickVoice([], "harry")).toBeUndefined();
  });

  it("never gives a character a joke voice, and matches the voice to the pitch", () => {
    const v = (name: string) => ({ name, lang: "en-US" });
    const system = [v("Samantha"), v("Daniel"), v("Bells"), v("Zarvox"), v("Moira"), v("Reed"), { name: "Amelie", lang: "fr-FR" }];
    expect(voicePool(system, 1.35).map((x) => x.name)).toEqual(["Samantha", "Moira"]);
    expect(voicePool(system, 0.9).map((x) => x.name)).toEqual(["Daniel", "Reed"]);
    expect(voicePool([v("Bells"), v("Alex")], 1.35).map((x) => x.name)).toEqual(["Alex"]);
  });

  it("uses the character's gender when the story has it, and old voices only for deep ones", () => {
    const v = (name: string) => ({ name, lang: "en-GB" });
    const system = [v("Grandma"), v("Grandpa"), v("Daniel"), v("Moira")];
    expect(voicePool(system, 1.15, "m").map((x) => x.name)).toEqual(["Daniel"]);
    expect(voicePool(system, 0.9, "f").map((x) => x.name)).toEqual(["Grandma", "Moira"]);
  });
});
