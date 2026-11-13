export type BookingWhatsAppDetails = {
  businessName: string;
  patientName: string;
  serviceName: string;
  doctorName: string;
  branchName?: string;
  date: string;
  time: string;
  reference: string;
};

/** Digits only, keeps country code (e.g. 2010…). */
export function whatsappDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function buildBookingWhatsAppMessage(details: BookingWhatsAppDetails): string {
  const lines = [
    `${details.businessName} — appointment confirmation`,
    `Hi ${details.patientName},`,
    `Your visit is booked.`,
    `Service: ${details.serviceName}`,
    `Doctor: ${details.doctorName}`,
    details.branchName ? `Clinic: ${details.branchName}` : '',
    `When: ${details.date} at ${details.time}`,
    `Reference: ${details.reference}`,
    `Please pay at the clinic. Reply if you need to change the time.`,
  ].filter(Boolean);
  return lines.join('\n');
}

/** Opens WhatsApp with a prefilled confirmation (works without Meta Cloud API). */
export function bookingWhatsAppUrl(phone: string, details: BookingWhatsAppDetails): string | null {
  const to = whatsappDigits(phone);
  if (to.length < 8) return null;
  return `https://wa.me/${to}?text=${encodeURIComponent(buildBookingWhatsAppMessage(details))}`;
}

export function openBookingWhatsApp(phone: string, details: BookingWhatsAppDetails): boolean {
  const url = bookingWhatsAppUrl(phone, details);
  if (!url || typeof window === 'undefined') return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
