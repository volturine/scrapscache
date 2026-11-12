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
- **France.**
  [Décret n° 2007-663 of 2 May 2007](https://www.arcep.fr/fileadmin/reprise/textes/decrets/d2007-663.pdf)
  (read here as first published; check for later amendments) puts the supply
  (_fourniture_),
  the transfer from another EU state and the import of a cryptology means that
  does more than authentication or integrity under a prior declaration to the
  ANSSI (art. 3), unless the means is in the decree's annex 1. That annex lists
  equipment such as bank cards, broadcast receivers, mobile phones without
  phone-to-phone encryption and copy protection; a notes app that encrypts
  notes for confidentiality is in none of its categories.

## Steps

The article numbers are the decree's. What the ANSSI's own pages and form say
today was not read for this page (its site refuses automated requests), so
treat each step as a thing to confirm with the ANSSI, not as its instructions.

1. **File the declaration with the ANSSI**, at least one month before the app
   is offered in France (art. 4). The online procedure is
   [Déclaration relative à un moyen de cryptologie](https://demarche.numerique.gouv.fr/commencer/declaration-relative-a-un-moyen-de-cryptologie);
   the same page offers a guide to the procedure as a PDF and gives the contact
   `controle@ssi.gouv.fr`.
   - Who: the procedure's page puts the declaration on the supplier or first
     importer, taken here to be the publisher named on the App Store. It
     accepts a foreign company's registration document in place of a K-bis.
   - Attachments that page names: a presentation of the company, its
     registration extract less than three months old (or the foreign
     equivalent), a commercial brochure, a technical brochure, and the user and
     administrator guides if there are any. Candidates from this project: the
     public site and its privacy page, [security.md](security.md), the
     technical description below, and [self-hosting.md](self-hosting.md) as the
     administrator guide. Whether they satisfy the ANSSI is its call.
   - The ANSSI answers with a receipt that carries the file's registration
     number (art. 4).
   - Ask the ANSSI what the declaration covers. The same client is already
     served to anyone as a web app at the hosted service's address; this page
     was written for the App Store release and takes no view on the web app.
2. **Wait.** Within a month the ANSSI may ask for missing pieces, which
   restarts the month. After a month of silence the declared supply is allowed,
   and the ANSSI may, without being bound to, issue an attestation that the
   declaration was made (art. 5). The declaration also covers the
   intermediaries that distribute the app (art. 6), which is taken here to
   mean Apple.
3. **Upload the ANSSI's document to Apple**: App Store Connect › the app › App
   Information › App Encryption Documentation, answering that the app uses
   standard algorithms that are not the system's and is available in France.
   Apple's page asks for the "French encryption declaration"; a [2016 account by the Cryptomator developers](https://cryptomator.org/blog/2016/06/16/indepth-french-app-store/) says App Store Connect asked them for the
   ANSSI's approval of it. So ask the ANSSI for the attestation, and if only
   the receipt comes, upload the receipt with the filed form and see what
   Apple's review says. Apple reviews the document and, per its documentation,
   provides a code.
4. **Put the code in the app**: in `ios/App/App/Info.plist` set
   `ITSAppUsesNonExemptEncryption` to true and add
   `ITSEncryptionExportComplianceCode` with Apple's code, in the same change
   that updates this page and
   [development.md › Export compliance](development.md#export-compliance).
5. **Add France** under Pricing and Availability, with a build that carries the
   code.

For a year after the file is complete the ANSSI may ask for the technical
characteristics and the source code (art. 7). When the cryptography below
changes, update the description here and ask the ANSSI whether the change
needs a new declaration; the decree's text read for this page does not say.

## Technical description of the cryptology means

Written for the technical part of the file. It describes the **client**: the
app on iPhone and iPad, which is the same code as the web app. Sources:
[security.md](security.md) and the code it names.

| Item                       | Description                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                       | Scraps Cache (iPhone and iPad app, bundle `com.scrapscache.app`; the same client runs as a web app)                                                                                                                                                                                                                                                                                                |
| Kind                       | Software, distributed to the general public through the App Store                                                                                                                                                                                                                                                                                                                                  |
| Purpose                    | A notes app. Notes stay on the device; optional sync between a person's own devices is end-to-end encrypted                                                                                                                                                                                                                                                                                        |
| Services                   | Confidentiality and integrity of synced records and of backup files; authentication of a device to the sync relay                                                                                                                                                                                                                                                                                  |
| Access to the cryptography | The user cannot choose algorithms, or use the encryption on other data. The one secret a user picks is the passphrase of a backup file                                                                                                                                                                                                                                                             |
| Implementation             | JavaScript in the app's web view, from open-source libraries: `@noble/ciphers` 2.4.0, `@noble/curves` 2.4.0, `@noble/hashes` 2.4.0, and `@cipherman/pake-js` 0.1.1 for the pairing exchange, which runs on its own copies of `@noble/curves` 1.9.7 and `@noble/hashes` 1.8.0 (`package-lock.json` has the exact versions). No proprietary algorithm, and no cryptography in the app's native shell |
| Transport                  | TLS, from the operating system; the app allows `https` and `wss` connections only                                                                                                                                                                                                                                                                                                                  |

| Function                                                                                                                                                     | Algorithm                                                                                                                              | Parameters                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Encryption of every synced record (notes, labels, attachments, boards, drawing library items, the workspace name, deletion markers) and of reminder receipts | XChaCha20-Poly1305 (authenticated encryption)                                                                                          | 256-bit key, random 192-bit nonce per message, associated data binding the account and the record's slot           |
| Key derivation for sync                                                                                                                                      | SHA-256 with a domain-separation label, from the sync key                                                                              | Sync key: 256 bits from the system's random generator                                                              |
| Authentication to the relay                                                                                                                                  | Ed25519 signature of a one-time challenge valid 60 seconds                                                                             | Signing key derived from the sync key; the relay holds the public key only                                         |
| Pairing a second device                                                                                                                                      | CPace (password-authenticated key exchange) over ristretto255, then XChaCha20-Poly1305 to carry the sync key                           | One-time 16-character code (80 bits), valid 60 seconds                                                             |
| Backup files                                                                                                                                                 | Argon2id to derive a key from the user's passphrase, then XChaCha20-Poly1305 over 1 MiB chunks, each with its own 192-bit nonce        | 256-bit key; 128-bit random salt; Argon2id defaults of 19,456 KiB, 2 iterations, 1 lane, stored in the file header |
| Handing a workspace to an MCP server the user approves                                                                                                       | X25519 key agreement with a one-time client key, SHA-256 with a domain-separation label, then XChaCha20-Poly1305 to carry the sync key | 256-bit key, random 192-bit nonce                                                                                  |

Key management:

- Every key is generated on the user's device. A sync key leaves it in two
  ways only, both encrypted to the receiver and both started by the user:
  pairing another of the user's devices, and approving an MCP server (a
  program that lets an AI client read and write the notes; see
  [mcp.md](mcp.md)), which then holds the sync key.
- On the device the sync keys are kept as they are in the app's own storage
  (the web view's local storage), protected by the device and the app's
  sandbox and not by a further key. Notes at rest on the device are not
  encrypted by the app.
- The relay stores, per record, a version byte, a nonce and the ciphertext;
  the account's public signing key; and one-way hashes derived from the sync
  key and from the pairing code (the account id, each record's slot, the
  pairing rendezvous tag) and of session tokens.
- The publisher and the relay's operator hold no key that decrypts notes, and
  the service has no key escrow or recovery. Whoever runs an MCP server the
  user approved does hold that workspace's sync key.

Outside this description: the relay is server software, not part of the app.
It encrypts Web Push messages for browsers (RFC 8291: ECDH on P-256,
HKDF-SHA-256, AES-128-GCM) and signs ES256 tokens for the push services. The
app does no cryptography of its own for push; the system's push service
delivers it.
