# Offene Fragen

Stand: 10. Oktober 2026. Die bereits beantworteten Fragen stehen in [`target-architecture.md`](target-architecture.md), Abschnitt 1.1.

**So beantwortest du die Fragen:** Schreib deine Antwort direkt unter «Antwort:» oder antworte im Chat mit der Nummer (z. B. «F3: regional»). Wo ich eine Empfehlung habe, steht sie dabei. Wenn du mit ihr einverstanden bist, genügt «ok».

> **Achtung:** Das GitHub-Repository ist im Moment **öffentlich**. Trag hier keine vertraulichen Angaben ein (Namen, interne Systeme, Verträge), solange es nicht auf «privat» umgestellt ist (siehe F1).

**Wofür ich die Antworten brauche:**
- **Inkrement 2** (Pilotumgebung in Azure): F1 bis F8
- **Inkrement 3** (SharePoint) und **4** (Zusammenarbeit): F9 bis F15
- **Fachliche Regeln:** F16 bis F20
- **Protokollierung:** F21 bis F24
- **Betrieb der Pilotumgebung:** F25 bis F28
- **Portfolio:** F29 und F30
- **Change Requests:** F31 und F32
- **Risiken:** F33 und F34 (neu)

---

## Teil A: Für die Pilotumgebung

### F1 · Darf das Repository öffentlich bleiben?

Das Repository `RedBlueCrown/HERMES_Helfer` ist öffentlich. Alle Inhalte, auch die Architektur, diese Fragen und deine Antworten, kann jede Person im Internet sehen. Deshalb habe ich den Prototyp noch nicht hochgeladen.

- **A)** Auf «privat» umstellen (GitHub → Settings → General → Danger Zone → Change visibility). Danach lade ich den Prototyp als Referenz hoch und lösche die alten Hinweise auf die frühere Organisation aus dem Verlauf.
- **B)** Öffentlich lassen. Dann kommen nur neutrale Inhalte ins Repository.

**Meine Empfehlung:** A

**Antwort:**

---

### F2 · Wo läuft die Pilotumgebung, und wer richtet den Zugang ein?

Für den Pilot brauche ich eine Azure-Umgebung in der EU und zwei App-Registrierungen in Entra ID (eine für die Web-App, eine für die API). Das Anlegen der Registrierungen und die «Administratorzustimmung» darf meist nur die IT.

1. Gibt es schon eine Azure-Subscription bzw. «Landing Zone» in der EU, die wir nutzen dürfen? Wenn ja, in welcher Region?
2. Wer kann App-Registrierungen anlegen und die Administratorzustimmung erteilen?
3. Wer darf in Azure Ressourcen anlegen bzw. deployen (Person oder Team)?

**Antwort:**

---

### F3 · Wie streng gilt «Verarbeitung in der EU»?

Microsoft bietet zwei Varianten an:

- **A) Regional:** Die KI läuft nur in einer bestimmten EU-Region, z. B. «Schweden Mitte». Das ist die strengste und am einfachsten erklärbare Variante.
- **B) EU-Datenzone:** Die KI darf in jeder Region innerhalb der «EU Data Boundary» laufen. Laut Microsoft können dazu auch EFTA-Länder wie Norwegen und die Schweiz gehören. Diese Variante hat mehr Kapazität.

**Meine Empfehlung:** A, ausser die Kapazität reicht später nicht aus.

**Antwort:**

---

### F4 · Welches KI-Modell setzen wir ein?

Claude (Anthropic) ist in Microsoft Foundry derzeit **nicht** mit Verarbeitung in der EU verfügbar, nur weltweit oder in den USA. Das ist angekündigt, aber ohne Termin.

- **A)** GPT-Modelle über Azure OpenAI in der EU verwenden (erfüllt die EU-Vorgabe heute).
- **B)** Warten, bis Claude in Foundry in der EU verfügbar ist.
- **C)** Claude über einen anderen Anbieter mit EU-Regionen (AWS oder Google), also ausserhalb von Microsoft.

**Meine Empfehlung:** A. Die App ist so gebaut, dass sich das Modell später austauschen lässt.

**Antwort:**

---

### F5 · Wer pflegt die Projektrollen?

Jede Person hat pro Vorhaben eine oder mehrere Rollen (z. B. Projektleitung, Auftraggeber, ISM). Bei über 300 Vorhaben ergäbe eine Entra-Gruppe pro Vorhaben und Rolle rund 3000 Gruppen.

