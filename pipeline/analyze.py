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


@dataclass
class Event:
    actor: str | None
    kind: str  # move, anim, sound, spell
    verb: str = ""
    clip: str | None = None
    run: bool = False
    target: str | None = None  # character id, "away" or "forward"
    sfx: str | None = None
    phrase: str = ""  # imperative verb phrase, for choices
    obj: str = ""  # object phrase


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
        self.creature_words = {w: kind for kind, words in catalog["creatures"].items() for w in words}

    def run(self) -> dict[str, Character]:
        names: Counter[tuple[str, ...]] = Counter()
        honors: dict[tuple[str, ...], str] = {}
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
                acts = tok.dep_ == "nsubj" and (head in L.SPEECH_VERBS or head in L.MOVE_VERBS or head in L.ANIM_VERBS or head in L.OPPOSITES)
                if acts:
                    names[(tok.text,)] += 1
                elif tok.dep_ in ("nsubj", "dobj", "pobj", "poss") and tok.ent_type_ not in ("GPE", "LOC", "DATE", "TIME", "FAC", "WORK_OF_ART"):
                    names[(tok.text,)] += 0.5
        # Cluster: single words fold into the longer name that contains them.
        full = sorted(names, key=lambda n: (-len(n), -names[n]))
        for n in full:
            # "Professor McGonagall" is known by surname, "Harry Potter" by first name.
            key = n[-1].lower() if n in honors else n[0].lower()
            owner = self.alias.get(n[-1].lower()) or self.alias.get(n[0].lower())
            if owner and len(n) == 1:
                self.chars[owner].mentions += names[n]
                continue
            if key in self.creature_words or key in L.HONORIFICS:
                continue
            c = self.chars.get(key) or Character(id=key, name=" ".join(n) if len(n) == 1 else n[0])
            if n in honors:
                c.name = f"{honors[n].capitalize()} {n[-1]}" if honors[n] in ("professor", "madam", "doctor") else n[-1]
                c.gender = "f" if honors[n] in L.FEMALE_HONORIFICS else "m" if honors[n] in L.MALE_HONORIFICS else c.gender
            c.mentions += names[n]
            for w in n:
                self.alias.setdefault(w.lower(), key)
            self.chars[key] = c
        self._creatures()
        self._genders()
        # Drop one-off noise; keep anyone who speaks (fixed up later by attribution).
        self.chars = {k: c for k, c in self.chars.items() if c.mentions >= 1.5 or c.kind != "human"}
        return self.chars

    def _creatures(self):
        for doc, spans in self.docs:
            for tok in doc:
                kind = self.creature_words.get(tok.lemma_.lower())
                if kind and tok.pos_ == "NOUN" and tok.dep_ in ("nsubj", "dobj", "pobj") and not _in_quotes(tok, spans):
                    cid = tok.lemma_.lower()
                    c = self.chars.setdefault(cid, Character(id=cid, name=cid.capitalize(), kind=kind, gender="n"))
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
        low = tok.text.lower()
        if low in self.alias:
            return self.alias[low]
        lem = tok.lemma_.lower()
        if lem in self.creature_words and lem in self.chars:
            return lem
        return None


