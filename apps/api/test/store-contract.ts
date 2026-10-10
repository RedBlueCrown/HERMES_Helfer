// Behaviour every event store must have, and how the repository uses it.
// Runs against the memory store always and against SQL Server when
// TEST_SQL_SERVER is set (see sql-store.test.ts).

import { MODEL, type Actor, type ProjectEvent } from "@hermes-helfer/core";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { HttpError } from "../src/errors";
import { ProjectRepository } from "../src/projects/repository";
import { ConcurrencyError, verifyChain, type EventStore } from "../src/store/event-store";

export const ACTOR: Actor = { userId: "u-test", displayName: "Test", roles: ["PL"], channel: "web" };

export function created(code = "T1", name = "Test"): ProjectEvent {
  return {
    type: "ProjectCreated",
    data: {
      code,
      name,
      description: "",
      phase: "init",
      modelVersion: "x",
      profile: {
        schutzbedarf: "mittel",
        personendaten: false,
        cloud: false,
        schnittstellen: 0,
        lieferant: false,
        verfuegbarkeit: "mittel",
        neueTechnologie: false,
        externeNutzende: false,
      },
    },
  };
}

export const released = (deliverableId = "kickoff"): ProjectEvent => ({
  type: "DeliverableReleased",
  data: { deliverableId },
});

/** A fresh project id per test, so tests can share one database. */
export const newProjectId = () => `p-t${randomUUID().slice(0, 13)}`;