- **A)** Die Projektleitung (oder das PMO) vergibt die Rollen direkt in der App. Jede Änderung wird im Projektverlauf festgehalten. In Entra ID gibt es nur vier übergreifende Rollen (Benutzer, PMO, Portfolio-Gremium, Administration).
- **B)** Die IT pflegt pro Vorhaben und Rolle eine Entra-Gruppe, und die App liest diese aus. Rollenänderungen laufen dann über die IT.

**Meine Empfehlung:** A

**Antwort:**

---

### F6 · Stimmen die Rollen so?

In der App gibt es diese Projektrollen:

| Kürzel | Rolle |
|---|---|
| PL | Projektleitung |
| BC | Business Analyse / Business Consulting |
| PA | Auftraggeber / Projektausschuss |
| FACH | Fachvertretung |
| TEST | Testverantwortung |
| ISM | Informationssicherheit |
| DS | Datenschutz |
| ARCH | Architektur (inkl. Entwicklung) |
| APM | Applikationsmanagement / Betrieb |
| INFRA | Infrastruktur / Technische Koordination |

Übergreifend kommen dazu: **PMO** (sieht alle Vorhaben, legt Vorhaben an) und **Portfolio-Gremium** (sieht alle Vorhaben, entscheidet die Projektfreigabe).

1. Sind ISM und Datenschutz bei euch verschiedene Personen? Im Prototyp waren sie eine Rolle, die Freigaben laufen aber getrennt.
2. Sind Auftraggeber und Projektausschuss für die App dieselbe Rolle?
3. Wer gehört zum PMO, wer zum Portfolio-Gremium? Bitte Funktionen statt Namen nennen, solange das Repository öffentlich ist.
4. Fehlt eine Rolle?

**Antwort:**

---

### F7 · Wer erfasst die Entscheide des Projektausschusses?

Der Projektausschuss entscheidet meist in einer Sitzung.

- **A)** Eine Person (z. B. der Vorsitz) erfasst den Entscheid in der App und bestätigt «Konsent festgestellt», wie im Prototyp.
- **B)** Jedes Mitglied gibt einzeln in der App frei.

**Meine Empfehlung:** A

**Antwort:**

---

### F8 · Mit welchen Vorhaben und Personen starten wir den Pilot?

1. Welche ein bis zwei Vorhaben eignen sich, und in welcher Phase sind sie?
2. Welche Rollen sind dabei (Projektleitung, Auftraggeber, ISM, Datenschutz, Fachvertretung …)? Bitte wieder Funktionen statt Namen.
3. Gibt es einen gewünschten Zeitraum?

**Antwort:**

---

## Teil B: Ablage und Integrationen

### F9 · Wo liegen die Projektunterlagen heute, und wo ist die Liste aller Vorhaben?

1. Haben die über 300 Vorhaben schon eigene SharePoint-Sites oder Teams? Soll die App bestehende Sites **verknüpfen** oder **neue anlegen**?
2. Wo ist heute die Liste aller Vorhaben (z. B. Excel, ein Portfolio-Tool)? Diese Liste würde ich als Ausgangsbestand importieren.
3. Gibt es eine Projektnummer oder ein Projektkürzel (z. B. «P-2026-014»)?

**Antwort:**

---

### F10 · Wer darf neue Vorhaben anlegen?

- **A)** Nur das PMO
- **B)** Auch Projektleitende, mit Freigabe durch das PMO

**Meine Empfehlung:** A für den Pilot

**Antwort:**

---

### F11 · Ressourcen- und Portfolioplanung

Der Prototyp erwähnt, dass der Ressourcenbedarf für ein Planungswerkzeug (z. B. Meisterplan) aufbereitet wird.

1. Welches Werkzeug nutzt ihr für Ressourcen- und Portfolioplanung?
2. Hat es eine Schnittstelle (API)?
3. Welche Daten sollen fliessen, z. B. Phase und Ampel vom HERMES Helfer dorthin, oder Budget und Termine von dort hierher?

**Antwort:**

---

### F12 · Bestellungen bei der Infrastruktur

Die Technische Koordination bestellt Server, Firewall-Regeln und Berechtigungen. Über welches Ticketsystem läuft das (z. B. ServiceNow, Jira Service Management, ein anderes)?

