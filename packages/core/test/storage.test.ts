import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORAGE_HOSTS,
  MAX_STORAGE_URL,
  MODEL,
  PROJECT_ROLES,
  checkSetDocumentStorage,
  describeEvent,
  eventCategory,
  projectView,
  storageHostAllowed,
  storageLinkHost,
  validateStorageLink,
  withPolicy,
} from "../src";
import { Stream, completeMandatory, viewer } from "./helpers";

const SITE =
  "https://muster.sharepoint.com/sites/KPO/Freigegebene%20Dokumente/Forms/AllItems.aspx?id=%2Fsites%2FKPO%2FProjekt";
const SHARED = "https://muster-my.sharepoint.com/:f:/g/personal/anna_muster_ch/EjB4kLm?e=AbC12d";
const ONEDRIVE = "https://1drv.ms/f/c/1a2b3c4d5e6f7a8b/EjB4kLmNoPq?e=AbC12d";
const PRACTICE = [...DEFAULT_STORAGE_HOSTS, "onedrive.live.com", "1drv.ms"];

describe("the link to the Projektablage", () => {
  it("accepts folders on the organisation's SharePoint and refuses other places", () => {
    expect(validateStorageLink(SITE, DEFAULT_STORAGE_HOSTS)).toBeUndefined();
    expect(validateStorageLink(SHARED, DEFAULT_STORAGE_HOSTS)).toBeUndefined();
    // A private OneDrive only where the organisation allows it (the test environment).
    expect(validateStorageLink(ONEDRIVE, DEFAULT_STORAGE_HOSTS)).toContain("«1drv.ms» sind hier nicht");
    expect(validateStorageLink(ONEDRIVE, PRACTICE)).toBeUndefined();
    expect(validateStorageLink("https://onedrive.live.com/?id=ABC%21123&cid=ABC", PRACTICE)).toBeUndefined();
    // Empty: the link is removed.
    expect(validateStorageLink("", DEFAULT_STORAGE_HOSTS)).toBeUndefined();
  });

  it("refuses look-alike hosts, other schemes and links a browser reads differently", () => {
    const refused = [
      "http://muster.sharepoint.com/sites/KPO",
      "javascript:alert(1)//muster.sharepoint.com",
      "muster.sharepoint.com/sites/KPO",
      "https://sharepoint.com/sites/KPO",
      "https://evilsharepoint.com/sites/KPO",
      "https://muster.sharepoint.com.example.net/sites/KPO",
      "https://example.net@muster.sharepoint.com/sites/KPO",
      "https://muster.sharepoint.com@example.net/sites/KPO",
      "https://muster.sharepoint.com:8443/sites/KPO",
      "https://muster.sharepoint.com\\@example.net/",
      "https://muster.sharepoint.com/sites/K PO",
      "https://muster.sharepoint.com/sites/KPO\n",
      "https://müster.sharepoint.com/sites/KPO",
      `https://muster.sharepoint.com/${"a".repeat(MAX_STORAGE_URL)}`,
    ];
    for (const url of refused) expect(validateStorageLink(url, DEFAULT_STORAGE_HOSTS), url).toBeDefined();
    expect(validateStorageLink("muster.sharepoint.com/sites/KPO", DEFAULT_STORAGE_HOSTS)).toContain(
      "https://",
    );
  });

  it("matches hosts without regard to case; «*.» stands for the hosts below a domain only", () => {
    expect(storageHostAllowed("Muster.SharePoint.com", ["*.sharepoint.com"])).toBe(true);
    expect(storageHostAllowed("sharepoint.com", ["*.sharepoint.com"])).toBe(false);
    expect(storageHostAllowed("1drv.ms", [" 1DRV.ms "])).toBe(true);
    expect(storageHostAllowed("x.1drv.ms", ["1drv.ms"])).toBe(false);
    expect(storageLinkHost("https://MUSTER.sharepoint.com/sites/KPO")).toBe("muster.sharepoint.com");
    expect(storageLinkHost("https://muster.sharepoint.com:443/")).toBeUndefined();
  });
});

describe("the Projektablage of a project", () => {
  const team = () => new Stream("init").member("anna", "PL").member("nina", "FACH");

  it("is set and removed by the PL or the PMO, and shown to everyone who sees the project", () => {
    const st = team();
    const s0 = st.state();
    expect(checkSetDocumentStorage(s0, MODEL, viewer("anna")).ok).toBe(true);
    expect(checkSetDocumentStorage(s0, MODEL, viewer("peter", "HH.PMO")).ok).toBe(true);
    expect(checkSetDocumentStorage(s0, MODEL, viewer("nina"))).toMatchObject({ code: "forbidden" });
    expect(checkSetDocumentStorage(s0, MODEL, viewer("pia", "HH.Portfolio"))).toMatchObject({
      code: "forbidden",
    });
    expect(projectView(s0, MODEL, viewer("anna")).storage).toEqual({
      canSet: { ok: true },
      hosts: DEFAULT_STORAGE_HOSTS,
    });

    st.add({ type: "DocumentStorageSet", data: { url: SITE } });
    const v = projectView(st.state(), MODEL, viewer("nina"));
    expect(v.storage.link).toMatchObject({
      url: SITE,
      host: "muster.sharepoint.com",
      by: { userId: "system" },
    });
    expect(v.storage.canSet.ok).toBe(false);

    st.add({ type: "DocumentStorageSet", data: { url: "" } });
    expect(st.state().storage).toBeUndefined();
    expect(projectView(st.state(), MODEL, viewer("anna")).storage.link).toBeUndefined();
  });

  it("names the host in the Verlauf, not the folder's path", () => {
    const st = team()
      .add({ type: "DocumentStorageSet", data: { url: SHARED } })
      .add({ type: "DocumentStorageSet", data: { url: "" } });
    const [set, removed] = st.events.slice(-2);
    expect(describeEvent(set!, MODEL)).toBe("Projektablage verknüpft (muster-my.sharepoint.com).");
    expect(describeEvent(removed!, MODEL)).toBe("Projektablage entfernt.");
    expect(eventCategory(set!)).toBe("vorhaben");
  });

  it("stays as it is once the project is finished", () => {
    const st = new Stream("skal").member("anna", ...PROJECT_ROLES);
    completeMandatory(st, "skal");
    st.add({
      type: "GateDecisionRecorded",
      data: { phase: "skal", decision: "freigegeben", reason: "ok", konsent: true, conditions: [] },
    });
    expect(checkSetDocumentStorage(st.state(), MODEL, viewer("anna"))).toMatchObject({
      code: "invalid_state",
    });
  });

  it("takes the allowed hosts from the policy; other rules stay as they are", () => {
    const relaxed = withPolicy(MODEL, { separationOfDuties: false });
    expect(relaxed.policy.documentStorageHosts).toEqual(DEFAULT_STORAGE_HOSTS);
    const practice = withPolicy(relaxed, { documentStorageHosts: PRACTICE });
    expect(practice.policy).toEqual({ separationOfDuties: false, documentStorageHosts: PRACTICE });
    expect(projectView(new Stream().state(), practice, viewer("peter", "HH.PMO")).storage.hosts).toEqual(
      PRACTICE,
    );
  });
});
