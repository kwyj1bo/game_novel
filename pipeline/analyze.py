"""Turn chapter paragraphs into characters and an ordered list of lines.

A line is either narration (with the actions found in it) or dialogue (with
its speaker and mood). spaCy supplies sentences, part-of-speech tags and the
dependency parse; every decision on top of that is a rule in this file or a
table in lexicon.py.
"""

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from functools import lru_cache

from . import lexicon as L

QUOTE_RE = re.compile(r"[“\"]([^”\"]+)[”\"]")
KNOWN_SPELLS = {
    "lumos", "nox", "alohomora", "expelliarmus", "stupefy", "accio", "incendio", "reducto",
    "wingardium leviosa", "petrificus totalus", "expecto patronum", "protego", "obliviate",
}
LATIN_ENDINGS = ("us", "um", "osa", "ia", "io", "ra", "os", "is", "ae", "um!", "o")


@lru_cache(maxsize=1)
def nlp():
    import spacy

    return spacy.load("en_core_web_sm")


@dataclass
class Character:
    id: str
    name: str
    kind: str = "human"  # or a creature kind from the catalog (dog3, troll)
    gender: str = "x"  # m, f or x (unknown)
    mentions: int = 0
    aliases: set[str] = field(default_factory=set)
    # Manifest asset this character uses (character or creature id), if any.
    asset: str | None = None
    # Actions the narration gives this character, and actions aimed at them
    # (both drive who the hero is).
    actions: int = 0
    named_actions: int = 0  # actions where the text names them, not "he"/"she"
    spoken: int = 0
    targeted: int = 0
    first_seen: int = 10**9  # index of the first line they appear in


def asset_tables(catalog) -> tuple[dict, dict, dict]:
    """verb -> action id, (verb, object) -> action id and word -> sound, from the manifest."""
    by_verb, by_verb_obj, sounds = {}, {}, {}
    for a in catalog["actions"]:
        for v in a["verbs"]:
            # A verb can mean several actions ("pull" a person or a thing).
            by_verb.setdefault(v, []).append(a["id"])
        for v, obj in a.get("with", {}).items():
            by_verb_obj[(v, obj)] = a["id"]
    for s in catalog["sounds"]:
        for w in s["words"]:
            sounds[w] = s["id"]
    return by_verb, by_verb_obj, sounds


# Actions an animal can perform (no hands). Centaurs have hands, so they can do anything.
CREATURE_ACTIONS = {
    "approach", "run_to", "back_away", "flee", "roar", "lunge", "fall", "cower", "nod", "shake_head",
    "follow", "watch", "turn_to", "turn_away", "lie_down", "wake", "fly", "jump", "stop", "wait", "stand_firm",
}
HANDED_KINDS = {"human", "centaur", "troll"}


@dataclass
class Event:
    actor: str | None
    kind: str  # action (an asset from the manifest), move, act, sound, spell
    verb: str = ""
    action: str | None = None  # manifest action id
    clip: str | None = None
    run: bool = False
    target: str | None = None  # character id, "away" or "forward"
    sfx: str | None = None
    phrase: str = ""  # imperative verb phrase, for choices
    obj: str = ""  # object phrase, as written ("his wand")
    obj_label: str = ""  # object phrase addressed to the player ("your wand")
    named: bool = False  # the actor was named, not a pronoun ("Harry took", not "he took")


@dataclass
class Line:
    kind: str  # narrate or say
    text: str
    para: int
    speaker: str | None = None
    mood: str | None = None
    events: list[Event] = field(default_factory=list)
    danger: int = 0


@dataclass
class Analysis:
    characters: dict[str, Character]
    lines: list[Line]
    protagonist: str | None


def _quote_spans(text: str) -> list[tuple[int, int, str]]:
    return [(m.start(), m.end(), m.group(1).strip()) for m in QUOTE_RE.finditer(text)]


def _in_quotes(tok, spans) -> bool:
    return any(a <= tok.idx < b for a, b, _ in spans)


def _strip_name(tokens: list[str]) -> tuple[list[str], str | None]:
    """Drops honorifics and possessive endings. Returns the remaining words and
    the honorific, if any."""
    honor = None
    out = []
    for t in tokens:
        low = t.lower().rstrip(".")
        if low in L.HONORIFICS:
            honor = low
            continue
        if t in ("'s", "’s"):
            continue
        out.append(t)
    return out, honor


