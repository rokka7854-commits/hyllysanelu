# HyllySanelu

Erillinen, offline-toimiva PWA kuormalavahyllystön video- ja sanelupohjaiseen tarkastukseen. Sovellus ei muuta olemassa olevaa Hyllytarkastus-PWA:ta.

## Käyttö testissä

1. Avaa sovellus verkossa kerran Android-tabletilla ja valitse selaimen **Asenna sovellus** -toiminto.
2. Täytä tarkastuksen perustiedot.
3. Valitse **Aloita ohjattu videohavainto**.
4. Kuvaa ensin QR-/viivakoodi tai kirjoita varastopaikka, kuvaa vaurio, ja vastaa sovelluksen ohjeisiin.
5. Hyväksy yhteenveto. Havainnot, raporttikuvat ja videoleikkeet säilyvät vain kyseisellä laitteella.

## Tämän version rajaus

- Video, raporttikuvat, QR-/viivakoodin luku (selaimen laitetuki), ohjattu dialogi, paikallinen tallennus sekä CSV- ja tulostettava raportti ovat mukana.
- Puheohjeet käyttävät laitteen puhesynteesiä. Puhevastauksen tulkinta käyttää selaimen puheentunnistustukea, joten sen toimivuus ja offline-tila pitää testata käytettävällä tabletilla.
- Kaikille puhevastauksille on näytöllä manuaalinen vaihtoehto. Raporttiin tallennetaan vain tarkastajan hyväksymät kentät.

## Julkaisu

Sovellus on staattinen: julkaise koko kansio esimerkiksi GitHub Pagesiin. HTTPS tarvitaan kameran, mikrofonin ja asennettavan PWA:n käyttöön.