class _Reader:
    """Second pass, in reading order: resolves pronouns, attributes dialogue,
    extracts actions."""

    def __init__(self, detector: _Detector, catalog):
        self.d = detector
        self.chars = detector.chars
        self.recent: list[str] = []
        self.last_speakers: list[str] = []
        self.creature_clips = {"troll": {"roar", "lunge", "fall", "shake", "nod", "cower"}, "dog3": {"sleep", "wake", "lunge", "roar", "shake", "nod"}}

    def _see(self, cid: str | None):
        if not cid:
            return
        if cid in self.recent:
            self.recent.remove(cid)
        self.recent.append(cid)

    def _pronoun(self, low: str) -> str | None:
        want = {"he": "m", "him": "m", "his": "m", "himself": "m", "she": "f", "her": "f", "herself": "f", "it": "n", "its": "n"}.get(low)
        if not want:
            return None
        for cid in reversed(self.recent):
            g = self.chars[cid].gender
            if g == want or (want in "mf" and g == "x"):
                return cid
        return None

    def who(self, tok) -> str | None:
        """Character a token refers to (name, creature noun or pronoun)."""
        cid = self.d.resolve_name(tok)
        if cid in self.chars:
            return cid
        if tok.pos_ == "PRON":
            return self._pronoun(tok.text.lower())
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
                    self._see(cid)
            # A short sentence like "Ron asked." names the speaker of the quotes before it.
            if not quotes and tag_speaker and self._only_tag(sent, spans):
                for ln in pending:
                    ln.speaker = tag_speaker
                    ln.mood = L.SPEECH_MOOD.get(tag_verb or "") or ln.mood
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
            else:
                text = sent.text.strip()
                if text and text not in L.SCENE_SEPARATORS:
                    lines.append(Line(kind="narrate", text=text, para=idx, events=self._events(sent, spans), danger=danger))
        return lines

    def _guess_speaker(self, doc, spans) -> str | None:
        # Someone named in this paragraph's narration, else alternate speakers.
        named = [self.who(t) for t in doc if not _in_quotes(t, spans) and t.dep_ == "nsubj"]
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
        """True when the words outside the quotes are only a speech tag."""
        words = [t for t in sent if not _in_quotes(t, spans) and not t.is_punct]
        return len(words) <= 4 and any(t.lemma_.lower() in L.SPEECH_VERBS for t in words)

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

    def _events(self, sent, spans) -> list[Event]:
        events: list[Event] = []
        for tok in sent:
            if _in_quotes(tok, spans):
                continue
            lem = tok.lemma_.lower()
            if tok.pos_ == "NOUN" and lem in L.SOUND_WORDS:
                events.append(Event(actor=None, kind="sound", sfx=L.SOUND_WORDS[lem], verb=lem))
                continue
            if tok.pos_ != "VERB" or lem in L.SPEECH_VERBS:
                continue
            subj = self._subject(tok)
            actor = self.who(subj) if subj is not None else None
            obj_tok = next((c for c in tok.children if c.dep_ in ("dobj", "obj")), None)
            obj = self._phrase(obj_tok) if obj_tok is not None else ""
            prt = next((c.text.lower() for c in tok.children if c.dep_ == "prt"), "")
            prep = next((c for c in tok.children if c.dep_ == "prep"), None)
            pobj = next((c for c in prep.children if c.dep_ == "pobj"), None) if prep is not None else None
            phrase = self._imperative(tok, obj_tok, prt, prep)
            if lem in L.SOUND_WORDS:
                events.append(Event(actor=actor, kind="sound", sfx=L.SOUND_WORDS[lem], verb=lem))
            if actor is None:
                continue
            kind = self.chars[actor].kind
            obj_head = obj_tok.lemma_.lower() if obj_tok is not None else ""
            clip = L.ANIM_WITH_OBJECT.get((lem, obj_head)) or L.ANIM_VERBS.get(lem)
            if kind != "human" and lem in ("crash", "sway") and pobj is not None and pobj.lemma_.lower() in ("floor", "ground"):
                clip = "fall"
            if clip and kind != "human" and clip not in self.creature_clips.get(kind, set()):
                clip = None
            if clip and kind == "human" and clip in ("roar", "lunge", "sleep", "wake"):
                clip = None
            if lem in L.MOVE_VERBS or (lem == "step" and prt in ("forward", "back")):
                target = None
                if lem in L.AWAY_VERBS or prt in ("away", "back") or (prep is not None and prep.text.lower() == "away"):
                    target = "away"
                elif pobj is not None:
                    target = self.who(pobj) or "forward"
                events.append(Event(actor=actor, kind="move", verb=lem, run=L.MOVE_VERBS.get(lem, False), target=target, phrase=phrase, obj=obj))
            if clip:
                events.append(Event(actor=actor, kind="anim", verb=lem, clip=clip, phrase=phrase, obj=obj))
            elif lem in L.DECISIVE_VERBS and lem not in L.MOVE_VERBS:
                # Not animated, but still a candidate decision.
                events.append(Event(actor=actor, kind="act", verb=lem, phrase=phrase, obj=obj))
        return events

    @staticmethod
    def _phrase(tok) -> str:
        words = [t.text for t in tok.subtree]
        return " ".join(words).replace(" 's", "'s").replace(" ’s", "’s")

    def _imperative(self, verb, obj, prt, prep) -> str:
        """'Harry unlocked the door' -> 'Unlock the door'."""
        parts = [verb.lemma_.lower()]
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
            elif low in ("him", "her", "them"):
                ref = self._pronoun(low)
                out.append(self.chars[ref].name if ref and ref != actor else "them")
            elif low in ("himself", "herself"):
                out.append("yourself")
            else:
                out.append(w)
        text = " ".join(out[:8])
        return text[:1].upper() + text[1:]


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
    # Speakers count as mentions; anyone who speaks is a character.
    for ln in lines:
        if ln.kind == "say" and ln.speaker in chars:
            chars[ln.speaker].mentions += 1
    humans = [c for c in chars.values() if c.kind == "human"]
    protagonist = max(humans, key=lambda c: c.mentions).id if humans else None
    return Analysis(characters=chars, lines=lines, protagonist=protagonist)
