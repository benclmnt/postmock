import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./events.ts";
import type { OutboundMessage } from "./state/types.ts";

describe("EventBus", () => {
  const message = { MessageID: "m" } as OutboundMessage;

  it("delivers to listeners of that event until unsubscribed", () => {
    const bus = new EventBus();
    const sent = vi.fn();
    const opened = vi.fn();
    const off = bus.on("sent", sent);
    bus.on("opened", opened);
    bus.emit("sent", { message });
    off();
    bus.emit("sent", { message });
    expect(sent).toHaveBeenCalledExactlyOnceWith({ message });
    expect(opened).not.toHaveBeenCalled();
  });

  it("lets a listener error reach the emitter", () => {
    const bus = new EventBus();
    bus.on("sent", () => {
      throw new Error("boom");
    });
    expect(() => bus.emit("sent", { message })).toThrow("boom");
  });
});
