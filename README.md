# V60.7 – privates Blob-Tracking ohne weitere Eingabe

Aktueller Stand: **V60.7**. Die schnelle V60.4-Buchung bleibt erhalten. Nach erfolgreicher Buchung wird ausschließlich ein minimierter Statistikdatensatz in den bereits verbundenen privaten Vercel Blob Store geschrieben. Es gibt **kein Passwortfeld** und keine `TRACKING_ADMIN_KEY`-/`TRACKING_RETENTION_DAYS`-Variable mehr.

Geheime Auswertungs-URL:

`/praxis-auswertung#k=<GEHEIMER-SCHLÜSSEL>`

Die Seite lädt automatisch, zeigt die vollständige URL zum Kopieren und bietet CSV-Export. Die URL selbst ist der Zugangsschlüssel. Speicherdauer: 180 Tage. Details: `V60_7_BLOB_TRACKING_OHNE_EINGABE.md`.

**Wichtig:** V60.7 in dasselbe Vercel-Projekt deployen, das bereits mit `medidate-tracking` verbunden ist. Dann sind keine weiteren Einstellungen erforderlich.

---

# V60.1 – Sonderversion mit privatem Vercel-Blob-Tracking

Die interne Buchungsstatistik nutzt jetzt **Vercel Blob (private)** statt Redis/Upstash. Einrichtung: `VERCEL_BLOB_TRACKING.md`.

# Sonderversion V60 – Vorsorge/Nachsorge + internes Buchungs-Tracking

Siehe `V60_SPECIAL_VORSORGE_NACHSORGE_TRACKING.md`. Die dynamische Kontingentsteuerung aus V60 bleibt erhalten.

# V60 – Dynamische Kontingentsteuerung

Siehe `V60_DYNAMIC_CONTINGENT.md`. Die V59/V55-Basisarchitektur bleibt erhalten; Patientendaten werden weiterhin nicht über den Website-Host geleitet.

# V55 – Neue Oberfläche und schneller Kalender mit V50-Buchungsablauf

Aktueller Stand und Grenzen: siehe `V55_COMPARISON.md`. Die nachstehenden älteren
Versionsnotizen sind Historie. Insbesondere ist die V54.9-Vermutung zum comment-Feld
nicht bestätigt: Die jetzt vorliegende V50-Referenz verwendete dieses Feld bereits.
Lokale Prüfung: `node scripts/test-booking.cjs`.

## Grundarchitektur: Host verarbeitet keine Patientenbuchungsdaten

## Zielarchitektur

**Website-Host**
- liefert HTML/JavaScript aus
- lädt einen für alle Besucher identischen öffentlichen mediDate-Verfügbarkeits-Datenstand
- liefert eine kurzlebige mediDate-Browsersitzung
- besitzt keinen POST-Endpunkt für Patientendaten
- besitzt keine Patientendatenbank und kein Patientenpostfach

**Verbindliche Buchung**
- Browser der Patientin → direkt mediDate/MediSoftware
- Name, Geburtsdatum, Telefon, Schwangerschafts-/GKV-Angabe und Freitext laufen nicht über den Website-Server

## Technischer Fallback

Vor Anzeige des Patientenformulars testet der Browser mit einer patientenfreien Verfügbarkeitsabfrage, ob Cross-Origin-Direktzugriffe auf mediDate technisch erlaubt sind.

- Wenn ja: nahtlose Direktbuchung im eigenen Layout.
- Wenn nein: es werden auf der eigenen Website gar keine Patientendaten abgefragt; stattdessen Weiterleitung auf die originale mediDate-Buchungsseite.

Damit bleibt die Kernanforderung in beiden Fällen erhalten: **keine Patientenbuchungsdaten über den eigenen Website-Host.**

## Schwangerschaft
- Neupatientin + Schwangerschaft: 30 Minuten.
- GKV-Neupatientin: Ja/Nein-Frage zur Schwangerschaftsvorsorge/-betreuung in einer anderen gynäkologischen Praxis im laufenden Kalenderquartal.
- Diese Angabe wird bei Direktbuchung ausschließlich direkt an mediDate übertragen.
- Das frühere eigene Schwangerschafts-Postfach wurde bewusst entfernt. Ohne kurzfristigen Termin wird Telefonkontakt angeboten.