class _Detector:
    """First pass over the whole chapter: who is in it, and their genders."""

    def __init__(self, docs, catalog):
        self.docs = docs
        self.catalog = catalog
        self.chars: dict[str, Character] = {}
        self.alias: dict[str, str] = {}
        # Single-word names for creature assets ("troll", "dog") -> asset id.
        self.creature_words = {w: cid for cid, c in catalog["creatures"].items() for w in c["words"] if " " not in w}
        self.creature_kind = {cid: c["spec"]["kind"] for cid, c in catalog["creatures"].items()}
        self.place_words = {k.lower() for loc in catalog["locations"].values() for k in loc["keywords"]}
        # Single words from place titles and keywords ("hogwarts", "drive", "gryffindor").
        self.place_tokens = {
            w for loc in catalog["locations"].values() for phrase in [loc["title"], *loc["keywords"]]
            for w in re.findall(r"[a-z']+", phrase.lower()) if len(w) >= 4 and w not in ("room", "hall", "hut's")
        }

    def _evidence(self) -> dict[str, dict[str, int]]:
        """Per capitalised word: how it is used. People rarely take "the"
        ("the Stone" is a thing), are not plural ("the Weasleys" is a family),
        and get a PERSON label or act and speak somewhere in the book."""
        ev: dict[str, dict[str, int]] = {}
        for doc, spans in self.docs:
            for tok in doc:
                if tok.pos_ != "PROPN" or _in_quotes(tok, spans):
                    continue
                e = ev.setdefault(tok.text, {"n": 0, "the": 0, "plural": 0, "person": 0, "other": 0, "acts": 0})
                e["n"] += 1
                prev = doc[tok.i - 1] if tok.i > 0 else None
                if prev is not None and prev.lower_ in ("the", "a", "an", "this", "that"):
                    e["the"] += 1
                if tok.tag_ == "NNPS":
                    e["plural"] += 1
                if tok.ent_type_ == "PERSON":
                    e["person"] += 1
                elif tok.ent_type_:
                    e["other"] += 1
                head = tok.head.lemma_.lower()
                if tok.dep_ == "nsubj" and (head in L.SPEECH_VERBS or head in L.MOVE_VERBS or head in L.ACTION_VERBS):
                    e["acts"] += 1
        return ev

    def _is_person_word(self, word: str, ev: dict[str, dict[str, int]], known: set[str]) -> bool:
        if word.lower() in known:
            return True  # the manifest knows this name
        if not word[:1].isupper() or not word.replace("'", "").replace("-", "").isalpha():
            return False  # "the", "jewel", "Mr."
        if word.lower() in self.place_tokens:
            return False  # part of a place name the manifest knows ("Hogwarts", "Drive")
        e = ev.get(word)
        if not e:
            return True  # only seen inside an entity span; let the span decide
        if e["the"] * 2 >= e["n"] or e["plural"] * 2 > e["n"]:
            return False  # "the Stone", "the Weasleys"
        if e["acts"]:
            return True  # places and things don't act
        if e["n"] < 2 or e["person"] == 0:
            return False  # one passing mention, or never labelled a person
        return e["other"] <= 2 * e["person"]

    def _split_families(self):
        """"Mr. Dursley" and "Mrs. Dursley" are two people: a surname seen with
        more than one family honorific becomes one character per honorific."""
        seen: dict[str, Counter] = {}
        for doc, spans in self.docs:
            for tok in doc:
                if tok.i == 0 or tok.pos_ != "PROPN" or _in_quotes(tok, spans):
                    continue
                honor = doc[tok.i - 1].lower_.rstrip(".")
                if honor in L.FAMILY_HONORIFICS:
                    seen.setdefault(tok.lower_, Counter())[honor] += 1
        for surname, honors in seen.items():
            cid = self.alias.get(surname)
            if len(honors) < 2 or cid not in self.chars:
                continue
            base = self.chars[cid]
            for honor, n in honors.items():
                key = f"{honor} {surname}"
                c = self.chars.get(key) or Character(id=key, name=f"{honor.capitalize()}. {surname.capitalize()}")
                c.mentions += n
                c.gender = "f" if honor in L.FEMALE_HONORIFICS else "m" if honor in L.MALE_HONORIFICS else c.gender
                self.chars[key] = c
                self.alias[key] = key
            if base.id == surname:
                # Only the bare surname was known: it was never one person.
                del self.chars[cid]
                self.alias.pop(surname, None)

    def run(self) -> dict[str, Character]:
        names: Counter[tuple[str, ...]] = Counter()
        honors: dict[tuple[str, ...], str] = {}
        evidence = self._evidence()
        known = {w.lower() for a in self.catalog["characters"].values() for n in a["names"] for w in n.replace(".", "").split()}
        for doc, spans in self.docs:
            for ent in doc.ents:
                if ent.label_ != "PERSON" or _in_quotes(ent[0], spans):
                    continue
                words, honor = _strip_name([t.text for t in ent])
                if words:
                    names[tuple(words)] += 1
                    if honor:
                        honors[tuple(words)] = honor
            # Proper nouns that speak or act are characters even if NER missed them.
            for tok in doc:
                if tok.pos_ != "PROPN" or not tok.text[0].isupper() or _in_quotes(tok, spans):
                    continue
                # Places don't whisper or grab arms: an acting subject is a character
                # whatever the entity label says.
                head = tok.head.lemma_.lower()
                acts = tok.dep_ == "nsubj" and (head in L.SPEECH_VERBS or head in L.MOVE_VERBS or head in L.ACTION_VERBS or head in L.OPPOSITES)
                if acts:
                    names[(tok.text,)] += 1
                elif tok.dep_ in ("nsubj", "dobj", "pobj", "poss") and tok.ent_type_ not in ("GPE", "LOC", "DATE", "TIME", "FAC", "WORK_OF_ART"):
                    names[(tok.text,)] += 0.5
        # Cluster: single words fold into the longer name that contains them.
        full = sorted(names, key=lambda n: (-len(n), -names[n]))
        for n in full:
            # "Professor McGonagall" is known by surname, "Harry Potter" by first
            # name; "Mr. Dursley" and "Mrs. Dursley" stay two people.
            key = n[-1].lower() if n in honors else n[0].lower()
            owner = self.alias.get(n[-1].lower()) or self.alias.get(n[0].lower())
            if owner and len(n) == 1:
                self.chars[owner].mentions += names[n]
                continue
            if key in self.creature_words or key in L.HONORIFICS or " ".join(n).lower() in self.place_words:
                continue  # "Gringotts" is somewhere you go, not someone
            if not all(self._is_person_word(w, evidence, known) for w in n):
                continue
            c = self.chars.get(key) or Character(id=key, name=" ".join(n) if len(n) == 1 else n[0])
            if n in honors:
                c.name = f"{honors[n].capitalize()} {n[-1]}" if honors[n] in ("professor", "madam", "doctor") else n[-1]
                c.gender = "f" if honors[n] in L.FEMALE_HONORIFICS else "m" if honors[n] in L.MALE_HONORIFICS else c.gender
            c.mentions += names[n]
            for w in n:
                self.alias.setdefault(w.lower(), key)
            self.chars[key] = c
        self._split_families()
        self._creatures()
        self._match_assets()
        self._genders()
        # Drop one-off noise. A name the manifest knows needs less evidence.
        self.chars = {k: c for k, c in self.chars.items() if c.kind != "human" or c.mentions >= 1 or (c.asset and c.mentions >= 0.5)}
        return self.chars

    def _match_assets(self):
        """Points each character at a manifest character by name, and merges
        characters that turn out to be the same asset ("Mr. Dursley" and
        "Uncle Vernon")."""
        by_name = {}
        for aid, a in self.catalog["characters"].items():
            for n in a["names"]:
                words, honor = _strip_name(n.replace(".", "").split())
                if honor in L.FAMILY_HONORIFICS:
                    by_name.setdefault(f"{honor} {' '.join(words).lower()}", aid)
                by_name.setdefault(" ".join(words).lower(), aid)
        merged: dict[str, Character] = {}
        for c in self.chars.values():
            if c.kind == "human":
                keys = [c.name.lower(), c.id, *[a for a in self.alias if self.alias[a] == c.id]]
                c.asset = next((by_name[k] for k in keys if k in by_name), None)
                # A named creature ("Hedwig", "Norbert") takes its kind from the asset.
                if c.asset:
                    c.kind = self.catalog["characters"][c.asset]["spec"].get("kind", "human")
            key = c.asset if c.kind == "human" and c.asset else c.id
            if key in merged:
                m = merged[key]
                m.mentions += c.mentions
                if m.gender == "x":
                    m.gender = c.gender
            else:
                c.id = key
                merged[key] = c
        for a, cid in list(self.alias.items()):
            old = self.chars.get(cid)
            if old is not None:
                self.alias[a] = old.id
        self.chars = merged

    def _creatures(self):
        for doc, spans in self.docs:
            for tok in doc:
                # Unnamed people who speak or act: "the innkeeper laughed".
                lem = tok.lemma_.lower()
                # Singular only ("Sailors crowded" is a crowd, not a character). The
                # small parser mislabels some subjects, so a role noun right before
                # a verb also counts ("The innkeeper laughed").
                nxt = doc[tok.i + 1] if tok.i + 1 < len(doc) else None
                acting = tok.dep_ == "nsubj" or (nxt is not None and nxt.pos_ == "VERB")
                if lem in L.ROLE_NOUNS and tok.tag_ == "NN" and acting and not _in_quotes(tok, spans):
                    c = self.chars.setdefault(lem, Character(id=lem, name=f"The {lem.capitalize()}"))
                    c.mentions += 1
                    self.alias[lem] = lem
                    continue
                asset = self.creature_words.get(tok.lemma_.lower())
                if asset and tok.pos_ in ("NOUN", "PROPN") and tok.dep_ in ("nsubj", "dobj", "pobj") and not _in_quotes(tok, spans):
                    cid = tok.lemma_.lower()
                    c = self.chars.setdefault(cid, Character(id=cid, name=cid.capitalize(), kind=self.creature_kind[asset], gender="n", asset=asset))
                    c.mentions += 1
                    self.alias[cid] = cid

    def _genders(self):
        """Votes from the first subject pronoun (he/she) after a sentence whose
        only subject is the character. Possessives are ignored: in "Tobin
        grabbed her arm", "her" is someone else."""
        votes: dict[str, Counter] = defaultdict(Counter)
        # One flat list of sentences, so a pronoun in the next paragraph still counts.
        flat = [(s, spans) for doc, spans in self.docs for s in doc.sents]
        for i, (s, spans) in enumerate(flat):
            subj_toks = [t for t in s if t.dep_ == "nsubj" and not _in_quotes(t, spans) and self.resolve_name(t)]
            if len({self.resolve_name(t) for t in subj_toks}) != 1:
                continue
            cid = self.resolve_name(subj_toks[0])
            after = subj_toks[-1].i
            window = [(t, spans) for t in s if t.i > after] + [(t, sp) for nxt, sp in flat[i + 1 : i + 3] for t in nxt]
            for t, sp in window:
                if _in_quotes(t, sp) or t.dep_ != "nsubj":
                    continue
                low = t.text.lower()
                if low == "he":
                    votes[cid]["m"] += 1
                    break
                if low == "she":
                    votes[cid]["f"] += 1
                    break
                if t.pos_ != "PRON":
                    break  # someone else took over as subject
        for cid, v in votes.items():
            c = self.chars.get(cid)
            if c and c.kind == "human" and c.gender == "x" and v:
                c.gender = v.most_common(1)[0][0]

    def resolve_name(self, tok) -> str | None:
        prev = tok.doc[tok.i - 1] if tok.i > 0 else None
        if prev is not None:
            honor = prev.lower_.rstrip(".")
            if honor in L.FAMILY_HONORIFICS and f"{honor} {tok.lower_}" in self.alias:
                return self.alias[f"{honor} {tok.lower_}"]
        low = tok.text.lower()
        if low in self.alias:
            return self.alias[low]
        lem = tok.lemma_.lower()
        if (lem in self.creature_words or lem in L.ROLE_NOUNS) and lem in self.chars:
            return lem
        return None


