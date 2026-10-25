// Reads lines aloud with the browser's built-in speech (Web Speech API), so
// characters talk without recorded audio or an AI voice model. A character's
// voice comes from rules: their `voice` value sets the pitch and keeps them on
// the same system voice every time; the line's mood sets speed and loudness.

export interface VoiceSettings {
  pitch: number;
  rate: number;
  volume: number;
}

// The moods a say beat can have (see the story schema).
const MOODS: Record<string, Partial<VoiceSettings>> = {
  whisper: { rate: 0.85, volume: 0.45 },
  urgent: { rate: 1.15 },
  scared: { rate: 1.1 },
  angry: { rate: 1.08 },
};

// Speech settings for a speaker's `voice` value (null for the narrator) and a mood.
export function voiceSettings(voice: number | null, mood?: string): VoiceSettings {
  const base = { pitch: voice === null ? 1 : Math.min(2, Math.max(0.3, voice)), rate: voice === null ? 0.95 : 1, volume: 1 };
  return { ...base, ...(mood ? MOODS[mood] : undefined) };
}

// macOS joke and robotic voices: never a character's voice.
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Fred|Good News|Jester|Junior|Kathy|Organ|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/;
// Natural voices that sound female (others are taken as male).
const FEMALE = /^(Samantha|Flo|Karen|Moira|Sandy|Shelley|Tessa|Grandma|Victoria|Allison|Ava|Susan|Zira|Google UK English Female|Google US English)\b/;

const ELDERLY = /^(Grandma|Grandpa)\b/;

// The voices a speaker can get: natural English voices of their gender (or,
// without one, female for higher pitches), old-sounding ones only for deep voices.
export function voicePool<T extends { name: string; lang: string }>(voices: T[], voice: number, gender?: "m" | "f"): T[] {
  const natural = voices.filter((v) => v.lang.startsWith("en") && !NOVELTY.test(v.name) && (voice <= 0.9 || !ELDERLY.test(v.name)));
  const female = gender ? gender === "f" : voice >= 1.15;
  const pool = natural.filter((v) => FEMALE.test(v.name) === female);
  return pool.length ? pool : natural;
}

// The same speaker always gets the same voice from the list.
export function pickVoice<T>(voices: T[], speakerId: string): T | undefined {
  let h = 0;
  for (const c of speakerId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return voices.length ? voices[h % voices.length] : undefined;
}

export class Voices {
  enabled = true;
  private readonly synth = typeof speechSynthesis === "undefined" ? null : speechSynthesis;

  get available(): boolean {
    return this.enabled && !!this.synth;
  }

  // Resolves when the line has been spoken (or at once when voices are off).
  speak(text: string, speaker: { id: string; voice: number; gender?: "m" | "f" } | null, mood?: string): Promise<void> {
    const synth = this.synth;
    if (!this.available || !synth) return Promise.resolve();
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const all = synth.getVoices();
    const voice = speaker ? pickVoice(voicePool(all, speaker.voice, speaker.gender), speaker.id) : all.find((v) => v.default) ?? voicePool(all, 1)[0];
    if (voice) u.voice = voice;
    Object.assign(u, voiceSettings(speaker ? speaker.voice : null, mood));
    return new Promise((resolve) => {
      // Some browsers never fire "end" (no voices installed, background tab):
      // give up after about the time the line would take to say.
      const timer = window.setTimeout(resolve, 2000 + text.split(/\s+/).length * 450);
      u.onend = u.onerror = () => {
        clearTimeout(timer);
        resolve();
      };
      synth.speak(u);
    });
  }

  stop(): void {
    this.synth?.cancel();
  }
}
