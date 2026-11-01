// Per-device secrets kept in the meta table (never in the JSON backup). The import engine encrypts and reads them
// (src/import/passwords.ts); the data layer only needs their keys, e.g. to remove a card's password with the card.
export const PDF_PASSWORD_PREFIX = 'pdf-password:'
export const pdfPasswordKey = (cardId: string) => `${PDF_PASSWORD_PREFIX}${cardId}`