**Antwort:**

---

### F13 · Entwicklung und Tests

Wo werden Backlog, Code und Testläufe geführt (z. B. Azure DevOps, Jira, GitHub)? Später sollen Release-Stand und Testergebnisse automatisch in die Lieferergebnisse einfliessen.

**Antwort:**

---

### F14 · Teams-Besprechungen und Transkripte

Der Protokoll-Agent soll aus Besprechungen Entscheide, Aufgaben und offene Fragen ableiten.

1. Ist die Transkription in Teams bei euch eingeschaltet und erlaubt?
2. Dürfen Transkripte von Projektbesprechungen von der App gelesen werden?
3. Wie werden die Teilnehmenden heute darüber informiert?

**Antwort:**

---

### F15 · Benachrichtigungen

Wie sollen Personen erfahren, dass etwas auf sie wartet (z. B. eine Freigabe)?

- **A)** In Teams (Aktivitätsfeed und eine tägliche Zusammenfassung)
- **B)** Per E-Mail
- **C)** Beides

**Meine Empfehlung:** A

**Antwort:**

---

## Teil C: Fachliche Regeln

### F16 · «Nicht zutreffend» bei Pflichtergebnissen

Heute darf die Projektleitung nur **situative** Ergebnisse mit Begründung als «nicht zutreffend» markieren (wie im Prototyp). Pflichtergebnisse können nicht abgewählt werden.

- **A)** So lassen
- **B)** Pflichtergebnisse dürfen abgewählt werden, wenn der Projektausschuss zustimmt
- **C)** Andere Regel

**Meine Empfehlung:** A für den Pilot

**Antwort:**

---

### F17 · Szenarien und Projektkategorien

Der Prototyp verweist auf ein Excel «Szenarien-Ergebnis-Mapping» je Projektkategorie und Szenario. Es legt fest, welche Ergebnisse pro Vorhaben verlangt sind.

1. Kannst du mir dieses Excel geben?
2. Sollen mehrere Szenarien in der App abgebildet werden (z. B. Standardsoftware, Eigenentwicklung, agil)?

**Antwort:**

---

### F18 · Phase «Skalierung»

Die Phase «Skalierung» ist eine Ergänzung des Prototyps und nicht Teil von HERMES. Soll sie in der App bleiben?

**Antwort:**

---

### F19 · Vorlagen, Handbuch und Pattern-Katalog

Die Unterlagen gibt es bereits (bis dahin arbeite ich mit Platzhaltern).

1. In welchem Format liegen sie vor (Word-Vorlagen .dotx, PDF, Excel)?
2. Wer pflegt sie, und wer gibt neue Versionen frei?
3. Wo liegt der Katalog der Architektur-Patterns?

**Antwort:** 1. Word-Vorlagen (10. Oktober 2026). Offen sind noch 2 und 3.

---

### F20 · Sprache

Ist die App nur auf Deutsch? Gilt die Schweizer Rechtschreibung (ss statt ß), wie im Prototyp?

**Antwort:**

---

## Teil D: Protokollierung

Du hast nach meinen Vorschlägen gefragt. Hier sind sie zur Bestätigung. Die Begründung steht in `target-architecture.md`, Abschnitt 9.6.

### F21 · Aufbewahrungsfristen

| Was | Vorschlag |
|---|---|
| Projektakte (Entscheide, Freigaben, Rollenänderungen) | Laufzeit des Vorhabens plus 10 Jahre |
| Entwurfsversionen (KI und Mensch) | wie das Ergebnis selbst |
| Angaben zu KI-Läufen (wer, welcher Agent, welches Modell, Dauer) | 2 Jahre |
| Inhalt der KI-Anfragen und -Antworten | 90 Tage |
| Chatverlauf mit dem Assistenten | 90 Tage, durch die Person selbst löschbar |
| Sicherheitsprotokolle (Anmeldungen, Admin-Aktionen) | 1 Jahr, privilegierte Aktionen 2 Jahre |
| Technische Fehlerprotokolle | 30 Tage |

Einverstanden, oder gibt es Vorgaben (z. B. ein Archivierungsreglement)?

**Antwort:**

---

### F22 · Wer darf die Inhalte der KI-Anfragen einsehen?

Vorschlag: niemand im Alltag. Nur bei einem Vorfall oder einer Beschwerde, und nur zu zweit (Informationssicherheit **und** Datenschutz). Jeder Zugriff wird protokolliert.

