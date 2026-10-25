/*
 * USTAWIENIA ZAROBKOWE – jedyny plik, który musisz edytować.
 *
 * Zasady bezpieczeństwa:
 *  - Wpisuj wyłącznie adresy zaczynające się od https:// (inne są ignorowane).
 *  - BUYCOFFEE_URL musi zaczynać się od https://buycoffee.to/ (inne są ignorowane).
 *  - Jeśli popełnisz błąd składni w tym pliku, strona dalej działa
 *    (bez linków partnerskich i przycisku BuyCoffee) – sprawdź wtedy przecinki i cudzysłowy.
 *  - Nie wpisuj tu haseł, kluczy API ani danych osobowych – ten plik jest publiczny.
 */
window.DN_CONFIG = {
  // Linki partnerskie do księgowości online. Pusta lista [] ukrywa sekcję.
  AFFILIATES: [
    { name: 'inFakt', url: 'https://www.infakt.pl/', text: 'Rejestracja firmy i księgowość online' },
    { name: 'ifirma', url: 'https://www.ifirma.pl/', text: 'Księgowość internetowa dla JDG' }
  ],

  // Twój link BuyCoffee.to, np. 'https://buycoffee.to/twoja-nazwa'. Pusty = przyciski ukryte.
  BUYCOFFEE_URL: ''
};