## Bestätigung / Stornierung
Es wird keine Bestätigungs-E-Mail über den Website-Server versendet.
Nach erfolgreicher Direktbuchung:
- wird der Termin sofort angezeigt,
- kann lokal im Browser eine `.ics`-Kalenderdatei erzeugt werden,
- werden vorhandene native mediDate-Stornierungscodes direkt als mediDate-Links dargestellt.

## Hosting
V50 kann technisch auf Vercel oder einem anderen normalen Web-/Function-Host betrieben werden, weil die Anwendung dort keine Patientenbuchungsdaten entgegennimmt oder speichert.

Das ändert nichts an:
- allgemeinen DSGVO-Pflichten des Website-Hostings (z. B. IP-Adresse/technische Logs),
- den Anforderungen an mediDate/MediSoftware als tatsächlich patientendatenverarbeitenden Dienst,
- vertraglichen Tarif-/Nutzungsbedingungen des gewählten Website-Hosts.

## Wichtig
Die direkte Browserbuchung hängt davon ab, ob mediDate CORS für die eigene Website-Origin zulässt. V50 prüft dies automatisch **bevor** Patientendaten eingegeben werden. Bei fehlender CORS-Freigabe greift automatisch die native mediDate-Weiterleitung.


## V51 – E-Mail und Ärztinnenanzeige
- E-Mail-Adresse ist bei der Direktbuchung Pflichtfeld.
- Die E-Mail-Adresse wird ausschließlich Browser → mediDate/MediSoftware übertragen und nicht an den Website-Host.
- `eMailAddress` wird im mediDate-Buchungspayload befüllt, damit eine dort konfigurierte Bestätigungsmail versendet werden kann.
- Der große Datenschutzhinweis oberhalb der Buchung wurde entfernt; die Datenschutzinformation bleibt im eigentlichen Buchungsschritt und auf der Datenschutzseite.
- Bei „Nächster verfügbarer Termin“ wird die konkrete Ärztin bereits an jeder verfügbaren Uhrzeit angezeigt.
- Spätestens im Buchungsformular wird die tatsächlich zugeordnete Ärztin ausdrücklich oberhalb der Patientendaten angezeigt.


## V51 – einheitliche Breite der Uhrzeit-Kacheln
- Alle verfügbaren Termin-Uhrzeiten werden desktop/tablet in einem zweispaltigen Raster mit identischer Breite dargestellt.
- Die Breite ist unabhängig von der Länge des Ärztinnennamens.
- Auf kleinen Displays werden die Termin-Kacheln einspaltig und jeweils 100 % breit dargestellt.


## V51 – weitere Datenminimierung
- Feld „Mobiltelefon“ entfernt.
- Feld „Organisatorischer Hinweis (optional)“ entfernt.
- `mobilePhone` wird leer an mediDate übergeben.
- Es wird kein patientenseitiger Freitext mehr an mediDate übertragen.


## V54 – bitte V53 ersetzen

V54 beseitigt die Blob-Abhängigkeit vollständig. Die öffentlichen Terminzeiten werden bereits während des Vercel-Deployments erzeugt und anschließend statisch/CDN-nah ausgeliefert.

Damit darf mediDate beim Deployment langsam sein; die Patientin wartet beim Kalender anschließend nicht mehr auf mediDate.

Kein Blob Store und kein manueller `/refresh` sind erforderlich.


## V54.1 – Vercel Output-Directory-Fix

Der V54-Build konnte mediDate erfolgreich laden (`services=4`), scheiterte danach aber ausschließlich daran,
dass das Vercel-Projekt als Build-Ausgabe den Ordner `public` erwartet.

V54.1 ändert **nicht** die Termin-/Performance-Architektur. Der Build:
1. erzeugt wie bisher den aktuellen mediDate-Seed,
2. erzeugt anschließend den Ordner `/public`,
3. kopiert `index.html`, `admin.html`, `privacy-booking.html` und den frisch erzeugten `seed-data.js` dorthin.