**Antwort:**

---

### F23 · Keine Leistungsüberwachung

Der Projektverlauf zeigt, wer was entschieden hat. Das dient der Nachvollziehbarkeit, nicht der Beurteilung von Mitarbeitenden. Es gibt keine Auswertungen pro Person. Je nach Standort gelten dafür besondere Regeln (in der Schweiz Art. 26 ArGV 3, in Deutschland die Mitbestimmung des Betriebsrats).

1. Ist das für dich so in Ordnung?
2. Wer bei HR oder Recht sollte das bestätigen?

**Antwort:**

---

### F24 · Sicherheitsüberwachung

1. Ist Microsoft Sentinel (oder ein anderes SIEM) im Einsatz?
2. Wer überwacht die Sicherheitsmeldungen (internes Team oder externer Dienstleister)?

**Antwort:**

---

## Teil E: Betrieb der Pilotumgebung

Diese Fragen sind beim Bau der Azure-Vorlagen dazugekommen. Was die Vorlagen anlegen, steht in [`deployment.md`](deployment.md).

### F25 · Von wo aus soll der HERMES Helfer erreichbar sein?

- **A)** Aus dem Internet, aber nur mit Entra-Anmeldung (MFA über Conditional Access). Zusätzlich lässt sich der Zugriff auf die Internet-Adressen der Firma beschränken.
- **B)** Nur aus dem Firmennetz oder über VPN. Dafür muss das Azure-Netz mit dem Firmennetz verbunden sein (meist über die «Landing Zone» der IT).

**Meine Empfehlung:** A mit Beschränkung auf die Firmen-Adressen für den Pilot. Für den produktiven Betrieb kommt eine Web Application Firewall (Front Door) davor.

Falls A mit Beschränkung: Welche öffentlichen IP-Adressbereiche nutzt die Firma? (Die IT kennt sie.)

**Antwort:**

---

### F26 · Welche Gruppen erhalten welche Rolle?

Die App kennt vier übergreifende Rollen: **Nutzung** (alle, die mitarbeiten), **PMO**, **Portfolio-Gremium** und **technische Administration**. Die IT weist jeder Rolle eine Entra-ID-Gruppe zu. Wer in keiner dieser Gruppen ist, kann sich nicht anmelden. Die Rollen im einzelnen Vorhaben (PL, ISM usw.) vergibt die Projektleitung in der App.

Welche Gruppen sollen es sein? Die Namen genügen. Die technischen IDs gehören nicht in dieses Dokument, solange das Repository öffentlich ist.

**Antwort:**

---

### F27 · Wer verwaltet die Datenbank?

Im Normalbetrieb hat kein Mensch Zugriff auf die Daten: Nur das Migrationsprogramm ist Administrator, und die App darf Ereignisse nur lesen und anhängen. Für Notfälle und für die regelmässige Prüfung der Datenbank («Ledger») braucht es trotzdem eine Gruppe von Personen.

1. Welche Rolle gehört in diese Gruppe (z. B. Datenbank-Team der IT)?
2. Wer prüft den Ledger, und wie oft?

**Meine Empfehlung:** eine Gruppe «HERMES Helfer DB-Admins», die nur zeitlich begrenzt und mit Begründung freigeschaltet wird (Privileged Identity Management, Genehmigung durch die Informationssicherheit). Die Informationssicherheit prüft den Ledger monatlich.

**Antwort:**

---

### F28 · Wie lange müssen die Prüfwerte der Datenbank gesperrt bleiben?

Die Datenbank legt regelmässig einen Prüfwert («Digest») in einem unveränderlichen Speicher ab. Damit lässt sich später beweisen, dass niemand die Projektakte verändert hat. Die Sperrfrist ist im Moment **10 Jahre**. Sobald die Frist «gesperrt» ist, lässt sie sich nur noch verlängern, nie verkürzen.

**Meine Empfehlung:** 10 Jahre, passend zur Aufbewahrung der Projektakte (F21). Falls dort eine längere Frist herauskommt, verlängern wir.

**Antwort:**

---

## Teil F: Portfolio

