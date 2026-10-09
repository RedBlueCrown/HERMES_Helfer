import type { DevUser } from "../auth";

/** Fictional people for local development only (todo-later P04). */
export const DEV_USERS: readonly DevUser[] = [
  {
    id: "u-anna",
    displayName: "Anna Keller",
    upn: "anna.keller@muster-ag.example",
    globalRoles: ["HH.User"],
    description: "Projektleiterin (Kundenportal, CRM, Intranet)",
  },
  {
    id: "u-jonas",
    displayName: "Jonas Wyss",
    upn: "jonas.wyss@muster-ag.example",
    globalRoles: ["HH.User"],
    description: "Projektleiter (ERP, Datenplattform), Business Analyse",
  },
  {
    id: "u-thomas",
    displayName: "Thomas Meier",
    upn: "thomas.meier@muster-ag.example",
    globalRoles: ["HH.User"],
    description: "Auftraggeber / Projektausschuss",
  },
  {
    id: "u-nina",
    displayName: "Nina Huber",
    upn: "nina.huber@muster-ag.example",
    globalRoles: ["HH.User"],
    description: "Fachvertretung",
  },
  {
    id: "u-marco",
    displayName: "Marco Bianchi",
    upn: "marco.bianchi@muster-ag.example",
    globalRoles: ["HH.User"],
    description: "Informationssicherheit (ISM)",
  },
  {
    id: "u-sandra",
    displayName: "Sandra Roth",
    upn: "sandra.roth@muster-ag.example",
    globalRoles: ["HH.User"],
    description: "Datenschutz",
  },
  {
    id: "u-david",
    displayName: "David Weber",
    upn: "david.weber@muster-ag.example",
    globalRoles: ["HH.User"],
    description: "Architektur",
  },
  {
    id: "u-laura",
    displayName: "Laura Steiner",
    upn: "laura.steiner@muster-ag.example",
    globalRoles: ["HH.User"],
    description: "Applikationsmanagement",
  },
  {
    id: "u-tim",
    displayName: "Tim Brunner",
    upn: "tim.brunner@muster-ag.example",
    globalRoles: ["HH.User"],
    description: "Testverantwortung, Infrastruktur",
  },
  {
    id: "u-peter",
    displayName: "Peter Graf",
    upn: "peter.graf@muster-ag.example",
    globalRoles: ["HH.User", "HH.PMO"],
    description: "PMO, sieht alle Vorhaben",
  },
  {
    id: "u-rita",
    displayName: "Rita Vogel",
    upn: "rita.vogel@muster-ag.example",
    globalRoles: ["HH.User", "HH.Portfolio"],
    description: "Portfolio-Gremium, sieht alle Vorhaben",
  },
];
