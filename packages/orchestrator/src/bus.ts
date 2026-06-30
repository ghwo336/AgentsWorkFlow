import { EventEmitter } from "node:events";
import type { BusEvent } from "@agent-loop/shared/types";

// In-process pub/sub. The Fastify SSE route subscribes; the runner publishes.
class Bus extends EventEmitter {
  publish(e: BusEvent) {
    this.emit("event", e);
  }
  subscribe(fn: (e: BusEvent) => void) {
    this.on("event", fn);
    return () => this.off("event", fn);
  }
}

export const bus = new Bus();
// Many SSE clients may attach; avoid the default 10-listener warning.
bus.setMaxListeners(0);