export function eventStoreContract(store: () => EventStore): void {
  const create = (projectId: string, events: ProjectEvent[] = [created()]) =>
    store().append({ projectId, expectedSeq: 0, events, actor: ACTOR, correlationId: "c-create" });

  it("starts a stream with ProjectCreated and chains the hashes", async () => {
    const id = newProjectId();
    const first = await create(id);
    expect(first.map((e) => e.seq)).toEqual([1]);
    const next = await store().append({
      projectId: id,
      expectedSeq: 1,
      events: [released("a"), released("b")],
      actor: ACTOR,
      correlationId: "c-2",
    });
    expect(next.map((e) => e.seq)).toEqual([2, 3]);
    const events = await store().read(id);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events[1]!.prevHash).toBe(events[0]!.hash);
    expect(verifyChain(events)).toEqual({ ok: true, checked: 3 });
    expect(events[2]).toEqual(next[1]);
  });

  it("reads only events after a given sequence number", async () => {
    const id = newProjectId();
    await create(id, [created(), released("a"), released("b"), released("c")]);
    expect((await store().read(id, 2)).map((e) => e.seq)).toEqual([3, 4]);
    expect(await store().read(id, 4)).toEqual([]);
    expect(await store().read(newProjectId())).toEqual([]);
  });

  it("refuses a write based on an outdated sequence number", async () => {
    const id = newProjectId();
    await create(id);
    const write = (expectedSeq: number) =>
      store().append({ projectId: id, expectedSeq, events: [released()], actor: ACTOR, correlationId: "c" });
    await write(1);
    await expect(write(1)).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(write(0)).rejects.toBeInstanceOf(ConcurrencyError);
    expect(await store().read(id)).toHaveLength(2);
  });

  it("lets exactly one of two parallel writers win", async () => {
    const id = newProjectId();
    await create(id);
    const results = await Promise.allSettled(
      ["a", "b"].map((d) =>
        store().append({
          projectId: id,
          expectedSeq: 1,
          events: [released(d)],
          actor: ACTOR,
          correlationId: "c",
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect((failed as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyError);
    expect(verifyChain(await store().read(id)).ok).toBe(true);
  });

  it("lets exactly one of two parallel creators of the same project win", async () => {
    const id = newProjectId();
    const results = await Promise.allSettled([create(id, [created("A")]), create(id, [created("B")])]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await store().read(id)).toHaveLength(1);
  });

  it("refuses a new stream that does not start with ProjectCreated, and empty writes", async () => {
    const id = newProjectId();
    await expect(create(id, [released()])).rejects.toThrow(/ProjectCreated/);
    await expect(create(id, [])).rejects.toThrow(/Nothing to append/);
    expect(await store().read(id)).toEqual([]);
  });

  it("reports the head of every stream", async () => {
    const a = newProjectId();
    const b = newProjectId();
    await create(a, [created(), released()]);
    await create(b);
    const heads = (await store().heads()).filter((h) => h.projectId === a || h.projectId === b);
    expect(heads.sort((x, y) => x.projectId.localeCompare(y.projectId))).toEqual(
      [
        { projectId: a, lastSeq: 2 },
        { projectId: b, lastSeq: 1 },
      ].sort((x, y) => x.projectId.localeCompare(y.projectId)),
    );
  });

  it("keeps content exactly: umlauts, emoji, quotes, line breaks and long text", async () => {
    const id = newProjectId();
    const name = `Grüezi «Projekt» "Ä/Ö/Ü" ß 😀 \\ \n\t${"Lorem ipsum ".repeat(20_000)}`;
    await create(id, [created("T1", name)]);
    const [e] = await store().read(id);
    expect(e!.type === "ProjectCreated" && e!.data.name).toBe(name);
    expect(verifyChain([e!]).ok).toBe(true);
  });

  it("appends a large batch in one write", async () => {
    const id = newProjectId();
    const many = Array.from({ length: 250 }, (_, i) => released(`d${i}`));
    await create(id, [created(), ...many]);
    const events = await store().read(id);
    expect(events).toHaveLength(251);
    expect(verifyChain(events).ok).toBe(true);
  });

  it("returns frozen events", async () => {
    const id = newProjectId();
    await create(id);
    const [e] = await store().read(id);
    expect(() => {
      (e as { seq: number }).seq = 99;
    }).toThrow(TypeError);
  });
}

/** Two API instances on one store: each sees the other's writes, and conflicts are refused. */
export function sharedStoreContract(store: () => EventStore): void {
  const code = () => `T${randomUUID().slice(0, 8)}`.toUpperCase();

  it("lets one instance see the projects and events another one wrote", async () => {
    const a = new ProjectRepository(store(), MODEL);
    const b = new ProjectRepository(store(), MODEL);
    const c = code();
    const projectId = `p-${c.toLowerCase()}`;
    await a.append(projectId, 0, [created(c)], ACTOR, "c-a");
    expect((await b.findByCode(c))?.lastSeq).toBe(1);
    expect((await b.all()).some((s) => s.code === c)).toBe(true);

    await b.append(projectId, 1, [released()], ACTOR, "c-b");
    const seenByA = await a.get(projectId);
    expect(seenByA?.lastSeq).toBe(2);
    expect(seenByA?.released["kickoff"]).toBeDefined();
  });

  it("catches up when it writes ahead of its cache, instead of seeing a gap", async () => {
    const corrupt: string[] = [];
    const a = new ProjectRepository(store(), MODEL);
    const b = new ProjectRepository(store(), MODEL, { onCorruptProject: (id) => corrupt.push(id) });
    const c = code();
    const projectId = `p-${c.toLowerCase()}`;
    await a.append(projectId, 0, [created(c)], ACTOR, "c-a");
    await b.get(projectId);
    await a.append(projectId, 1, [released("a")], ACTOR, "c-a");
    // b has seen event 1 only, but writes after event 2.
    await b.append(projectId, 2, [released("b")], ACTOR, "c-b");
    expect(corrupt).toEqual([]);
    expect((await b.get(projectId))?.lastSeq).toBe(3);
  });

  it("refuses a write from an instance that has not seen the latest event", async () => {
    const a = new ProjectRepository(store(), MODEL);
    const b = new ProjectRepository(store(), MODEL);
    const c = code();
    const projectId = `p-${c.toLowerCase()}`;
    await a.append(projectId, 0, [created(c)], ACTOR, "c-a");
    await b.get(projectId);
    await a.append(projectId, 1, [released("a")], ACTOR, "c-a");
    const stale = b.append(projectId, 1, [released("b")], ACTOR, "c-b");
    await expect(stale).rejects.toBeInstanceOf(HttpError);
    await expect(stale).rejects.toMatchObject({ status: 409, code: "conflict" });
    expect((await b.get(projectId))?.lastSeq).toBe(2);
  });
}
