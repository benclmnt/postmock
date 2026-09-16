import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./events.ts";
import type { OutboundMessage } from "./state/types.ts";

describe("EventBus", () => {
  const message = { MessageID: "m" } as OutboundMessage;

  it("delivers to listeners of that event until unsubscribed", async () => {
    const bus = new EventBus();
    const sent = vi.fn();
    const opened = vi.fn();
    const off = bus.on("sent", sent);
    bus.on("opened", opened);
    await bus.emit("sent", { message });
    off();
    await bus.emit("sent", { message });
    expect(sent).toHaveBeenCalledExactlyOnceWith({ message });
    expect(opened).not.toHaveBeenCalled();
  });

  it("resolves after async listeners finish, in order", async () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.on("sent", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push("slow");
    });
    bus.on("sent", () => {
      order.push("fast");
    });
    await bus.emit("sent", { message });
    expect(order).toEqual(["slow", "fast"]);
  });

  it("lets a listener error reach the emitter", async () => {
    const bus = new EventBus();
    bus.on("sent", async () => {
      throw new Error("boom");
    });
    await expect(bus.emit("sent", { message })).rejects.toThrow("boom");
  });
});