Die erste Version der Portfolio-Seite ist gebaut. PMO und Portfolio-Gremium sehen alle Vorhaben, alle anderen ihre eigenen. Die Seite zählt Vorhaben pro Phase und Gate-Status, markiert Vorhaben mit Handlungsbedarf, und jede Zahl führt mit einem Klick zu den Vorhaben dahinter. Beschreibung in [`target-architecture.md`](target-architecture.md), Abschnitt 7.1.

### F29 · Woran erkennt das Portfolio Handlungsbedarf?

Heute gelten diese Signale:

| Signal | Regel | Dringlichkeit |
|---|---|---|
| Veto offen | Ein Entscheid mit Veto zu einem Pflichtergebnis (z. B. ISDS, Go-live) ist offen, das Gate ist blockiert. | hoch |
| Auflagen überfällig | Eine Auflage ist nach ihrer Frist noch offen. | hoch |
| Neuprüfung offen | Ein angenommener Change Request betrifft Personendaten; SchuBAn, ISDS und DSFA werden neu geprüft, das Gate bleibt bis dahin zu. | mittel |
| Gate zurückgewiesen | Der letzte Gate-Entscheid der aktuellen Phase lautet «zurückgewiesen». | mittel |
| Rollen unbesetzt | Eine Rolle, die in der aktuellen Phase entscheidet, hat im Vorhaben niemand. | mittel |
| Hohe Risiken | Mindestens ein offenes Risiko mit Eintritt mal Auswirkung 6 oder mehr (siehe F33). | mittel |
| Ohne Aktivität | Seit 30 Tagen kein neuer Eintrag in der Projektakte. | mittel |
| Change Request offen | Ein Change Request wartet auf den Entscheid des Projektausschusses. | Hinweis |
| Gate-Entscheid fällig | Alle Kriterien sind erfüllt, das Gate wartet auf den Entscheid. | Hinweis |

1. Stimmen diese Signale und ihre Dringlichkeit?
2. Nach wie vielen Tagen ohne Eintrag gilt ein Vorhaben als inaktiv?
3. Welche Angaben fehlen dem Portfolio-Gremium, z. B. Budget, Termine oder die Ampel aus dem Statusbericht? Diese Daten führt die App heute nicht. Sie kämen aus der Portfolioplanung (F11) oder aus einem späteren Statusbericht.
4. Das Portfolio zählt pro Vorhaben, nie pro Person: Es gibt keine Auswertung, keinen Filter und keine Rangliste nach Projektleitung (siehe F23). Einverstanden?

**Meine Empfehlung:** Die Signale so für den Pilot, 30 Tage, Zahlen nur pro Vorhaben.

**Antwort:**

---

### F30 · Fristen von Auflagen

Wer «mit Auflagen» entscheidet, wählt heute eine von drei Fristen. Die App rechnet daraus die Fälligkeit und zeigt überfällige Auflagen im Vorhaben und im Portfolio:

- **«1 Woche», «2 Wochen»:** ab dem Entscheid gerechnet.
- **«bis zum nächsten Gate»:** Eine Auflage aus einem Gate-Entscheid ist am Gate der folgenden Phase fällig, eine Auflage aus einem Entscheid zu einem Ergebnis am Gate derselben Phase. Sie ist überfällig, sobald dieses Gate passiert ist.

1. Reichen die drei Fristen, oder soll man ein Datum wählen können?
2. Ein Gate lässt sich heute auch passieren, wenn Auflagen offen sind, die bis zu diesem Gate fällig sind. Sie gelten dann als überfällig. Soll eine solche Auflage das Gate stattdessen blockieren?
3. Sollen die Verantwortlichen vor Ablauf der Frist erinnert werden (siehe F15)?

**Meine Empfehlung:** 1. Ein Datum wählen können, die drei Fristen bleiben als Vorschläge. 2. Nicht blockieren, aber beim Gate-Entscheid die offenen Auflagen bestätigen lassen. 3. Ja, drei Tage vorher in Teams.

**Antwort:**

---

## Teil G: Change Requests

Change Requests sind gebaut, wie im Prototyp: Ein Mitglied des Vorhabens beschreibt den Wunsch, der Change-Request-Agent arbeitet ihn aus, das Team schätzt den Aufwand, der HERMES Helfer rechnet die Auswirkungen in acht Bereichen, und der Projektausschuss entscheidet mit Konsent. Betrifft eine Änderung Personendaten, prüfen ISM und Datenschutz SchuBAn, ISDS-Konzept und DSFA neu; bis dahin bleibt das Gate zu. Beschreibung in [`target-architecture.md`](target-architecture.md), Abschnitt 5.5.

