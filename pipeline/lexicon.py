"""Hand-written word lists that map English onto engine assets.

Everything here is deterministic data: no model decides anything. Extending
the pipeline to a new kind of novel mostly means extending these tables.
"""

HONORIFICS = {
    "mr", "mrs", "ms", "miss", "madam", "madame", "sir", "lady", "lord",
    "professor", "doctor", "dr", "captain", "uncle", "aunt", "master",
}
FEMALE_HONORIFICS = {"mrs", "ms", "miss", "madam", "madame", "lady", "aunt"}
MALE_HONORIFICS = {"mr", "sir", "lord", "uncle", "master"}

SPEECH_VERBS = {
    "say", "ask", "whisper", "shout", "yell", "scream", "cry", "call", "reply",
    "answer", "mutter", "murmur", "snap", "hiss", "gasp", "add", "exclaim",
    "shriek", "roar", "bellow", "groan", "moan", "breathe", "laugh", "sob",
    "plead", "beg", "insist", "demand", "announce", "declare", "growl", "squeak",
}

# Speech verb -> subtitle mood.
SPEECH_MOOD = {
    "whisper": "whisper", "murmur": "whisper", "breathe": "whisper", "mutter": "whisper",
    "shout": "urgent", "yell": "urgent", "call": "urgent", "exclaim": "urgent", "bellow": "urgent",
    "scream": "scared", "shriek": "scared", "gasp": "scared", "sob": "scared", "plead": "scared", "beg": "scared",
    "snap": "angry", "hiss": "angry", "growl": "angry", "roar": "angry", "demand": "angry",
}

# Movement verbs. Value: True when the move is a run.
MOVE_VERBS = {
    "walk": False, "go": False, "come": False, "step": False, "creep": False,
    "follow": False, "approach": False, "enter": False, "wander": False, "stride": False,
    "lumber": False, "pad": False, "slink": False, "edge": False, "back": False, "move": False,
    "run": True, "rush": True, "dash": True, "hurry": True, "sprint": True, "race": True,
    "charge": True, "flee": True, "bolt": True, "dart": True, "scramble": True, "burst": True,
}
# Moves that take the actor away from the action.
AWAY_VERBS = {"flee", "retreat", "back", "escape", "slink", "bolt"}

# Verb -> engine animation clip. Some need a specific object (see ANIM_WITH_OBJECT).
ANIM_VERBS = {
    "point": "point", "wave": "wave", "nod": "nod", "beckon": "wave",
    "fall": "fall", "collapse": "fall", "topple": "fall", "trip": "fall", "stumble": "fall", "faint": "fall",
    "kneel": "kneel", "crouch": "cower", "cower": "cower", "flinch": "cower", "cringe": "cower",
    "tremble": "cower", "shiver": "cower", "shrink": "cower",
    "laugh": "laugh", "grin": "laugh", "chuckle": "laugh",
    "cast": "cast", "throw": "cast", "hurl": "cast", "fling": "cast", "toss": "cast",
    "drink": "drink", "sip": "drink", "swallow": "drink", "gulp": "drink",
    "grab": "reach", "seize": "reach", "snatch": "reach", "reach": "reach", "catch": "reach",
    "take": "reach", "pick": "reach", "grip": "reach", "clutch": "reach", "lift": "reach", "hold": "reach",
    "struggle": "struggle", "fight": "struggle", "wrestle": "struggle", "kick": "struggle", "thrash": "struggle",
    "jump": "jump", "leap": "jump", "spring": "jump", "hop": "jump",
    "cheer": "celebrate", "celebrate": "celebrate",
    "roar": "roar", "howl": "roar", "bellow": "roar",
    "swing": "lunge", "lunge": "lunge", "pounce": "lunge", "strike": "lunge", "smash": "lunge",
}
# (verb, object word) -> clip, checked before ANIM_VERBS.
ANIM_WITH_OBJECT = {
    ("raise", "wand"): "cast", ("point", "wand"): "cast", ("wave", "wand"): "cast", ("lift", "wand"): "cast",
    ("shake", "head"): "shake", ("nod", "head"): "nod", ("play", "flute"): "play_flute",
}

# Words in narration that trigger a sound effect.
SOUND_WORDS = {
    "scream": "scream", "shriek": "scream", "crash": "crash", "smash": "crash", "shatter": "shatter",
    "roar": "roar", "growl": "growl", "snarl": "growl", "bang": "thud", "thud": "thud", "slam": "thud",
    "creak": "creak", "whoosh": "whoosh", "flutter": "flutter", "laugh": "laugh", "thunder": "thud",
}

DANGER_WORDS = {
    "troll", "monster", "beast", "dog", "danger", "dangerous", "scream", "terrified", "fear", "afraid",
    "dead", "die", "kill", "blood", "attack", "club", "fire", "flame", "dark", "darkness", "growl",
    "roar", "shatter", "crash", "ruin", "help", "shaking", "trap", "poison", "fall", "teeth", "claws",
    "glow", "breathing", "storm", "panic", "pale", "white",
}

# Paragraph openings that mark a jump in time (a new scene).
TIME_MARKERS = (
    "later", "the next morning", "the next day", "that night", "that evening", "hours later",
    "minutes later", "the following", "meanwhile", "when they", "by the time", "after ",
    "an hour", "some time", "the next",
)

SCENE_SEPARATORS = {"***", "* * *", "#", "~", "---", "* * * *", "◆"}

# Verbs strong enough to be a story decision, and how to say their opposite.
# "{obj}" is the object phrase (or "it"); "{target}" a prepositional target.
OPPOSITES = {
    "unlock": "Leave the {obj} locked",
    "lock": "Leave the {obj} unlocked",
    "open": "Keep the {obj} shut",
    "close": "Leave the {obj} open",
    "shut": "Leave the {obj} open",
    "slam": "Leave the {obj} open",
    "enter": "Stay outside",
    "go": "Stay where you are",
    "run": "Stand still",
    "step": "Hold back",
    "jump": "Stay on your feet",
    "climb": "Stay down",
    "attack": "Back away",
    "fight": "Run away",
    "charge": "Back away",
    "grab": "Leave the {obj}",
    "seize": "Leave the {obj}",
    "take": "Leave the {obj}",
    "pick": "Leave the {obj} where it is",
    "catch": "Let the {obj} go",
    "hold": "Lower the {obj}",
    "raise": "Lower the {obj}",
    "lift": "Put the {obj} down",
    "throw": "Keep hold of the {obj}",
    "help": "Leave them to it",
    "save": "Abandon them",
    "rescue": "Abandon them",
    "follow": "Turn back",
    "stay": "Leave",
    "hide": "Step out into the open",
    "wait": "Rush in",
    "turn": "Keep your back turned",
    "push": "Pull back",
    "pull": "Let go",
    "drink": "Put the {obj} down",
    "cast": "Lower your wand",
    "play": "Stop playing",
    "speak": "Stay silent",
    "tell": "Say nothing",
    "shout": "Keep quiet",
    "call": "Keep quiet",
    "warn": "Keep quiet",
    "trust": "Refuse to trust them",
    "stand": "Step aside",
    "face": "Turn away",
    "use": "Don't use the {obj}",
    "light": "Stay in the dark",
}

# Verbs whose subject is the protagonist and that make a good choice moment.
DECISIVE_VERBS = set(OPPOSITES) - {"stay", "wait", "speak"}

# Possessives and pronouns rewritten when a choice addresses the player.
SECOND_PERSON = {"his": "your", "her": "your", "him": "you", "himself": "yourself", "herself": "yourself"}