`vercel.json` enthält nun ausdrücklich `"outputDirectory": "public"`.


## V54.2 – Browser-only wie bisher

- Keine Weiterleitung zum mediDate-Kalender.
- Versicherungsart, Patientenstatus, Leistung, Ärztin, Uhrzeit und Patientendaten werden weiterhin in der eigenen Oberfläche gewählt/eingegeben.
- Vorname, Nachname, Geburtsdatum und E-Mail-Adresse bleiben bis zum finalen Buchungsklick im Browser.
- Nach Auswahl einer Uhrzeit erscheint das eigene Formular sofort.
- Erst „Termin verbindlich buchen“ überträgt die Daten direkt aus dem Browser an mediDate/MediSoftware.
- Bei einem Verbindungsproblem bleibt die Buchungsmaske einschließlich der Eingaben stehen; es erscheint nur eine Fehlermeldung mit erneutem Versuch.
- Die schnelle V54-Seed-Terminanzeige und der V54.1-Output-Fix bleiben unverändert.


## V54.3 – Buchungsformular bereinigt

Aus dem sichtbaren Buchungsformular entfernt:
- der Hinweisblock „Direktübertragung an mediDate“
- der zusätzliche Erläuterungstext zur medizinischen Einwilligung bzw. Privat-/IGeL-Kostenvereinbarung

Die technische Browser-only-Direktübertragung und die übrige Buchungslogik bleiben unverändert.


## V54.5 – zurück auf den schnellen V54.3-Ladeprozess

Diese Version wurde **direkt aus V54.3** erstellt, weil dort die Terminanzeige schnell und stabil lief.

Nicht verändert wurden:
- Build-Seed / `seed-data.js`
- `bestImmediateBundle()`
- Browser-/LocalStorage-Cache
- `networkPublicBundle()`
- `publicBundle()`
- reguläre Verfügbarkeitsabfrage
- IGeL-Verfügbarkeitsabfrage
- Kalender-/Slot-Aufbereitung
- Browser-only-Direktbuchung

Geändert wurde nur die sichtbare Terminstruktur:
- „Selbstzahler / IGeL“
- fünf übersichtliche Selbstzahler-Kategorien
- keine neuen technischen IGeL-Modi
- Vorsorge/Ultraschall verwenden die bestehenden mediDate-Service-IDs 1950/1974
- Spirale/Hormone/Harmony verwenden exakt die bereits in V54.3 funktionierenden IGeL-Modi

Damit ist die neue Oberfläche von der bewährten Lade-/Cache-Logik entkoppelt.


## V54.6 – Terminladen robust wie V54.3/V54.5, Seed direkt im HTML

Beim Prüfen von V54.5 ist ein konkreter Schwachpunkt aufgefallen: Im Quell-ZIP ist
`seed-data.js` zunächst nur ein Null-Platzhalter. Für die schnelle Anzeige musste der Browser
nach dem Deployment noch eine zweite Datei `/seed-data.js` erfolgreich laden.

V54.6 lässt die eigentliche Slot-/Filterlogik unverändert, beseitigt aber diese zusätzliche
Abhängigkeit. Der Vercel-Build schreibt den aktuellen öffentlichen mediDate-Snapshot direkt in
die ausgelieferte `public/index.html`. Damit sind die Termine beim Öffnen der Seite bereits
im HTML vorhanden. Die langsame Live-Aktualisierung bleibt reine Hintergrundarbeit.

Zusätzlich enthält die Buchungsmaske ein unsichtbares Feld `bookInternalMeta`. Es wird für
jede Buchung automatisch passend zu Versicherung, Terminart und Neu-/Bestandspatientin
befüllt und beim finalen Buchungsklick als `comment` direkt an mediDate/MEDISOFT übergeben.


## V54.7 – harter Fix gegen 30-Sekunden-/Nicht-Laden

In V54.6 bestand noch ein echter Fehlerpfad: Wenn der eingebettete/localStorage-Snapshot aus
irgendeinem Grund nicht verfügbar war, hat `publicBundle()` doch wieder auf `liveBundle`
gewartet. `liveBundle` darf bis zu 65 Sekunden auf mediDate warten. Genau damit konnte der
Kalender trotz Seed-Architektur wieder hängen.

