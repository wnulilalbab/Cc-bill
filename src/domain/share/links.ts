// Where "Send via WhatsApp" goes. No phone number: WhatsApp asks whom to send it to (phase-1 §9 does not ask the
// app to remember numbers, so none is stored).

/** Universal link: opens WhatsApp (app or web) with the text filled in. */
export const whatsappWebUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`

/** App scheme, used when the browser blocks opening the universal link. */
export const whatsappAppUrl = (text: string) => `whatsapp://send?text=${encodeURIComponent(text)}`
