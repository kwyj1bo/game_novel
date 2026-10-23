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
    "tell", "explain", "promise", "admit", "agree", "suggest", "continue", "repeat", "order", "command",
    "sneer", "smirk", "mock", "taunt", "jeer", "scoff", "drawl", "grumble", "whimper", "stammer", "stutter",
    "mumble", "complain", "remind", "chorus", "wail", "howl", "bark", "mutter",
}

# Words that mark an action as not happening ("before he went", "if she ran").
HYPOTHETICAL_MARKS = {"before", "if", "unless", "until", "though", "although", "whether", "lest"}
HYPOTHETICAL_AUX = {"would", "could", "might", "should", "may"}

# Unnamed people who can speak and act ("the innkeeper said").
ROLE_NOUNS = {
    "innkeeper", "goblin", "sailor", "guard", "witch", "wizard", "shopkeeper", "servant", "soldier",
    "knight", "king", "queen", "priest", "farmer", "merchant", "stranger", "driver", "waiter",
    "landlord", "landlady", "teacher", "doctor", "nurse", "policeman", "thief", "beggar", "hunter",
}

# Speech verb -> subtitle mood.
SPEECH_MOOD = {
    "whisper": "whisper", "murmur": "whisper", "breathe": "whisper", "mutter": "whisper",
    "shout": "urgent", "yell": "urgent", "call": "urgent", "exclaim": "urgent", "bellow": "urgent",
    "scream": "scared", "shriek": "scared", "gasp": "scared", "sob": "scared", "plead": "scared", "beg": "scared",
    "snap": "angry", "hiss": "angry", "growl": "angry", "roar": "angry", "demand": "angry",
    "sneer": "angry", "taunt": "angry", "jeer": "angry", "whimper": "scared", "stammer": "scared",
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

# Words that make a verb a change of state ("fell asleep", "went pale").
STATE_WORDS = {
    "asleep", "awake", "silent", "quiet", "still", "pale", "white", "red", "ill", "sick", "dead",
    "unconscious", "rigid", "stiff", "limp", "numb", "mad", "crazy", "faint", "dizzy",
}

# Honorifics that tell people apart ("Mr. Dursley" and "Mrs. Dursley" are two people).
FAMILY_HONORIFICS = {"mr", "mrs", "miss", "ms"}

# Objects that make a light-verb idiom, not a thing in the hand ("took a
# swig", "caught sight of", "pushed his luck").
LIGHT_OBJECTS = {
    "swig", "sip", "gulp", "bite", "mouthful", "look", "glance", "peek", "sight", "breath", "step", "jump",
    "leap", "seat", "chance", "luck", "turn", "nap", "notice", "care", "part", "place", "time", "aim",
    "hold", "interest", "pity", "advantage", "shot", "rest", "pleasure", "way", "deep", "notes", "note",
}

# Places: you go to them or leave them, you don't pick them up.
PLACE_NOUNS = {
    "room", "hall", "table", "dormitory", "shed", "house", "home", "kitchen", "corridor", "castle", "classroom",
    "library", "office", "street", "road", "station", "platform", "cupboard", "stairs", "staircase", "garden",
    "field", "forest", "lake", "bed", "school", "tower", "common", "village", "shop", "bank", "hut", "yard",
    "pitch", "ground", "floor", "path", "train", "boat", "car", "compartment", "chamber", "dungeon", "class",
}

# Body parts are not things you act on ("opened her mouth", "rubbed his eyes").
BODY_PARTS = {
    "mouth", "eyes", "eye", "face", "head", "hand", "hands", "arm", "arms", "leg", "legs", "foot", "feet",
    "nose", "ear", "ears", "lip", "lips", "teeth", "tongue", "finger", "fingers", "shoulder", "shoulders",
    "back", "neck", "chin", "brow", "eyebrows", "fist", "fists", "knee", "knees", "hair", "breath",
}

# Prepositions whose object is acted on ("knocked on the door"); others are
# directions or places ("pulled into the driveway").
OBJECT_PREPS = {"on", "at"}

# Verbs only a living thing does: an acting subject of these is a character.
# (Which animation a verb plays is asset data: see "actions" in the manifest.)
ACTION_VERBS = {
    "point", "wave", "nod", "fall", "kneel", "crouch", "cower", "flinch", "tremble", "laugh", "grin",
    "cast", "throw", "drink", "grab", "seize", "snatch", "reach", "catch", "take", "pick", "grip",
    "struggle", "fight", "kick", "jump", "leap", "cheer", "frown", "smile", "stare", "glare", "sigh",
    "push", "pull", "open", "close", "turn", "look", "watch", "nod", "shrug", "wink", "sob", "weep",
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

# (verb, object word) opposites checked before the verb table.
OPPOSITES_WITH = {
    ("take", "hand"): "Refuse the handshake",
    ("shake", "hand"): "Refuse the handshake",
    ("take", "key"): "Refuse the key",
    ("raise", "wand"): "Lower your wand",
    ("drop", "rope"): "Keep hold of the rope",
}

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
# Everyday movement ("went down the hall", "turned over the bacon") is not.
DECISIVE_VERBS = set(OPPOSITES) - {"stay", "wait", "speak", "go", "turn", "jump", "climb", "stand", "play", "shout", "call"}

# Possessives and pronouns rewritten when a choice addresses the player.
SECOND_PERSON = {"his": "your", "her": "your", "him": "you", "himself": "yourself", "herself": "yourself"}