V54.7 trennt das jetzt technisch hart:

### Sichtbarer Kalenderpfad
1. Inline-Snapshot aus `index.html`
2. Browsercache
3. deployment-lokaler `/api/medidate?action=publicBundle` Snapshot, Timeout 2,2 Sekunden

**Keiner dieser drei Pfade kontaktiert mediDate.**

### Live-mediDate
`liveBundle` läuft ausschließlich im Hintergrund und wird vom Kalender niemals `await`et.

Der Build schreibt denselben erfolgreichen Snapshot zusätzlich nach `api/seed-bundle.json`.
Damit existieren zwei unabhängige schnelle Quellen innerhalb desselben Deployments:
Inline-HTML und lokaler API-Snapshot.

Die versteckten Buchungsmetadaten aus V54.6 bleiben unverändert erhalten.


## V54.8 – Fix für unvollständigen Browsercache

Beim erneuten Prüfen des Codes wurde ein konkreter Fehler gefunden, der über Deployments hinweg
zu genau dem beobachteten Verhalten führen kann:

`liveBundle` durfte bisher einen **nur teilweise erfolgreichen** mediDate-Abruf zurückgeben.
Dieser neuere Teilstand wurde im Browsercache gespeichert. `bestImmediateBundle()` bevorzugte
anschließend den neueren Browserstand gegenüber dem vollständigen Deployment-Seed – selbst wenn
im Teilstand die gerade ausgewählte Leistung fehlte. Dann erschien „Verfügbarkeit konnte nicht
geladen werden“, obwohl im Deployment ein vollständiger Terminstand vorhanden war.

V54.8:
- verwendet einen neuen Cache-Namespace und ignoriert damit alte fehlerhafte Browsercaches;
- akzeptiert nur noch Snapshots, die **alle vier** Services 1950/1952/1973/1974 enthalten;
- ein teilweiser Live-Refresh darf den vollständigen Deployment-Seed nicht mehr überschreiben;
- `liveBundle` gilt serverseitig nur bei 4/4 Services als erfolgreich;
- die schnelle Inline-/Deployment-Seed-Architektur bleibt unverändert;
- versteckte Buchungsmetadaten und Browser-only-Buchung bleiben unverändert.

Optional kann `?debug=1` an die URL angehängt werden. Dann schreibt die Seite ausschließlich
öffentliche technische Seed-Informationen in die Browser-Konsole (`buildSeedComplete`,
Service-IDs, Erzeugungszeitpunkt); keine Patientendaten.


## V54.9 – Buchungs-POST wieder auf den bekannten Payload zurückgeführt

Bei einem normalen 15-Minuten-Termin antwortete der mediDate-Endpunkt `POST /appointments`
mit HTTP 500. Die seit V54.6 zusätzlich befüllten, nicht dokumentierten internen Metadaten im
Feld `comment` waren der einzige relevante Unterschied zum zuvor funktionierenden Payload.

V54.9:
- sendet `comment` wieder leer wie im letzten bekannten funktionierenden Buchungspayload;
- verändert weder Seed-, Cache- noch Verfügbarkeitslogik aus V54.8;
- behandelt Timeouts, Netzwerkabbrüche und HTTP-5xx nach einem Buchungs-POST als unklaren
  Buchungsstatus;
- sperrt in diesem unklaren Zustand einen erneuten Buchungsklick, weil mediDate den Termin
  trotz fehlerhafter Antwort bereits gespeichert haben könnte;
- weist stattdessen auf Bestätigungsprüfung bzw. telefonische Klärung mit der Praxis hin.


## GitHub-sichere Auswertungs-URL

Der eigentliche Schlüssel wird nicht im Repository gespeichert. Im Servercode liegt ausschließlich sein SHA-256-Hash. Die private URL hat die Form `/praxis-auswertung#k=<GEHEIMER-SCHLÜSSEL>`. Das URL-Fragment wird vom Browser nicht an den Webserver übertragen; die Seite sendet den Schlüssel nur im internen API-Header. Nach dem ersten Öffnen wird er lokal im Browser gespeichert.