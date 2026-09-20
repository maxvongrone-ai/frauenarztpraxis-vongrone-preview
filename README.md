# mediDate V60.7.1

Sonderversion der Online-Terminbuchung mit minimiertem Buchungsstatistik-Tracking in einem privaten Vercel Blob Store.

Die Auswertung liegt unter `/praxis-auswertung`. Der Zugriffsschlüssel wird **nicht** im Repository gespeichert, sondern im URL-Fragment `#k=...` übergeben. Im Servercode liegt ausschließlich der SHA-256-Hash des Schlüssels.

Tracking-Datensatz: Buchungspfad, Patientenstatus, Terminart, Ärztin, Termindatum/-uhrzeit, Dauer und Erfassungszeitpunkt. Keine Namen, Geburtsdaten, E-Mail-Adressen, Telefonnummern oder Freitexte.
