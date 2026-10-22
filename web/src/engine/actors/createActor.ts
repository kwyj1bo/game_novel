import type { ActorSpec } from "../story/schema";
import type { Actor } from "./Actor";
import { Dog3 } from "./Dog3";
import { Human } from "./Human";
import { Troll } from "./Troll";

export function createActor(id: string, spec: ActorSpec): Actor {
  switch (spec.kind) {
    case "dog3":
      return new Dog3(id, spec);
    case "troll":
      return new Troll(id, spec);
    default:
      return new Human(id, spec);
  }
}
