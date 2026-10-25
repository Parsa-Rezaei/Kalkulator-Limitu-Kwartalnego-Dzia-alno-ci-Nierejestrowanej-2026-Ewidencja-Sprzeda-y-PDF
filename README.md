# Kalkulator i Ewidencja Działalności Nierejestrowanej 2026

**Limit kwartalny 10 813,50 zł + generator rachunków i ewidencji sprzedaży PDF**

[Polski](#polski) · [English](#english)

---

## Polski

Bezpłatna aplikacja w przeglądarce dla osób prowadzących **działalność nierejestrowaną** w 2026 r. (korepetycje, rękodzieło, copywriting, drobne usługi). Statyczna strona – bez serwera, bez logowania, bez skryptów z innych domen. Dane zapisują się wyłącznie w przeglądarce użytkownika (`localStorage`).

### Funkcje

| Moduł | Co robi |
|---|---|
| **Interaktywna Uproszczona Ewidencja Sprzedaży 2026 (4 kwartały)** | Dodawanie, edycja i usuwanie sprzedaży: data, nr dokumentu, nabywca (B2C/B2B), NIP z kontrolą sumy, opis, kwota brutto, status (opłacone / należne), data zapłaty, koszt. Cztery paski postępu (I–IV kwartał) względem limitu 10 813,50 zł, wykres Chart.js, kwota narastająco w kwartale. |
| **Alerty limitu** | Żółte ostrzeżenie powyżej 9500 zł w kwartale. Czerwony alert po przekroczeniu 10 813,50 zł: wskazuje sprzedaż, którą przekroczono limit, i ostatni dzień 7-dniowego terminu na wniosek do CEIDG. |
| **Ścieżka JDG** | Od 85% limitu: oś czasu Ulga na start (6 mies.) → Preferencyjny ZUS (24 mies.) → Mały ZUS Plus, liczona od wybranej daty rozpoczęcia JDG, oraz linki partnerskie do księgowości online. |
| **Weryfikator Wykluczeń** | Czy potrzebujesz kasy fiskalnej lub VAT od 1. złotówki: części samochodowe, kosmetyki i perfumy przez internet, elektronika, naprawa pojazdów i wulkanizacja, usługi fryzjerskie i kosmetyczne, doradztwo, usługi prawnicze, usługi parkingowe (od 1.04.2026 r.), przewóz osób. |
| **Generator PDF** | Uproszczona Ewidencja Sprzedaży za kwartał, miesiąc lub rok (Lp., data, nr dokumentu, kwota, narastająco, podsumowanie względem limitu). Rachunek lub faktura bez VAT A4: sprzedawca, nabywca, pozycje, kwota słownie, termin zapłaty, adnotacja o zwolnieniu z VAT (art. 113 ust. 1 lub 9). Polskie znaki (czcionka Roboto). |
| **Symulacja PIT-36** | Przychód otrzymany minus koszty, suma z dochodem z etatu, skala 12% / 32%, kwota wolna 30 000 zł, szacunkowy podatek do dopłaty. |
| **Limit kasy fiskalnej** | 20 000 zł sprzedaży B2C, proporcjonalnie od dnia pierwszej sprzedaży (20 000 × dni do końca roku / 365), data, od której kasa jest obowiązkowa. |
| **Limit KSeF** | Faktury B2B do 10 000 zł brutto miesięcznie (1.04–31.12.2026 r.), trwała utrata zwolnienia po przekroczeniu. |
| **Dane** | Kopia zapasowa i import JSON, eksport CSV (Excel, średniki, przecinek dziesiętny), przykładowe dane, usuwanie danych. |
| **SEO** | Treść statyczna (zasady 2026, FAQ), schematy JSON-LD `SoftwareApplication` i `FAQPage`, meta tagi, Open Graph, `robots.txt`. |

### Zasady prawne 2026 zastosowane w kalkulatorze

| Zasada | Wartość | Podstawa |
|---|---|---|
| Limit przychodu należnego na kwartał | 225% × 4806 zł = **10 813,50 zł** | art. 5 ust. 1 ustawy – Prawo przedsiębiorców (od 1.01.2026 r.) |
| Termin po przekroczeniu limitu | wniosek do CEIDG w ciągu **7 dni** od dnia przekroczenia | art. 5 Prawa przedsiębiorców |
| Ewidencja sprzedaży | za każdy dzień, wpis przed pierwszą sprzedażą dnia następnego | art. 109 ust. 1 ustawy o VAT |
| Zwolnienie podmiotowe z VAT | **240 000 zł** (od 2026 r.) | art. 113 ust. 1 i 9 ustawy o VAT |
| VAT od 1. zł | m.in. części samochodowe, kosmetyki na odległość, doradztwo, usługi prawnicze | art. 113 ust. 13 ustawy o VAT |
| Kasa fiskalna | **20 000 zł** B2C rocznie, proporcjonalnie w pierwszym roku; obowiązek po upływie 2 miesięcy od końca miesiąca przekroczenia | rozporządzenie MF z 17.12.2024 r. (Dz.U. 2024 poz. 1902) |
| Kasa od 1. zł | m.in. części do pojazdów, perfumy, naprawa pojazdów, usługi fryzjerskie i kosmetyczne, prawnicze, przewóz osób, **usługi parkingowe od 1.04.2026 r.** | § 4 tego rozporządzenia |
| KSeF | faktury poza KSeF do **10 000 zł brutto miesięcznie** do 31.12.2026 r. | art. 145m ustawy o VAT |
| PIT | przychód z innych źródeł w PIT-36, skala 12% / 32% (próg 120 000 zł), kwota wolna 30 000 zł, brak zaliczek | ustawa o PIT |
| ZUS | brak składek w działalności nierejestrowanej | – |

Przepisy sprawdzono w październiku 2026 r. Wartości liczbowe są w obiekcie `CONFIG` na początku pliku `assets/app.js`.

### Uruchomienie

- **GitHub Pages (bezpłatny hosting):** *Settings → Pages → Build and deployment → Source: Deploy from a branch* → wybierz gałąź z plikiem `index.html` i folder `/ (root)` → *Save*. Po 1–2 minutach strona będzie dostępna pod adresem `https://<użytkownik>.github.io/<nazwa-repozytorium>/`.
- **Lokalnie:** otwórz `index.html` w przeglądarce albo w folderze projektu uruchom `python3 -m http.server 8000` i otwórz `http://localhost:8000/`.

Wszystkie pliki (także Chart.js i pdfmake) są serwowane z tej samej domeny – strona nie ładuje niczego z zewnętrznych CDN.

### Konfiguracja (monetyzacja) – plik `assets/config.js`

To jedyny plik, który trzeba edytować:

```js
window.DN_CONFIG = {
  AFFILIATES: [
    { name: 'inFakt', url: 'https://TWOJ-LINK-PARTNERSKI', text: 'Rejestracja firmy i księgowość online' },
    { name: 'ifirma', url: 'https://TWOJ-LINK-PARTNERSKI', text: 'Księgowość internetowa dla JDG' }
  ],
  BUYCOFFEE_URL: 'https://buycoffee.to/twoja-nazwa'
};
```

- Akceptowane są tylko adresy `https://`; `BUYCOFFEE_URL` tylko `https://buycoffee.to/...`. Inne wartości są ignorowane.
- Błąd składni w tym pliku nie psuje strony – znikają tylko linki partnerskie i przycisk BuyCoffee.
- Linki partnerskie pojawiają się w karcie „Ścieżka JDG” (od 85% limitu) z `rel="sponsored"` i informacją o linku partnerskim w stopce. Pusta lista `[]` ukrywa sekcję.
- Przycisk BuyCoffee (BLIK) pojawia się w stopce i w oknie po pobraniu PDF (raz na sesję). Pusty adres ukrywa przyciski.

### Budowanie i kontrola bezpieczeństwa

```bash
npm ci          # instalacja z weryfikacją skrótów z package-lock.json
npm run build   # kompiluje assets/app.css, kopiuje biblioteki do vendor/ i zapisuje vendor/SHA256SUMS
npm run check   # sprawdza, czy vendor/ i CSS są niezmienione oraz czy index.html spełnia zasady CSP
```

Style Tailwind są skompilowane do `assets/app.css` (Tailwind Play CDN według dokumentacji Tailwind nie jest przeznaczony do produkcji, a Content-Security-Policy blokuje style inline).

### Pliki

```
index.html                 struktura strony, treść SEO, nagłówek Content-Security-Policy
assets/app.js              logika aplikacji
assets/config.js           linki partnerskie i BuyCoffee (edytuj tylko ten plik)
assets/app.css             skompilowany Tailwind CSS
vendor/                    Chart.js 4.5.1 i pdfmake 0.2.23 (+ licencje, SHA256SUMS)
favicon.svg, robots.txt
SECURITY.md                zabezpieczenia i zgłaszanie podatności
package.json, package-lock.json, tailwind.config.js, scripts/
```

### Bezpieczeństwo

Szczegóły w [SECURITY.md](SECURITY.md): Content-Security-Policy bez `unsafe-inline`/`unsafe-eval`, Trusted Types, brak zewnętrznych skryptów, walidacja importu, kontrola sumy IBAN numeru konta, ochrona CSV przed formułami.

### Prywatność

Brak plików cookie, analityki i wysyłania danych. Ewidencja, ustawienia i dane sprzedawcy są tylko w `localStorage` przeglądarki. Po dodaniu reklam lub analityki trzeba dodać politykę prywatności i (dla reklam Google w EOG) zgodę przez certyfikowaną platformę CMP – oraz rozszerzyć CSP o ich domeny.

### Zastrzeżenie

Narzędzie ma charakter informacyjny i nie stanowi porady prawnej ani podatkowej. Klasyfikacja towarów (CN/PKWiU) decyduje o obowiązku kasy i VAT. W razie wątpliwości: urząd skarbowy, Krajowa Informacja Skarbowa lub doradca podatkowy.

### Źródła

- [biznes.gov.pl – działalność nierejestrowana](https://www.biznes.gov.pl/pl/portal/00115)
- [Ustawa – Prawo przedsiębiorców (ISAP)](https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20180000646)
- [Ustawa o podatku od towarów i usług (ISAP)](https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535)
- [Rozporządzenie MF z 17.12.2024 r. w sprawie zwolnień z kas rejestrujących (ISAP)](https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240001902)
- [KSeF – Ministerstwo Finansów](https://ksef.podatki.gov.pl/)

---

## English

A free, browser-only web app for people running a **Polish unregistered business (działalność nierejestrowana)** in 2026. Static site: no server, no account, no third-party scripts. Data is stored only in the user's browser (`localStorage`). The interface is in Polish.

### Features

- **Simplified sales ledger (4 quarters):** add, edit and delete sales (date, document number, B2C/B2B buyer, NIP with checksum validation, description, gross amount, paid / receivable status, payment date, cost). Four progress bars for Q1–Q4 against the 10,813.50 PLN limit, a Chart.js chart and a running quarterly total.
- **Limit alerts:** yellow warning above 9,500 PLN per quarter; red alert above 10,813.50 PLN showing the sale that crossed the limit and the last day of the 7-day deadline to register in CEIDG.
- **JDG transition path:** from 85% of the limit, a timeline of "Ulga na start" (6 months, 0 PLN social insurance) → preferential ZUS (24 months) → "Mały ZUS Plus", plus affiliate links to online accounting services.
- **Exclusion checker:** whether a cash register or VAT is required from the first sale (car parts, cosmetics sold online, electronics, vehicle repair, hairdressing and beauty, consulting, legal services, parking services from 1 April 2026, passenger transport).
- **PDF generator (pdfmake):** simplified sales ledger for a quarter, month or year with running totals; A4 bill ("rachunek") or VAT-exempt invoice with amount in words and the VAT-exemption note (art. 113 of the VAT Act). Polish characters supported (Roboto).
- **PIT-36 simulation:** cash-basis revenue minus costs, combined with employment income, 12% / 32% tax scale, 30,000 PLN tax-free amount.
- **Cash register limit:** 20,000 PLN B2C per year, pro-rated from the first sale (20,000 × days remaining / 365), with the date from which a register is mandatory.
- **KSeF limit:** B2B invoices up to 10,000 PLN gross per month (1 April – 31 December 2026), permanent loss after exceeding it.
- **Data:** JSON backup/import, CSV export (Excel-friendly), demo data, data reset.
- **SEO:** static content (2026 rules, FAQ), `SoftwareApplication` and `FAQPage` JSON-LD, meta and Open Graph tags, `robots.txt`.

### Run

- **GitHub Pages:** *Settings → Pages → Source: Deploy from a branch* → select the branch containing `index.html`, folder `/ (root)` → *Save*.
- **Locally:** open `index.html` in a browser, or run `python3 -m http.server 8000` in the project folder and open `http://localhost:8000/`.

All files, including Chart.js and pdfmake, are served from the same origin; nothing is loaded from external CDNs.

### Configuration

Edit only `assets/config.js`: `AFFILIATES` (your affiliate links, `https://` only; `[]` hides the block) and `BUYCOFFEE_URL` (`https://buycoffee.to/...` only; empty hides the buttons). Invalid values are ignored and a syntax error in that file does not break the site. Legal values (minimum wage, limits, tax scale) are in `CONFIG` at the top of `assets/app.js`.

### Build and security check

`npm ci && npm run build` compiles `assets/app.css`, copies the libraries into `vendor/` and writes `vendor/SHA256SUMS`. `npm run check` fails if any vendored file or the CSS was modified or if `index.html` breaks the CSP rules. See [SECURITY.md](SECURITY.md).

### Disclaimer

For information only; not legal or tax advice. Rules checked in October 2026.
