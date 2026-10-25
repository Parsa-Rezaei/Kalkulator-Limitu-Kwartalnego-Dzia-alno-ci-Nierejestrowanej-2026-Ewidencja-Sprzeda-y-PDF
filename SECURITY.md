# Bezpieczeństwo / Security

## Zgłaszanie podatności / Reporting a vulnerability

Nie zgłaszaj podatności w publicznym Issue. Użyj zakładki **Security → Report a vulnerability** w tym repozytorium (prywatne zgłoszenie).

Do not report vulnerabilities in public issues. Use **Security → Report a vulnerability** in this repository (private report).

## Jak aplikacja jest zabezpieczona / How the app is protected

| Zagrożenie / Threat | Zabezpieczenie / Protection |
|---|---|
| Wstrzyknięcie skryptu (XSS) / script injection | Cały tekst użytkownika trafia na stronę przez `textContent`; brak `innerHTML`, `eval`, atrybutów `on*=`. Content-Security-Policy: `script-src 'self'`, `style-src 'self'`, `default-src 'none'`, Trusted Types (`require-trusted-types-for 'script'`). |
| Przejęcie zewnętrznego CDN / compromised CDN | Brak skryptów z innych domen. Chart.js i pdfmake są kopiowane do `vendor/` z pakietów npm weryfikowanych skrótem SHA-512 z `package-lock.json`; sumy SHA-256 w `vendor/SHA256SUMS`; `npm run check` wykrywa każdą zmianę. |
| Podmiana linków partnerskich / BuyCoffee | Linki tylko z `assets/config.js`; akceptowane wyłącznie adresy `https://` (BuyCoffee tylko `https://buycoffee.to/...`), bez danych logowania w adresie. Ochrona konta GitHub – patrz niżej. |
| Błędny numer konta na rachunku / wrong bank account | Numer jest sprawdzany sumą kontrolną IBAN (mod 97); dokument z błędnym numerem nie zostanie wygenerowany; numer jest wyświetlany do potwierdzenia przed każdym PDF. Import kopii JSON pokazuje numer konta z pliku przed wczytaniem. |
| Złośliwy plik JSON / malicious backup file | Limit 5 MB i 20 000 pozycji, walidacja każdego pola, odrzucanie nieznanych kluczy (także `__proto__`), usuwanie znaków sterujących i znaków zmiany kierunku tekstu. |
| Formuły w CSV (CSV injection) | Komórki zaczynające się od `= + - @` (także pełnej szerokości), tabulatora lub CR są poprzedzane apostrofem. |
| Tabnabbing | Wszystkie linki `target="_blank"` mają `rel="noopener"`. |
| Prywatność / privacy | Brak cookies, analityki i wysyłania danych. Dane tylko w `localStorage` przeglądarki. |

## Ograniczenia hostingu / Hosting limitations

- GitHub Pages nie pozwala ustawiać własnych nagłówków HTTP, więc CSP jest w `<meta>`. Dyrektywa `frame-ancestors` nie działa w `<meta>`. / GitHub Pages cannot set custom HTTP headers; `frame-ancestors` is not available via `<meta>`.
- Wszystkie strony projektów pod `https://<użytkownik>.github.io/` mają **wspólne** `localStorage`. Nie publikuj pod tym samym adresem nieznanego kodu – albo użyj własnej domeny tylko dla tej aplikacji. / All project sites under the same `github.io` user domain share one origin and one `localStorage`.

## Aktualizacja bibliotek / Updating libraries

```bash
npm ci                 # instalacja z weryfikacją skrótów z package-lock.json
npm audit              # znane podatności
npm install pdfmake@<wersja> chart.js@<wersja> --save-exact
npm run build          # kopiuje biblioteki do vendor/, przebudowuje CSS i SHA256SUMS
npm run check          # musi zakończyć się komunikatem „Kontrola OK”
```