class _Reader:
    """Second pass, in reading order: resolves pronouns, attributes dialogue,
    extracts actions."""

    def __init__(self, detector: _Detector, catalog):
        self.d = detector
        self.chars = detector.chars
        self.recent: list[str] = []
        # Characters most recently mentioned as a subject: "he"/"she" as a
        # subject usually continues the last subject, not the last object.
        self.recent_subjects: list[str] = []
        self.last_speakers: list[str] = []
        self.by_verb, self.by_verb_obj, self.sounds = asset_tables(catalog)
        self.action_defs = {a["id"]: a for a in catalog["actions"]}

    def _see(self, cid: str | None, subject: bool = False):
        if not cid:
            return
        if cid in self.recent:
            self.recent.remove(cid)
        self.recent.append(cid)
        if subject:
            if cid in self.recent_subjects:
                self.recent_subjects.remove(cid)
            self.recent_subjects.append(cid)

    def _pronoun_in(self, pool: list[str], low: str, exclude: str | None) -> str | None:
        want = {"he": "m", "she": "f", "it": "n"}.get(low)
        if not want:
            return None
        for cid in reversed(pool[-3:]):
            if cid != exclude and self.chars[cid].gender == want:
                return cid
        return None

    def _pronoun(self, low: str, exclude: str | None = None) -> str | None:
        want = {"he": "m", "him": "m", "his": "m", "himself": "m", "she": "f", "her": "f", "herself": "f", "it": "n", "its": "n"}.get(low)
        if not want:
            return None
        # A known gender match beats someone whose gender is unknown.
        for cid in reversed(self.recent):
            if cid != exclude and self.chars[cid].gender == want:
                return cid
        if want in "mf":
            for cid in reversed(self.recent):
                if cid != exclude and self.chars[cid].gender == "x":
                    return cid
        return None

    def who(self, tok, exclude: str | None = None) -> str | None:
        """Character a token refers to (name, creature noun or pronoun). An
        object pronoun never means the actor themselves ("shoved him"); a
        subject pronoun continues the last subject of that gender."""
        cid = self.d.resolve_name(tok)
        if cid in self.chars:
            return cid
        if tok.pos_ == "PRON":
            if tok.dep_ == "nsubj":
                hit = self._pronoun_in(self.recent_subjects, tok.text.lower(), exclude)
                if hit:
                    return hit
            return self._pronoun(tok.text.lower(), exclude)
        # Compound names ("Professor McGonagall") resolve through any part.
        for child in tok.children:
            if child.dep_ == "compound":
                c2 = self.d.resolve_name(child)
                if c2 in self.chars:
                    return c2
        return None

    def read_paragraph(self, idx: int, doc, spans) -> list[Line]:
        lines: list[Line] = []
        para_speaker: str | None = None
        danger = sum(1 for t in doc if t.lemma_.lower() in L.DANGER_WORDS)
        # Characters named in narration, in order, for tag-less dialogue.
        pending: list[Line] = []  # quotes in this paragraph still waiting for a speaker
        for sent in doc.sents:
            quotes = [(a, b, q) for a, b, q in spans if sent.start_char <= a < sent.end_char]
            outside = [t for t in sent if not _in_quotes(t, spans) and not t.is_punct]
            if not outside and not quotes:
                continue  # the tail of a quote that started in an earlier sentence
            # Track mentions outside quotes in reading order.
            tag_speaker, tag_verb = None, None
            for tok in sent:
                if _in_quotes(tok, spans):
                    continue
                cid = self.who(tok)
                if cid is None and tok.dep_ == "nsubj" and tok.pos_ == "PRON" and tok.head.lemma_.lower() in L.SPEECH_VERBS:
                    # Unresolved pronoun tag: the most recent speaker of that gender.
                    cid = self._pronoun(tok.text.lower())
                if cid and tok.dep_ in ("nsubj", "nsubjpass", "dobj", "pobj", "poss", "conj", "appos", "compound", "ROOT"):
                    if tok.lemma_.lower() in L.SPEECH_VERBS:
                        continue
                    # Speech tags: "said Harry" / "Harry said" / "she whispered".
                    head = tok.head
                    if tok.dep_ == "nsubj" and head.lemma_.lower() in L.SPEECH_VERBS:
                        tag_speaker, tag_verb = cid, head.lemma_.lower()
                    self._see(cid, subject=tok.dep_ == "nsubj")
            # A short sentence like "Ron asked." names the speaker of the quotes before it.
            if not quotes and tag_speaker and self._only_tag(sent, spans):
                gestures = self._events(sent, spans, participles=True)
                for ln in pending:
                    ln.speaker = tag_speaker
                    ln.mood = L.SPEECH_MOOD.get(tag_verb or "") or ln.mood
                if pending:
                    pending[0].events.extend(gestures)
                pending = []
                para_speaker = tag_speaker
                continue
            if quotes:
                speaker = tag_speaker or para_speaker or self._guess_speaker(doc, spans)
                mood = L.SPEECH_MOOD.get(tag_verb or "")
                for _, _, q in quotes:
                    m = mood or ("urgent" if q.endswith("!") else None)
                    line = Line(kind="say", text=q, para=idx, speaker=speaker, mood=m, danger=danger)
                    spell = self._spell(q)
                    if spell and speaker:
                        line.events.append(Event(actor=speaker, kind="spell", verb="cast", target=None))
                    lines.append(line)
                    if not tag_speaker:
                        pending.append(line)
                if tag_speaker:
                    pending = []
                if speaker:
                    para_speaker = speaker
                    self._see(speaker)
                    if not self.last_speakers or self.last_speakers[-1] != speaker:
                        self.last_speakers.append(speaker)
                # Narration around the quotes ("He looked up and down the hallway.")
                rest = self._outside(sent, spans)
                if rest and not self._only_tag(sent, spans):
                    lines.append(Line(kind="narrate", text=rest, para=idx, events=self._events(sent, spans), danger=danger))
                elif rest:
                    # A tag's gesture ("grinning", "shaking his head") plays with the line.
                    first_quote = next(ln for ln in reversed(lines) if ln.kind == "say")
                    first_quote.events.extend(e for e in self._events(sent, spans, participles=True) if e.kind == "action")
            else:
                text = sent.text.strip()
                # "sobbed Hagrid, taking out a handkerchief": a tag whose quote
                # is in the previous block. Not narration.
                if tag_speaker and self._only_tag(sent, spans):
                    continue
                first = next((t for t in sent if not t.is_punct), sent[0])
                if text[:1].islower() and len([t for t in sent if not t.is_punct]) <= 6:
                    continue  # a tag or a fragment, not a sentence
                if text[:1].islower() and (first.lemma_.lower() in L.SPEECH_VERBS or any(b <= sent.start_char for _, b, _ in spans)):
                    continue  # "faltered Professor McGonagall." after a quote
                if text and text not in L.SCENE_SEPARATORS:
                    lines.append(Line(kind="narrate", text=text, para=idx, events=self._events(sent, spans), danger=danger))
        return lines

    def _guess_speaker(self, doc, spans) -> str | None:
        # Someone named in this paragraph's narration, else alternate speakers.
        named = [self.who(t) for t in doc if not _in_quotes(t, spans) and (t.dep_ == "nsubj" or t.lemma_.lower() in L.ROLE_NOUNS)]
        named = [n for n in named if n and self.chars[n].kind == "human"]
        if named:
            return named[0]
        if len(self.last_speakers) >= 2:
            return self.last_speakers[-2]
        return self.last_speakers[-1] if self.last_speakers else None

    @staticmethod
    def _outside(sent, spans) -> str:
        text = sent.text
        base = sent.start_char
        for a, b, _ in sorted(spans, reverse=True):
            lo, hi = max(a, base), min(b, sent.end_char)
            if lo < hi:
                text = text[: lo - base] + text[hi - base :]
        text = re.sub(r"\s+", " ", text).strip(" ,.")
        return (text + ".") if text else ""

    def _only_tag(self, sent, spans) -> bool:
        """True when the words outside the quotes are a speech tag, maybe with a
        trailing clause ("said Hagrid, grinning down at him"): a speech verb and
        no other finite verb."""
        words = [t for t in sent if not _in_quotes(t, spans) and not t.is_punct]
        if not any(t.lemma_.lower() in L.SPEECH_VERBS for t in words):
            return False
        finite = [t for t in words if t.tag_ in ("VBD", "VBZ", "VBP") and t.lemma_.lower() not in L.SPEECH_VERBS]
        return len(words) <= 4 or not finite

    @staticmethod
    def _spell(q: str) -> bool:
        s = q.strip("!.?, ").lower()
        if s in KNOWN_SPELLS:
            return True
        words = s.split()
        return 1 <= len(words) <= 2 and q.strip().endswith("!") and all(w.endswith(LATIN_ENDINGS) and len(w) > 4 for w in words)

    def _subject(self, verb):
        for c in verb.children:
            if c.dep_ == "nsubj":
                return c
        # Conjoined verbs share the first verb's subject ("ran ..., slammed ... and turned ...").
        if verb.dep_ == "conj" and verb.head.pos_ in ("VERB", "AUX"):
            return self._subject(verb.head)
        # The small parser often hangs the main verb off its subject noun
        # ("A huge troll lumbered out..." parsed as a clause on "troll").
        if verb.dep_ == "acl" and verb.head.pos_ in ("NOUN", "PROPN"):
            return verb.head
        return None

    def _events(self, sent, spans, participles: bool = False) -> list[Event]:
        events: list[Event] = []
        for tok in sent:
            if _in_quotes(tok, spans):
                continue
            lem = tok.lemma_.lower()
            if tok.pos_ == "NOUN" and lem in self.sounds:
                events.append(Event(actor=None, kind="sound", sfx=self.sounds[lem], verb=lem))
                continue
            if tok.pos_ != "VERB" or lem in L.SPEECH_VERBS:
                continue
            # "did not run", "before he went", "he could have run": none of these happened.
            if any(c.dep_ == "neg" for c in tok.children):
                continue
            if any(c.dep_ == "mark" and c.lemma_.lower() in L.HYPOTHETICAL_MARKS for c in tok.children):
                continue
            if any(c.dep_ == "aux" and c.lemma_.lower() in L.HYPOTHETICAL_AUX for c in tok.children):
                continue
            # "fell asleep", "went white", "fell silent": a state, not an action.
            if any((c.dep_ in ("acomp", "oprd") and c.pos_ == "ADJ") or c.lower_ in L.STATE_WORDS for c in tok.children):
                continue
            subj = self._subject(tok)
            actor = self.who(subj) if subj is not None else None
            # "said Hagrid, grinning": the participle's actor is the speaker.
            if actor is None and participles and tok.tag_ == "VBG" and tok.head.lemma_.lower() in L.SPEECH_VERBS:
                actor = next((self.who(c) for c in tok.head.children if c.dep_ == "nsubj"), None)
            obj_tok = next((c for c in tok.children if c.dep_ in ("dobj", "obj")), None)
            obj = self._phrase(obj_tok) if obj_tok is not None else ""
            prt = next((c.text.lower() for c in tok.children if c.dep_ == "prt"), "")
            prep = next((c for c in tok.children if c.dep_ == "prep"), None)
            pobj = next((c for c in prep.children if c.dep_ == "pobj"), None) if prep is not None else None
            phrase = self._imperative(tok, obj_tok, prt, prep)
            if lem in self.sounds:
                events.append(Event(actor=actor, kind="sound", sfx=self.sounds[lem], verb=lem))
            if actor is None:
                continue
            found = self._action(tok, lem, actor, obj_tok, prt, prep, pobj, phrase)
            for e in found:
                e.named = subj is not None and subj.pos_ == "PROPN"
            events.extend(found)
        return events

    def _concrete(self, thing) -> bool:
        """Whether a token is a thing you can act on: not a person, a pronoun,
        a body part, a place or the noun of an idiom ("took a swig")."""
        if thing is None or thing.pos_ == "PRON" or self.who(thing) is not None:
            return False
        lem = thing.lemma_.lower()
        return lem not in L.BODY_PARTS and lem not in L.LIGHT_OBJECTS and lem not in L.PLACE_NOUNS

    def _action(self, tok, lem, actor, obj_tok, prt, prep, pobj, phrase) -> list[Event]:
        """Matches a verb to an action asset and fills its parameters: the
        target (a character the verb is aimed at) and the object (a thing)."""
        kind = self.chars[actor].kind
        obj_head = obj_tok.lemma_.lower() if obj_tok is not None else ""
        target = self.who(obj_tok, exclude=actor) if obj_tok is not None else None
        if target is None and pobj is not None:
            target = self.who(pobj, exclude=actor)
        if target == actor:
            target = None
        # The object is the thing acted on: the direct object (not a person, not
        # a body part, not a bare pronoun), or the object of "on"/"at" ("knocked
        # on the door"). "Pulled into the driveway" acts on nothing.
        obj = ""
        thing = obj_tok if obj_tok is not None else (pobj if prep is not None and prep.lower_ in L.OBJECT_PREPS else None)
        if self._concrete(thing):
            obj = self._phrase(thing)
        action = self._pick_action(lem, obj_head, target, obj_tok, pobj, actor)
        # "took his hand": the hand's owner is who the action is aimed at.
        if target is None and obj_tok is not None:
            owner = next((self.who(c) for c in obj_tok.children if c.dep_ == "poss"), None)
            if owner and owner != actor and action and "target" in self.action_defs.get(action, {}).get("params", []):
                target = owner
        # "crashed to the floor" for a creature is a fall.
        if kind != "human" and lem in ("crash", "sway") and pobj is not None and pobj.lemma_.lower() in ("floor", "ground"):
            action = "fall"
        is_move = lem in L.MOVE_VERBS or (lem == "step" and prt in ("forward", "back"))
        if is_move or action in ("approach", "run_to"):
            away = lem in L.AWAY_VERBS or prt in ("away", "back") or (prep is not None and prep.text.lower() == "away")
            if away and target is None:
                # "backed away from the troll": the target hangs off "away".
                frm = next((t for t in tok.subtree if t.dep_ == "prep" and t.lower_ == "from"), None)
                pob = next((c for c in frm.children if c.dep_ == "pobj"), None) if frm is not None else None
                target = self.who(pob) if pob is not None else None
            if away:
                action = "back_away" if target else "flee"
            elif target:
                action = "run_to" if L.MOVE_VERBS.get(lem) else "approach"
            else:
                # Moving with nobody to move to: only an entrance, no action.
                return [Event(actor=actor, kind="move", verb=lem, run=L.MOVE_VERBS.get(lem, False), target="forward" if pobj is not None else None, phrase=phrase, obj=obj)]
        out: list[Event] = []
        if action and action in self.action_defs:
            params = self.action_defs[action]["params"]
            if "target" in params and not target:
                action = None
            elif kind not in HANDED_KINDS and action not in CREATURE_ACTIONS:
                action = None
            elif kind == "human" and action in ("lunge", "roar"):
                action = None  # a person "roaring" is speaking
        else:
            action = None
        obj_label = self._second_person(obj, actor) if obj else ""
        if action and "object" in self.action_defs[action]["params"] and not obj:
            action = None  # nothing concrete to act on
        if action:
            out.append(Event(actor=actor, kind="action", verb=lem, action=action, target=target, obj=obj, obj_label=obj_label, phrase=phrase))
        elif lem in L.DECISIVE_VERBS and (obj or target):
            # No asset for it, but still a candidate decision.
            out.append(Event(actor=actor, kind="act", verb=lem, target=target, obj=obj, obj_label=obj_label, phrase=phrase))
        return out

    def _pick_action(self, lem, obj_head, target, obj_tok, pobj, actor) -> str | None:
        """The action asset a verb means here. With several candidates, the
        first whose parameters the sentence can fill wins: aimed at a person
        needs a target; acting on a thing needs an object."""
        special = self.by_verb_obj.get((lem, obj_head))
        if special:
            return special
        cands = self.by_verb.get(lem, [])
        if not cands:
            return None
        if target is None and obj_tok is not None:
            owner = next((self.who(c) for c in obj_tok.children if c.dep_ == "poss"), None)
            if owner and owner != actor and any("target" in self.action_defs[c]["params"] for c in cands):
                target = owner
        thing = obj_tok if obj_tok is not None else (pobj if pobj is not None and pobj.head.lower_ in L.OBJECT_PREPS else None)
        has_thing = self._concrete(thing)
        def fits(c: str) -> int:
            params = self.action_defs[c]["params"]
            if "target" in params and not target:
                return -1
            score = 2 if ("target" in params) == bool(target) else 0
            score += 1 if ("object" in params) == has_thing else 0
            return score
        best = max(cands, key=lambda c: (fits(c), -cands.index(c)))
        return best if fits(best) >= 0 else None

    def _second_person(self, phrase: str, actor: str | None) -> str:
        """'his wand' said of the actor -> 'your wand' (for choice labels)."""
        out = []
        for w in phrase.split():
            low = w.lower()
            if low in ("his", "her", "its") and actor and self._pronoun(low) == actor:
                out.append("your")
            else:
                out.append(w)
        return " ".join(out)

    @staticmethod
    def _phrase(tok) -> str:
        # Relative clauses add detail, not the thing: "a piece of paper (that
        # was lying on the table)".
        cut = {t.i for c in tok.children if c.dep_ in ("relcl", "acl") for t in c.subtree}
        words = [t.text for t in tok.subtree if t.i not in cut]
        return " ".join(words).replace(" 's", "'s").replace(" ’s", "’s")

    def _imperative(self, verb, obj, prt, prep) -> str:
        """'Harry unlocked the door' -> 'Unlock the door'."""
        parts = [verb.lemma_.lower()]
        if obj is not None and obj.pos_ == "PRON" and prt:
            parts += [self._phrase(obj), prt]  # "pick it up", not "pick up it"
        else:
            if prt:
                parts.append(prt)
            if obj is not None:
                parts.append(self._phrase(obj))
        if obj is not None and prt == "" and any(c.dep_ in ("acomp", "oprd") for c in verb.children):
            parts.append(next(c.text for c in verb.children if c.dep_ in ("acomp", "oprd")))
        if prep is not None and (obj is None or len(parts) < 3):
            parts.append(self._phrase(prep))
        actor_tok = self._subject(verb)
        actor = self.who(actor_tok) if actor_tok is not None else None
        out = []
        for w in " ".join(parts).split():
            low = w.lower()
            if low in ("his", "her", "its") and actor and self._pronoun(low) == actor:
                out.append("your")
            elif low == "his" and self._pronoun(low) and self._pronoun(low) != actor:
                name = self.chars[self._pronoun(low)].name
                out.append((name.lower() if name.startswith("The ") else name) + "'s")
            elif low in ("him", "her", "them"):
                ref = self._pronoun(low)
                out.append(self.chars[ref].name if ref and ref != actor else "them")
            elif low in ("himself", "herself"):
                out.append("yourself")
            else:
                out.append(w)
        text = " ".join(out[:8])
        return text[:1].upper() + text[1:]


