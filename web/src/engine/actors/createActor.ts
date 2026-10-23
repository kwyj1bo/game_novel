import type { ActorSpec } from "../story/schema";
import type { Actor } from "./Actor";
import { Dog3 } from "./Dog3";
import { Beast } from "./Beast";
import { Human } from "./Human";
import { Troll } from "./Troll";

export function createActor(id: string, spec: ActorSpec): Actor {
  switch (spec.kind) {
    case "dog3":
      return new Dog3(id, spec);
    case "troll":
      return new Troll(id, spec);
    case "dog":
    case "cat":
    case "owl":
    case "dragon":
    case "centaur":
    case "unicorn":
      return new Beast(id, spec, spec.kind);
    default:
      return new Human(id, spec);
  }
}
