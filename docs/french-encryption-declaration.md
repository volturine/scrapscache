# Selling the app in France

Apple lets an app that ships its own encryption onto the App Store in France
only with a **French encryption declaration**. This page says why Scraps Cache
needs one, how to get it, and holds the technical description the filing asks
for. It is the publisher's filing: nothing here is legal advice, and the ANSSI
is the authority on its own procedure.

Until the steps below are done, France stays out of the app's availability
(App Store Connect › Pricing and Availability) and `Info.plist` keeps
`ITSAppUsesNonExemptEncryption` at false.

## Why

- **Apple.** For an app that "uses an industry standard algorithm, not provided
  within the Apple operating system", App Store Connect requires a French
  encryption declaration, and only "if you're distributing your app on the App
  Store in France"
  ([Export compliance documentation for encryption](https://developer.apple.com/help/app-store-connect/reference/export-compliance-documentation-for-encryption)).
  Scraps Cache is that case: its end-to-end encryption runs in the page, from
  the `@noble` libraries, not from iOS.
- **France.** Décret n° 2007-663 of 2 May 2007 puts the supply (_fourniture_),
  the transfer from another EU state and the import of a cryptology means that
  does more than authentication or integrity under a prior declaration to the
  ANSSI (art. 3), unless the means is in the decree's annex 1. That annex lists
  equipment such as bank cards, broadcast receivers, mobile phones without
  phone-to-phone encryption and copy protection; a notes app that encrypts
  notes for confidentiality is in none of its categories.

## Steps

1. **File the declaration with the ANSSI**, at least one month before the app
   is offered in France (art. 4). The online procedure is
   [Déclaration relative à un moyen de cryptologie](https://demarche.numerique.gouv.fr/commencer/declaration-relative-a-un-moyen-de-cryptologie);
   the same page offers the form as a PDF. The ANSSI's office for this answers
   at `controle@ssi.gouv.fr`.
   - Who: the supplier, that is the publisher named on the App Store. A
     publisher outside France files too; the procedure takes a foreign
     company's registration document in place of a K-bis.
   - Attachments the procedure names: a presentation of the company, its
     registration extract less than three months old (or the foreign
     equivalent), a commercial brochure, a technical brochure, and the user and
     administrator guides if there are any. For this app the public site, the
     privacy page, [security.md](security.md) and the technical description
     below cover the brochures; [self-hosting.md](self-hosting.md) is the
     administrator guide.
   - The ANSSI answers with a receipt that carries the file's registration
     number.
2. **Wait for the attestation.** Within a month the ANSSI may ask for missing
   pieces, which restarts the month. After a month of silence the declared
   supply is allowed, and the ANSSI may issue an attestation that the
   declaration was made (art. 5). The attestation is the document Apple wants;
   ask for it if the receipt alone arrives. The declaration covers the
   intermediaries that distribute the app, which is Apple here (art. 6).
3. **Upload it to Apple**: App Store Connect › the app › App Information › App
   Encryption Documentation. Answer the questions as "standard encryption
   algorithms instead of, or in addition to" the system's, available in France.
   Apple reviews the document and returns a code.
4. **Put the code in the app**: in `ios/App/App/Info.plist` set
   `ITSAppUsesNonExemptEncryption` to true and add
   `ITSEncryptionExportComplianceCode` with Apple's code, in the same change
   that updates this page and
   [development.md › Export compliance](development.md#export-compliance).
5. **Add France** under Pricing and Availability, with a build that carries the
   code.

For a year after the file is complete the ANSSI may ask for the technical
characteristics and the source code (art. 7). A change to the cryptography
below is a change to what was declared: update the description here and tell
the ANSSI.

## Technical description of the cryptology means

Written for the technical part of the file. Sources: [security.md](security.md)
and the code it names.

| Item                       | Description                                                                                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                       | Scraps Cache (iPhone and iPad app, bundle `com.scrapscache.app`; the same client runs as a web app)                                                                                                                        |
| Kind                       | Software, distributed to the general public through the App Store                                                                                                                                                          |
| Purpose                    | A notes app. Notes stay on the device; optional sync between a person's own devices is end-to-end encrypted                                                                                                                |
| Services                   | Confidentiality and integrity of synced notes and of backup files; authentication of a device to the sync relay                                                                                                            |
| Access to the cryptography | None: the user cannot choose algorithms or keys, or use the encryption on other data                                                                                                                                       |
| Implementation             | JavaScript in the app's web view, from the open-source libraries `@noble/ciphers`, `@noble/curves`, `@noble/hashes` and `@cipherman/pake-js`. No proprietary algorithm. Transport security (TLS) is the operating system's |

| Function                                           | Algorithm                                                                                                    | Parameters                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Encryption of synced notes, labels and attachments | XChaCha20-Poly1305 (authenticated encryption)                                                                | 256-bit key, random 192-bit nonce per message, associated data binding the account and record |
| Key derivation for sync                            | SHA-256 with a domain-separation label, from the sync key                                                    | Sync key: 256 bits, generated on the device by the system's random generator                  |
| Authentication to the relay                        | Ed25519 signature of a one-time challenge                                                                    | Signing key derived from the sync key; the relay holds the public key only                    |
| Pairing a second device                            | CPace (password-authenticated key exchange) over ristretto255, then XChaCha20-Poly1305 to carry the sync key | One-time 16-character code (80 bits), valid 60 seconds                                        |
| Backup files                                       | Argon2id to derive a key from the user's passphrase, then XChaCha20-Poly1305 in authenticated chunks         | 256-bit key; Argon2id parameters stored in the file header                                    |

Key management: every key is generated on the user's device and stays there or
on the user's other paired devices. The relay stores ciphertext, a nonce and a
version byte per record, and the account's public signing key. Neither the
publisher nor the relay operator holds a key that decrypts notes, and there is
no key escrow or recovery by the service.