def hero_score(c: Character) -> float:
    """The hero is who the story follows: named often, acting, and acted upon.
    Whoever the story opens on gets a nudge."""
    return c.mentions + 2 * c.actions + 1.5 * c.targeted + (3 if c.first_seen < 5 else 0)


def analyze(paragraphs: list[str], catalog) -> Analysis:
    parsed = []
    for p in paragraphs:
        doc = nlp()(p)
        parsed.append((doc, [(a, b, q) for a, b, q in _quote_spans(p)]))
    det = _Detector(parsed, catalog)
    chars = det.run()
    reader = _Reader(det, catalog)
    lines: list[Line] = []
    for i, (doc, spans) in enumerate(parsed):
        lines.extend(reader.read_paragraph(i, doc, spans))
    # Recount mentions directly: every time a name appears in narration, plus
    # half a point per spoken line. More reliable than entity labels, and it
    # favours whoever the narration follows over whoever talks most.
    for c in chars.values():
        c.mentions = 0
    for doc, spans in parsed:
        for tok in doc:
            if not _in_quotes(tok, spans):
                cid = det.resolve_name(tok)
                if cid in chars:
                    chars[cid].mentions += 1
    for i, ln in enumerate(lines):
        if ln.kind == "say" and ln.speaker in chars:
            chars[ln.speaker].mentions += 0.5
        if ln.kind == "say" and ln.speaker in chars:
            chars[ln.speaker].spoken += 1
        for e in ln.events:
            if e.actor in chars and e.kind in ("action", "move", "act"):
                chars[e.actor].actions += 1
                if e.named:
                    chars[e.actor].named_actions += 1
            if e.target in chars and e.kind == "action":
                chars[e.target].targeted += 1
        for cid, c in chars.items():
            if c.first_seen > i and (ln.speaker == cid or any(e.actor == cid for e in ln.events) or (ln.kind == "narrate" and re.search(rf"\b{re.escape(c.name.split()[-1])}\b", ln.text))):
                c.first_seen = i
    humans = [c for c in chars.values() if c.kind == "human"]
    protagonist = max(humans, key=hero_score).id if humans else None
    return Analysis(characters=chars, lines=lines, protagonist=protagonist)