### F31 · Kosten und Reserve

1. Die Kosten rechnet die App mit **1'200 CHF pro Personentag** (Wert aus dem Prototyp). Welcher Ansatz gilt bei euch? Gibt es verschiedene Ansätze, zum Beispiel intern und extern?
2. Die **Reserve für Änderungen** erfasst die Projektleitung gemäss Projektauftrag. Ist das so richtig, oder kommt die Reserve aus einem anderen System (siehe F11)?
3. Ein Change Request ohne Reserve oder über der Reserve gilt beim Budget als «hohe Auswirkung». Passt diese Regel?

**Meine Empfehlung:** Ein Ansatz für den Pilot, die Reserve erfasst die Projektleitung.

**Antwort:**

---

### F32 · Wer erfasst, wer entscheidet?

1. Heute darf jedes Mitglied des Vorhabens einen Change Request erfassen. Soll das so bleiben, oder erfasst immer die Projektleitung?
2. Heute entscheidet der Projektausschuss jeden Change Request. Soll ab einer Grösse (zum Beispiel über der Reserve) das Portfolio-Gremium mitentscheiden?
3. Die Neuprüfung nach einer Änderung an Personendaten bestätigen ISM und Datenschutz je einzeln. Reicht das, oder braucht es dafür einen eigenen Entscheid mit Begründung?

**Meine Empfehlung:** 1. alle Mitglieder; 2. ab Überschreiten der Reserve zusätzlich das Portfolio-Gremium; 3. so lassen.

**Antwort:**

---

## Teil H: Risiken

Das Risikoregister ist gebaut, wie im Prototyp: Jedes Mitglied des Vorhabens erfasst Risiken mit Eintritt und Auswirkung (je niedrig, mittel oder hoch), einer verantwortlichen Rolle und einer Massnahme. Die Projektleitung lässt den Risiko-Agenten das Register prüfen; er schlägt anhand des Projektstands neue Risiken und neue Beurteilungen vor, und die Projektleitung entscheidet, was sie übernimmt. Beschreibung in [`target-architecture.md`](target-architecture.md), Abschnitt 5.6.

### F33 · Bewertung von Risiken

1. Die App bewertet ein Risiko mit **Eintritt mal Auswirkung** auf einer Skala von 1 bis 3 (Werte aus dem Prototyp). Ab **6** gilt ein Risiko als hoch, ab **3** als mittel. Verwendet ihr eine andere Skala, zum Beispiel 1 bis 5 oder Beträge in CHF?
2. Bei einem hohen Risiko erhält die verantwortliche Rolle eine Aufgabe, bis jemand die Massnahme in Bearbeitung nimmt. Hohe Risiken erscheinen im Portfolio (F29) und beim Gate-Entscheid als Hinweis, blockieren das Gate aber nicht. Passt das?
3. Wie oft soll das Register geprüft werden? Heute prüft der Risiko-Agent nur, wenn die Projektleitung ihn anstösst. Möglich wäre eine wöchentliche Prüfung mit einer Meldung an die Projektleitung (siehe F15).

**Meine Empfehlung:** 1. die Skala aus dem Prototyp für den Pilot; 2. so lassen; 3. wöchentlich, sobald die Benachrichtigungen gebaut sind.

**Antwort:**

---

### F34 · Wer sieht und bearbeitet Risiken?

1. Heute sehen alle Mitglieder eines Vorhabens sowie PMO und Portfolio-Gremium das ganze Register. Gibt es Risiken, die nur ein Teil sehen darf, zum Beispiel zu Personen, Lieferantenverträgen oder Sicherheitslücken?
2. Heute erfasst jedes Mitglied Risiken; beurteilen und schliessen dürfen die Projektleitung und die verantwortliche Rolle. Soll das so bleiben?
3. Die Texte des Registers gehen als Hintergrund an das KI-Modell, wenn ein Agent einen Entwurf schreibt (zum Beispiel den Abschnitt «Risiken» der Projektgrundlagen). Einverstanden?

**Meine Empfehlung:** 1. alle Mitglieder; heikle Sicherheitsrisiken gehören ins ISDS-Konzept, das nur berechtigte Rollen sehen. 2. so lassen. 3. ja.

**Antwort:**
