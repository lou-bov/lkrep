# LinkedIn Recruiter → HR-ON

Chrome-udvidelse, der opretter kandidater fra LinkedIn Recruiter i HR-ON Recruit
(`https://recruit.hr-on.com`). Den kører i din egen browser med dine egne logins,
så der skal ikke bruges API-nøgler eller adgangskoder.

## Installation
1. Gå til `chrome://extensions` (eller `edge://extensions`).
2. Slå **Developer mode** til.
3. Klik **Load unpacked**, og vælg mappen `linkedin-to-hron`.
4. Fastgør ikonet "LinkedIn → HR-ON" i værktøjslinjen.

## Brug
1. Åbn en kandidatprofil i LinkedIn Recruiter. Åbn kontaktinfo, hvis du vil have e-mail og telefon med.
2. Klik på udvidelsen. Felterne udfyldes fra profilen; ret dem, hvis det er nødvendigt.
3. Klik **Tilføj og åbn HR-ON**, eller **Tilføj til kø** for at samle flere kandidater.
4. Log ind i HR-ON, og gå til siden for at oprette en kandidat.
5. Klik på udvidelsen, og klik **Udfyld** ud for kandidaten. Felterne markeres med grønt.
6. Tjek data, klik **Gem** i HR-ON, og klik **Fjern** for at tage kandidaten ud af køen.

Udvidelsen gemmer aldrig selv i HR-ON. Du godkender altid hver kandidat.

## Hvis et felt ikke bliver udfyldt
Felterne findes automatisk ud fra deres labels (fx "Fornavn", "E-mail", "Telefon").
Finder den ikke et felt, skal du åbne **Indstillinger** og angive en CSS-selector for feltet, fx:

```json
{ "firstName": "input[name='firstname']", "phone": "input[name='mobile']" }
```

Under Indstillinger kan du også sætte URL'en til "Opret kandidat", så den åbnes direkte.

## Begrænsninger
- LinkedIn ændrer ofte sin HTML. Mangler navn eller titel, skal selectors i `extract.js` opdateres.
- Det er bevidst, at den kun læser den profil, du selv har åben. Masse-scraping af LinkedIn er i strid med LinkedIns brugervilkår.
- CV-filer bliver ikke overført.
