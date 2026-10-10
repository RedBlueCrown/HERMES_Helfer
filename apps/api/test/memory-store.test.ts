import { MODEL } from "@hermes-helfer/core";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectRepository } from "../src/projects/repository";
import type { VerifyResult } from "../src/store/event-store";
import { MemoryEventStore } from "../src/store/memory-event-store";
import { canonicalJson } from "../src/util/canonical-json";
import { ACTOR, created, eventStoreContract, released, sharedStoreContract } from "./store-contract";

describe("memory event store", () => {
  const store = new MemoryEventStore();
  eventStoreContract(() => store);
  sharedStoreContract(() => store);

  it("hashes canonically", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { f: 2, e: 1 }], c: undefined } })).toBe(
      '{"a":{"d":[1,{"e":1,"f":2}]},"b":1}',
    );
  });

  it("refuses project ids that are not safe as file names", async () => {
    await expect(
      store.append({
        projectId: "../etc",
        expectedSeq: 0,
        events: [created()],
        actor: ACTOR,
        correlationId: "c",
      }),
    ).rejects.toThrow(/Invalid project id/);
  });
});

describe("project repository", () => {
  it("persists to JSON lines and quarantines a manipulated project when loading", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hh-store-"));
    const store = new MemoryEventStore({ dataDir: dir });
    for (const projectId of ["p-one", "p-two"]) {
      await store.append({
        projectId,
        expectedSeq: 0,
        events: [created()],
        actor: ACTOR,
        correlationId: "c1",
      });
    }
    expect(await new MemoryEventStore({ dataDir: dir }).read("p-one")).toHaveLength(1);

    const file = join(dir, "projects", "p-two.jsonl");
    writeFileSync(file, readFileSync(file, "utf8").replace('"name":"Test"', '"name":"Manipuliert"'));
    const quarantined: [string, VerifyResult][] = [];
    const repo = new ProjectRepository(new MemoryEventStore({ dataDir: dir }), MODEL, {
      onCorruptProject: (id, result) => quarantined.push([id, result]),
    });
    await repo.load();
    expect(quarantined).toEqual([["p-two", expect.objectContaining({ ok: false, brokenAtSeq: 1 })]]);
    expect((await repo.all()).map((s) => s.projectId)).toEqual(["p-one"]);
    expect(await repo.get("p-two")).toBeUndefined();
    await expect(repo.append("p-two", 1, [released()], ACTOR, "c")).rejects.toMatchObject({ status: 423 });
  });

  it("detects events changed or removed after it read them", async () => {
    const store = new MemoryEventStore();
    const repo = new ProjectRepository(store, MODEL);
    await repo.append("p-x", 0, [created(), released("a"), released("b")], ACTOR, "c");
    expect(await repo.verify("p-x")).toEqual({ ok: true, checked: 3 });

    store.tamperForTest("p-x", 2, (e) => ({ ...e, correlationId: "anders" }));
    expect(await repo.verify("p-x")).toMatchObject({ ok: false, brokenAtSeq: 2 });
    expect(await repo.get("p-x")).toBeUndefined();

    // A shorter stream is still a valid chain; only the instance that saw more can tell.
    const truncated = new MemoryEventStore();
    const other = new ProjectRepository(truncated, MODEL);
    await other.append("p-y", 0, [created(), released("a")], ACTOR, "c");
    const before = await truncated.read("p-y");
    truncated.read = async () => before.slice(0, 1);
    expect(await other.verify("p-y")).toMatchObject({
      ok: false,
      brokenAtSeq: 2,
      reason: "Ereignisse fehlen oder wurden ersetzt",
    });
  });

  it("reads only new events from the store", async () => {
    const store = new MemoryEventStore();
    const repo = new ProjectRepository(store, MODEL);
    await repo.append("p-z", 0, [created()], ACTOR, "c");
    const reads: number[] = [];
    const read = store.read.bind(store);
    store.read = async (projectId, afterSeq) => {
      reads.push(afterSeq ?? 0);
      return read(projectId, afterSeq);
    };
    await store.append({
      projectId: "p-z",
      expectedSeq: 1,
      events: [released()],
      actor: ACTOR,
      correlationId: "c",
    });
    expect((await repo.get("p-z"))?.lastSeq).toBe(2);
    expect(reads).toEqual([1]);
  });
});
