import type { Extra, MoveType } from './lead.ts';
import type { Locale } from './locale.ts';

/** Always English, so the sheet stays one consistent dataset. */
const SHEET_MOVE_TYPE_LABELS: Record<MoveType, string> = {
  apartment: 'Apartment',
  house: 'House',
  office: 'Office',
};

const SHEET_EXTRA_LABELS: Record<Extra, string> = {
  packing: 'Packing',
  furniture_assembly: 'Furniture disassembly and assembly',
  storage: 'Temporary storage',
  piano_fragile: 'Piano or fragile items',
};

/**
 * Callers pass values already escaped (HTML) or `oneLine()`'d (text); no entry escapes on its own.
 */
export interface Messages {
  numberLocale: string;
  dateLocale: string;
  dateFormat: string;
  moveTypes: Record<MoveType, string>;
  extras: Record<Extra, string>;
  noExtras: string;
  rooms: (rooms: number) => string;
  teamSubject: (reference: string, origin: string, destination: string, date: string) => string;
  teamLabels: { name: string; phone: string; whatsapp: string; email: string; moveDate: string; route: string; type: string; extras: string; estimate: string; reference: string };
  route: (origin: string, destination: string, km: string) => string;
  customerSubject: (siteName: string) => string;
  greeting: (name: string) => string;
  customerLabels: { estimate: string; route: string; moveDate: string; moveType: string; extras: string; reference: string };
  routeValue: (origin: string, destination: string) => string;
  disclaimer: string;
  nextStep: string;
  /** `whatsAppLink` is an `<a>` already built from validated digits, or '' to leave that half out. */
  questions: (phone: string, whatsAppLink: string) => string;
  demoNotice: (siteName: string) => string;
}

export const MESSAGES: Record<Locale, Messages> = {
  en: {
    numberLocale: 'en-US',
    dateLocale: 'en',
    dateFormat: 'cccc, LLLL d, yyyy',
    moveTypes: SHEET_MOVE_TYPE_LABELS,
    extras: SHEET_EXTRA_LABELS,
    noExtras: 'None',
    rooms: (rooms) => (rooms >= 5 ? '5 or more rooms' : rooms === 1 ? '1 room' : `${String(rooms)} rooms`),
    teamSubject: (reference, origin, destination, date) => `New lead ${reference}: ${origin} to ${destination} on ${date}`,
    teamLabels: { name: 'Name', phone: 'Phone', whatsapp: 'WhatsApp', email: 'Email', moveDate: 'Move date', route: 'Route', type: 'Type', extras: 'Extras', estimate: 'Estimate', reference: 'Reference' },
    route: (origin, destination, km) => `${origin} to ${destination} (${km} km)`,
    customerSubject: (siteName) => `Your moving estimate from ${siteName}`,
    greeting: (name) => `Hi ${name},`,
    customerLabels: { estimate: 'Your estimate', route: 'Route', moveDate: 'Move date', moveType: 'Move type', extras: 'Extras', reference: 'Reference' },
    routeValue: (origin, destination) => `${origin} to ${destination}`,
    disclaimer: 'This is an estimate. We confirm the final price after a visit or video call.',
    nextStep: 'A member of our team will call you to schedule a short visit or video call and confirm the final price.',
    questions: (phone, whatsAppLink) => (whatsAppLink === '' ? `Questions? Call us at ${phone}.` : `Questions? Call us at ${phone} or write on WhatsApp: ${whatsAppLink}`),
    demoNotice: (siteName) => `${siteName} is a fictional company for a portfolio demo.`,
  },
  es: {
    numberLocale: 'es-CO',
    dateLocale: 'es',
    dateFormat: "cccc d 'de' LLLL 'de' yyyy",
    moveTypes: { apartment: 'Apartamento', house: 'Casa', office: 'Oficina' },
    extras: {
      packing: 'Embalaje',
      furniture_assembly: 'Desarme y armado de muebles',
      storage: 'Almacenamiento temporal',
      piano_fragile: 'Piano u objetos frágiles',
    },
    noExtras: 'Ninguno',
    rooms: (rooms) => (rooms >= 5 ? '5 o más habitaciones' : rooms === 1 ? '1 habitación' : `${String(rooms)} habitaciones`),
    teamSubject: (reference, origin, destination, date) => `Nueva solicitud ${reference}: ${origin} a ${destination} el ${date}`,
    teamLabels: {
      name: 'Nombre',
      phone: 'Teléfono',
      whatsapp: 'WhatsApp',
      email: 'Correo',
      moveDate: 'Fecha de la mudanza',
      route: 'Ruta',
      type: 'Tipo',
      extras: 'Servicios adicionales',
      estimate: 'Estimado',
      reference: 'Referencia',
    },
    route: (origin, destination, km) => `${origin} a ${destination} (${km} km)`,
    customerSubject: (siteName) => `Su cotización de mudanza de ${siteName}`,
    greeting: (name) => `Hola, ${name}:`,
    customerLabels: { estimate: 'Su estimado', route: 'Ruta', moveDate: 'Fecha de la mudanza', moveType: 'Tipo', extras: 'Servicios adicionales', reference: 'Referencia' },
    routeValue: (origin, destination) => `${origin} a ${destination}`,
    disclaimer: 'Este valor es un estimado. Confirmamos el precio final después de una visita o una videollamada.',
    nextStep: 'Una persona de nuestro equipo se comunicará con usted para programar una visita corta o una videollamada y confirmar el precio final.',
    questions: (phone, whatsAppLink) => (whatsAppLink === '' ? `¿Preguntas? Llámenos al ${phone}.` : `¿Preguntas? Llámenos al ${phone} o escríbanos por WhatsApp: ${whatsAppLink}`),
    demoNotice: (siteName) => `${siteName} es una empresa ficticia para una demostración de portafolio.`,
  },
};
