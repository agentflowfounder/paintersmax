import type { ImageSlotDef, TemplateConfig } from "../../src/sitetheme.ts";

/**
 * Template 2: "Sunset Sand" (design brief 2026-11-16, Phase 2 draft).
 * Quiet and photo-led: cream and sand pages, espresso text, thin column hairlines, a flared caps serif, and three
 * big words across the hero. Original design and code. Inspiration was a full-page screenshot of an interior studio
 * site sent by Rogelio (2026-11-16); none of its name, text, photos, video, logo or code are used.
 *
 * Drawn by templates/sunset-sand/render.ts; the platform blocks are shared with the other templates.
 */
const STYLE = "Photorealistic interior photography, soft diffused daylight, calm and uncluttered, warm neutral palette of cream, sand, oak and espresso, natural textures, shot on a full-frame camera with a 35mm lens, no text, no logos, no watermarks, no recognizable faces.";

/** Three more scene ideas per photo space (the first prompt is the one in imageSlots). The editor rotates through the four so new users do not all start from the same prompt. Same size and subject for the space. */
const ALTS: Record<string, string[]> = {
  "HOME-HERO": [
    "Wide shot of an open dining area with freshly painted warm cream walls, a round oak table, linen chairs and tall windows with soft side light.",
    "Wide shot of a quiet bedroom with freshly painted soft sand walls, a low linen bed, a wood bench and morning light from a large window.",
    "Wide shot of a bright entry hall with freshly painted warm white walls, an arched doorway, an oak console table and a ceramic bowl in soft daylight.",
  ],
  "HERO-CARD": [
    "Painter in white overalls seen from behind cutting in a ceiling edge with a small brush on a stepladder, drop cloths below.",
    "Close view of a painter's hands rolling warm cream paint onto a wall, taped trim, soft window light.",
    "Painter in a cap seen from the side painting a door frame with a brush, canvas drop cloth on the floor.",
  ],
  "PAGE-HERO": [
    "Quiet living room corner with freshly painted warm white walls, a floor lamp and an oak shelf, soft daylight.",
    "Quiet stairway with freshly painted cream walls and a sand colored railing, soft daylight from a side window.",
    "Quiet kitchen nook with freshly painted warm walls, a small oak table and a linen runner, soft morning light.",
  ],
  "STORY-1": [
    "Close detail of crisp white painted baseboard meeting a warm cream wall, soft light.",
    "Close detail of a freshly painted door edge with a clean sand colored line, soft light.",
    "Close detail of crisp painted crown molding against a warm white ceiling, soft light.",
  ],
  "STORY-2": [
    "Overhead view of a paint roller and tray with warm sand colored paint on a drop cloth.",
    "A row of closed paint cans with hand-lettered sand and cream swatches beside a brush on a drop cloth.",
    "A hand holding a color swatch card against a freshly painted warm wall, soft light.",
  ],
  "STORY-3": [
    "Living room wall painted a soft clay color behind a linen sofa and an oak side table.",
    "Hallway painted a calm greige with an oak bench and a woven basket.",
    "Dining room wall painted a warm cream with a simple oak sideboard and a ceramic vase.",
  ],
  "STORY-4": [
    "Bathroom with freshly painted warm white walls, an oak vanity and brass fixtures.",
    "Home office with freshly painted soft sage walls, an oak desk and a linen chair.",
    "Front door freshly painted a deep walnut tone beside crisp white trim, soft light.",
  ],
  "SERVICE-PHOTO": [
    "Freshly painted dining room in a warm neutral tone, one oak table, soft light.",
    "Freshly painted hallway in a soft cream tone with a runner rug and an oak console, soft light.",
    "Freshly painted bedroom in a calm sand tone with a linen bed, soft light.",
  ],
  "CITIES-PHOTO": [
    "Front of a two-story home with freshly painted warm cream siding, white trim and a wide porch, soft morning light.",
    "Front of a brick home with freshly painted sand colored trim and a deep green door, soft light.",
    "Side view of a single-story home with freshly painted warm gray siding and a wooden fence, soft light.",
  ],
  "WORK-FEATURE": [
    "Dim, moody dining room with deep warm painted walls and a single pendant light, evening.",
    "Dim, moody bedroom with deep clay colored walls and a bedside lamp glowing, evening.",
    "Dim, moody hallway with deep espresso colored walls and a warm wall light, evening.",
  ],
  "BA-BEFORE": [
    "Bedroom before painting: dull beige walls with scuffs and nail holes, bed covered with a sheet, flat daylight.",
    "Kitchen before painting: faded cabinets with chipped edges and worn paint, flat daylight.",
    "Hallway before painting: yellowed walls with scratches and a patched corner, flat daylight.",
  ],
  "BA-AFTER": [
    "The same bedroom after painting: smooth soft sand walls, crisp white trim, bed made, soft light.",
    "The same kitchen after painting: smooth greige cabinets, brass pulls, soft light.",
    "The same hallway after painting: smooth warm cream walls, crisp white trim, soft light.",
  ],
  "PROCESS-PHOTO": [
    "Room prepared for painting: furniture moved to the center under plastic, taped window trim, soft light.",
    "Close view of masking tape lines on baseboards with a putty knife and sanding block on a drop cloth, soft light.",
    "Paint cans, brushes and rollers neatly lined up on a canvas drop cloth in a prepared room, soft light.",
  ],
  "REVIEW-PHOTO": [
    "Cozy living room with a freshly painted warm wall, a linen sofa and a throw blanket, soft evening light.",
    "Sunlit kitchen with freshly painted warm walls and a bowl of lemons on an oak counter.",
    "Quiet bedroom with a freshly painted sand wall, a linen bed and a small plant, morning light.",
  ],
  "CTA-BAND": [
    "Wide, dark and calm living room with deep painted walls and a single lamp, evening.",
    "Wide, dark and calm dining room with deep clay walls and soft window light, dusk.",
    "Wide, dark and calm entry hall with deep espresso walls and a warm wall light, dusk.",
  ],
};
const withAlts = (list: ImageSlotDef[]): ImageSlotDef[] =>
  list.map((sl) => ({ ...sl, prompts: [sl.prompt, ...(ALTS[sl.slot] ?? []).map((sc) => `${sc} ${STYLE} Aspect ratio ${sl.ratio}, ${sl.w}x${sl.h} pixels.`)] }));

export const config: TemplateConfig = {
  configVersion: 1,
  id: "sunset-sand",
  name: "Sunset Sand",
  version: "1.0.0",
  class: "basic",
  description: {
    en: "Calm and elegant. Big photos, thin lines, three large words across the top, and lots of quiet space.",
    es: "Tranquilo y elegante. Fotos grandes, líneas finas, tres palabras grandes en la portada y mucho espacio.",
  },
  inspiration: "Full-page screenshot of an interior design studio site (sent by Rogelio 2026-11-16). Layout ideas only: column hairlines, three-word hero, numbered rows, service list that swaps the photo, dark project band, giant footer wordmark.",
  license: "All code, text, icons and layout are original PaintersMax work. Fonts: Marcellus and Jost (SIL Open Font License, Google Fonts; checked 2026-11-16). No third-party photos or video; image slots are filled by the painter or labeled AI placeholders.",
  tokens: [
    { key: "c-bg", label: { en: "Page", es: "Página" }, type: "color", default: "#f6f3ee", editable: true },
    { key: "c-bg2", label: { en: "Sand bands", es: "Franjas arena" }, type: "color", default: "#efe9df", editable: true },
    { key: "c-surface", label: { en: "Cards", es: "Tarjetas" }, type: "color", default: "#fbf9f5", editable: true },
    { key: "c-ink", label: { en: "Text", es: "Texto" }, type: "color", default: "#1c1a17", editable: true },
    { key: "c-ink-soft", label: { en: "Soft text", es: "Texto suave" }, type: "color", default: "#6b655c", editable: true },
    { key: "c-line", label: { en: "Hairlines", es: "Líneas finas" }, type: "color", default: "#dcd6cc", editable: true },
    { key: "c-brand", label: { en: "Dark bands", es: "Franjas oscuras" }, type: "color", default: "#1c1a17", editable: true },
    { key: "c-brand-ink", label: { en: "Text on dark", es: "Texto sobre oscuro" }, type: "color", default: "#f6f3ee", editable: true },
    { key: "c-accent", label: { en: "Walnut (links, buttons)", es: "Nogal (enlaces, botones)" }, type: "color", default: "#6e4f31", editable: true },
    { key: "c-accent2", label: { en: "Sand gold (on dark)", es: "Arena dorada (sobre oscuro)" }, type: "color", default: "#a8865f", editable: true },
    { key: "c-fade", label: { en: "Faded headline words", es: "Palabras atenuadas" }, type: "color", default: "#8a857d", editable: true },
  ],
  fonts: [
    { key: "display", label: { en: "Headlines", es: "Títulos" }, default: "Marcellus", editable: true },
    { key: "body", label: { en: "Text", es: "Texto" }, default: "Jost", editable: true },
  ],
  pages: ["home", "services", "gallery", "about", "contact", "service", "custom"],
  sections: [
    { key: "hero", label: { en: "Top banner (three words)", es: "Portada (tres palabras)" }, pages: ["home", "services", "gallery", "about", "contact", "service", "custom"], enabled: true, order: 0, required: true, editableFields: ["image", "text"] },
    { key: "statement", label: { en: "Our story with four photos", es: "Nuestra historia con cuatro fotos" }, pages: ["home", "about"], enabled: true, order: 10, editableFields: ["toggle", "order", "text", "image"] },
    { key: "services", label: { en: "Services list with photo", es: "Lista de servicios con foto" }, pages: ["home", "services"], enabled: true, order: 20, editableFields: ["toggle", "order", "image"] },
    { key: "content", label: { en: "Your page sections", es: "Sus secciones" }, pages: ["home", "services", "gallery", "about", "contact", "service", "custom"], enabled: true, order: 30, required: true, editableFields: ["text", "image", "order"] },
    { key: "cities", label: { en: "Cities served (numbered rows)", es: "Ciudades (filas numeradas)" }, pages: ["home", "about", "contact"], enabled: true, order: 40, editableFields: ["toggle", "order", "image"] },
    { key: "gallery_ba", label: { en: "Selected work, before and after", es: "Trabajos, antes y después" }, pages: ["home", "gallery", "service"], enabled: true, order: 50, editableFields: ["toggle", "order", "image"] },
    { key: "process", label: { en: "How a job works (four steps)", es: "Cómo trabajamos (cuatro pasos)" }, pages: ["home", "services", "service", "about"], enabled: true, order: 60, editableFields: ["toggle", "order", "text", "image"] },
    { key: "instant_quote", label: { en: "Instant quote", es: "Presupuesto al instante" }, pages: ["home", "services", "service", "contact"], enabled: true, order: 70, editableFields: ["toggle", "order"] },
    { key: "color_studio", label: { en: "Color Studio", es: "Estudio de color" }, pages: ["home", "services", "service"], enabled: true, order: 80, editableFields: ["toggle", "order"] },
    { key: "color_studio_ai", label: { en: "Color Studio on their photo", es: "Estudio de color con su foto" }, pages: ["home"], enabled: true, order: 81, editableFields: ["toggle", "order"] },
    { key: "review_request", label: { en: "Reviews (one at a time)", es: "Reseñas (una a la vez)" }, pages: ["home", "about"], enabled: true, order: 90, editableFields: ["toggle", "order", "image"] },
    { key: "business_info", label: { en: "Business info", es: "Datos del negocio" }, pages: ["contact", "about"], enabled: true, order: 100, editableFields: ["toggle", "order", "text"] },
    { key: "maps", label: { en: "Map", es: "Mapa" }, pages: ["home", "about", "contact"], enabled: true, order: 110, editableFields: ["toggle", "order"] },
    { key: "weather", label: { en: "Painting weather", es: "Clima para pintar" }, pages: ["home"], enabled: true, order: 115, editableFields: ["toggle", "order"] },
    { key: "chat_helper", label: { en: "Chat helper", es: "Ayudante de chat" }, pages: ["home", "contact", "services", "service"], enabled: true, order: 120, editableFields: ["toggle", "order"] },
    { key: "voice_chat", label: { en: "Live voice AI", es: "Voz con IA" }, pages: ["home"], enabled: true, order: 121, editableFields: ["toggle", "order"] },
    { key: "estimate_request", label: { en: "Estimate request form", es: "Formulario de presupuesto" }, pages: ["contact"], enabled: true, order: 130, editableFields: ["toggle", "order"] },
    { key: "cta", label: { en: "Closing band (phone and email)", es: "Franja final (teléfono y correo)" }, pages: ["home", "services", "gallery", "about", "service", "custom"], enabled: true, order: 140, editableFields: ["toggle", "order", "image", "text"] },
  ],
  blocks: ["business_info", "services", "cities", "instant_quote", "color_studio", "color_studio_ai", "gallery_ba", "maps", "chat_helper", "estimate_request", "review_request", "weather", "voice_chat", "image_ai"],
  i18n: {
    en: {
      skip: "Skip to content", menu: "Menu", openMenu: "Open menu", closeMenu: "Close menu", quote: "Free quote", getQuote: "Get a quote", call: "Call", callNow: "Call now", inquire: "Free estimate",
      hero1: "Fresh Coat", hero2: "Colors You Love", hero3: "{city}", heroLabel: "Painting", heroSub: "Interior and exterior painting", heroText: "Careful prep, clean lines and a crew that leaves your home tidy every day.", heroLink: "See our work", heroCard: "Before and after", heroVideo: "Meet the crew", heroVideoSoon: "Create Video in dashboard", heroVideoUrl: "",
      stEyebrow: "Our story", stTitle: "We paint homes the way we would want ours painted.", stTitleFade: "Prepared well, finished clean, on the day we said.", stLink: "About us",
      services: "Services", servicesTitle: "What we paint", servicesLink: "See this service",
      citiesEyebrow: "Service area", citiesTitle: "Cities we serve", citiesText: "Tap a city to see our work and reviews there.",
      baEyebrow: "Selected work", baTitle: "Before and after", baHint: "Drag the handle to compare.", before: "Before", after: "After", allWork: "All", metaService: "Service", metaCity: "City", metaYear: "Year", metaSize: "Size",
      prEyebrow: "How it works", prTitle: "Four simple steps", pr1: "Free estimate", pr1Text: "We visit, measure and give you a written price.", pr2: "Prep", pr2Text: "We cover floors and furniture, fill holes, sand and tape.", pr3: "Paint", pr3Text: "Two coats where needed, clean lines on trim and edges.", pr4: "Walkthrough", pr4Text: "We check every room with you before we call it done.",
      iqEyebrow: "Instant quote", iqTitle: "See a price range in seconds.", iqText: "Answer a few questions about the job. You get a range right away and we follow up with a written estimate.", iqOpen: "Start my quote",
      csEyebrow: "Color Studio", csTitle: "Try a color before we paint.", csText: "Tap a color to see it on the walls of this sample room.", csNote: "Colors on screens look different from paint. We bring real samples to your home.",
      csAiTitle: "See a color on your own wall", csAiText: "Upload a photo of your room and see the new color on your own walls.",
      reviewsEyebrow: "Reviews", reviewsTitle: "What our customers say", reviewsGoogle: "Read and write reviews on Google", reviewsAsk: "Finished a job with us? Your review link comes by text or email.", of: "of",
      bizTitle: "Business details", phone: "Phone", email: "Email", license: "License", hours: "Hours", area: "Service area", address: "Address", follow: "Follow us",
      mapTitle: "Where we work", mapNote: "Map", openMaps: "Open in Google Maps", directions: "Get directions",
      weatherTitle: "Painting weather this week",
      chatTitle: "Have a question?", chatText: "Ask us anything about your project. We answer by text or email.", chatPlaceholder: "Type your question", chatSend: "Send", voiceTitle: "Talk to us live",
      erEyebrow: "Free estimate", erTitle: "Tell us about your project.", firstName: "First name", lastName: "Last name", emailField: "Email", phoneField: "Phone", zip: "ZIP code", details: "What should we paint?", consent: "I agree to be contacted about my estimate.", submit: "Send", sent: "Thanks! We got your request and will be in touch soon.", formErr: "Please add your name and a valid email.",
      ctaTitle: "Ready for a fresh coat?", ctaText: "Call, write, or get a price range now.",
      footerTitle: "Get a free estimate", pages: "Pages", studio: "Visit and hours", contact: "Contact", rights: "All rights reserved.", privacy: "Privacy", terms: "Terms", by: "Website by PaintersMax", insured: "Insured", proof: "Proof of insurance", founding: "Founding painter",
      lang: "Español", langCode: "es", prev: "Previous", next: "Next", photoSoon: "Photo coming soon",
    },
    es: {
      skip: "Saltar al contenido", menu: "Menú", openMenu: "Abrir menú", closeMenu: "Cerrar menú", quote: "Presupuesto gratis", getQuote: "Pedir presupuesto", call: "Llamar", callNow: "Llamar ahora", inquire: "Presupuesto gratis",
      hero1: "Pintura Nueva", hero2: "Colores Que Ama", hero3: "{city}", heroLabel: "Pintura", heroSub: "Pintura de interiores y exteriores", heroText: "Preparación cuidadosa, líneas limpias y un equipo que deja su casa ordenada cada día.", heroLink: "Ver trabajos", heroCard: "Antes y después", heroVideo: "Conozca al equipo", heroVideoSoon: "Cree el video en el panel", heroVideoUrl: "",
      stEyebrow: "Nuestra historia", stTitle: "Pintamos cada casa como nos gustaría que pintaran la nuestra.", stTitleFade: "Bien preparada, bien terminada y en el día acordado.", stLink: "Nosotros",
      services: "Servicios", servicesTitle: "Lo que pintamos", servicesLink: "Ver este servicio",
      citiesEyebrow: "Área de servicio", citiesTitle: "Ciudades donde trabajamos", citiesText: "Toque una ciudad para ver nuestros trabajos y reseñas allí.",
      baEyebrow: "Trabajos", baTitle: "Antes y después", baHint: "Deslice para comparar.", before: "Antes", after: "Después", allWork: "Todos", metaService: "Servicio", metaCity: "Ciudad", metaYear: "Año", metaSize: "Tamaño",
      prEyebrow: "Cómo trabajamos", prTitle: "Cuatro pasos sencillos", pr1: "Presupuesto gratis", pr1Text: "Visitamos, medimos y le damos un precio por escrito.", pr2: "Preparación", pr2Text: "Cubrimos pisos y muebles, rellenamos hoyos, lijamos y encintamos.", pr3: "Pintura", pr3Text: "Dos capas donde hace falta y líneas limpias en molduras y bordes.", pr4: "Revisión final", pr4Text: "Revisamos cada cuarto con usted antes de terminar.",
      iqEyebrow: "Presupuesto al instante", iqTitle: "Vea un rango de precio en segundos.", iqText: "Conteste unas preguntas del trabajo. Verá un rango al instante y le enviamos un presupuesto por escrito.", iqOpen: "Empezar mi presupuesto",
      csEyebrow: "Estudio de color", csTitle: "Pruebe un color antes de pintar.", csText: "Toque un color para verlo en las paredes de este cuarto de muestra.", csNote: "Los colores en pantalla se ven distintos a la pintura. Llevamos muestras reales a su casa.",
      csAiTitle: "Vea un color en su propia pared", csAiText: "Suba una foto de su cuarto y vea el color nuevo en sus paredes.",
      reviewsEyebrow: "Reseñas", reviewsTitle: "Lo que dicen nuestros clientes", reviewsGoogle: "Lea y escriba reseñas en Google", reviewsAsk: "¿Terminó un trabajo con nosotros? Su enlace para la reseña llega por mensaje o correo.", of: "de",
      bizTitle: "Datos del negocio", phone: "Teléfono", email: "Correo", license: "Licencia", hours: "Horario", area: "Área de servicio", address: "Dirección", follow: "Síganos",
      mapTitle: "Dónde trabajamos", mapNote: "Mapa", openMaps: "Abrir en Google Maps", directions: "Cómo llegar",
      weatherTitle: "Clima para pintar esta semana",
      chatTitle: "¿Tiene una pregunta?", chatText: "Pregúntenos lo que quiera de su proyecto. Respondemos por mensaje o correo.", chatPlaceholder: "Escriba su pregunta", chatSend: "Enviar", voiceTitle: "Hable con nosotros en vivo",
      erEyebrow: "Presupuesto gratis", erTitle: "Cuéntenos de su proyecto.", firstName: "Nombre", lastName: "Apellido", emailField: "Correo", phoneField: "Teléfono", zip: "Código postal", details: "¿Qué quiere pintar?", consent: "Acepto que me contacten sobre mi presupuesto.", submit: "Enviar", sent: "¡Gracias! Recibimos su solicitud y le contactaremos pronto.", formErr: "Agregue su nombre y un correo válido.",
      ctaTitle: "¿Listo para una capa nueva?", ctaText: "Llame, escriba o vea un rango de precio ahora.",
      footerTitle: "Pida su presupuesto gratis", pages: "Páginas", studio: "Visítenos y horario", contact: "Contacto", rights: "Todos los derechos reservados.", privacy: "Privacidad", terms: "Términos", by: "Sitio web por PaintersMax", insured: "Asegurados", proof: "Comprobante de seguro", founding: "Pintor fundador",
      lang: "English", langCode: "en", prev: "Anterior", next: "Siguiente", photoSoon: "Foto muy pronto",
    },
  },
  imageSlots: withAlts([
    { slot: "HOME-HERO", section: "hero", w: 1920, h: 1200, ratio: "16:10", alt: { en: "Calm living room with freshly painted warm walls", es: "Sala tranquila con paredes recién pintadas en tono cálido" }, prompt: `Wide shot of a calm, minimal living room with freshly painted warm cream walls, oak floor, low linen sofa, a single ceramic vase, soft side light from tall windows. ${STYLE} Aspect ratio 16:10, 1920x1200 pixels.` },
    { slot: "HERO-CARD", section: "hero", w: 640, h: 400, ratio: "16:10", alt: { en: "Painter at work", es: "Pintor trabajando" }, prompt: `Painter in white overalls seen from behind rolling a soft sand color onto a wall, drop cloths, taped trim. ${STYLE} Aspect ratio 16:10, 640x400 pixels.` },
    { slot: "PAGE-HERO", section: "hero", w: 1920, h: 900, ratio: "2:1", alt: { en: "Quiet hallway with fresh paint", es: "Pasillo tranquilo con pintura nueva" }, prompt: `Quiet hallway with freshly painted warm white walls and a sand colored accent door, oak bench, soft daylight. ${STYLE} Aspect ratio 2:1, 1920x900 pixels.` },
    { slot: "STORY-1", section: "statement", w: 600, h: 750, ratio: "4:5", alt: { en: "Freshly painted trim detail", es: "Detalle de moldura recién pintada" }, prompt: `Close detail of crisp white painted window trim against a warm cream wall, soft light. ${STYLE} Aspect ratio 4:5, 600x750 pixels.` },
    { slot: "STORY-2", section: "statement", w: 600, h: 750, ratio: "4:5", alt: { en: "Paint brush and open can", es: "Brocha y lata de pintura abierta" }, prompt: `Angled brush resting on an open can of warm sand colored paint on a drop cloth. ${STYLE} Aspect ratio 4:5, 600x750 pixels.` },
    { slot: "STORY-3", section: "statement", w: 600, h: 750, ratio: "4:5", alt: { en: "Bedroom with a soft clay wall", es: "Recámara con pared color arcilla" }, prompt: `Bedroom with a soft clay painted wall behind a linen bed, wood nightstand. ${STYLE} Aspect ratio 4:5, 600x750 pixels.` },
    { slot: "STORY-4", section: "statement", w: 600, h: 750, ratio: "4:5", alt: { en: "Kitchen cabinets freshly painted", es: "Gabinetes de cocina recién pintados" }, prompt: `Kitchen with freshly painted greige cabinets, brass pulls, stone counter. ${STYLE} Aspect ratio 4:5, 600x750 pixels.` },
    { slot: "SERVICE-PHOTO", section: "services", w: 1200, h: 1500, ratio: "4:5", alt: { en: "Freshly painted room", es: "Cuarto recién pintado" }, prompt: `Freshly painted room in a warm neutral tone, one piece of oak furniture, soft light. ${STYLE} Aspect ratio 4:5, 1200x1500 pixels.` },
    { slot: "CITIES-PHOTO", section: "cities", w: 900, h: 1350, ratio: "2:3", alt: { en: "Front of a freshly painted home", es: "Fachada de una casa recién pintada" }, prompt: `Front porch of a single-story home with freshly painted warm white siding and a walnut stained door, mature trees, soft morning light. ${STYLE} Aspect ratio 2:3, 900x1350 pixels.` },
    { slot: "WORK-FEATURE", section: "gallery_ba", w: 1920, h: 1080, ratio: "16:9", alt: { en: "Finished painting project", es: "Proyecto de pintura terminado" }, prompt: `Dim, moody living space with deep warm painted walls and a single lamp glowing, evening. ${STYLE} Aspect ratio 16:9, 1920x1080 pixels.` },
    { slot: "BA-BEFORE", section: "gallery_ba", w: 1200, h: 900, ratio: "4:3", alt: { en: "Room before painting", es: "Cuarto antes de pintar" }, prompt: `Living room before painting: scuffed beige walls with patched nail holes and faded paint, furniture covered with drop cloths, flat daylight. ${STYLE} Aspect ratio 4:3, 1200x900 pixels.` },
    { slot: "BA-AFTER", section: "gallery_ba", w: 1200, h: 900, ratio: "4:3", alt: { en: "Same room after painting", es: "El mismo cuarto después de pintar" }, prompt: `The same living room after painting: smooth warm cream walls, crisp white trim, furniture back in place, soft light. ${STYLE} Aspect ratio 4:3, 1200x900 pixels.` },
    { slot: "PROCESS-PHOTO", section: "process", w: 900, h: 1350, ratio: "2:3", alt: { en: "Taped trim and drop cloths ready for paint", es: "Molduras encintadas y lonas listas para pintar" }, prompt: `Room prepared for painting: taped baseboards, floor covered with canvas drop cloths, ladder, soft window light. ${STYLE} Aspect ratio 2:3, 900x1350 pixels.` },
    { slot: "REVIEW-PHOTO", section: "review_request", w: 900, h: 1125, ratio: "4:5", alt: { en: "Finished room", es: "Cuarto terminado" }, prompt: `Reading corner with a freshly painted warm wall, linen armchair and a floor lamp. ${STYLE} Aspect ratio 4:5, 900x1125 pixels.` },
    { slot: "CTA-BAND", section: "cta", w: 1920, h: 800, ratio: "12:5", alt: { en: "Painted room at dusk", es: "Cuarto pintado al anochecer" }, prompt: `Wide, dark and calm room with deep painted walls at dusk, a soft window glow. ${STYLE} Aspect ratio 12:5, 1920x800 pixels.` },
  ]),
  imageProvider: { kind: "inhouse", endpoint: "/api/site/image-ai", ready: false, creditFeature: null },
  seo: { schemaType: "HousePainter", ogImageSlot: "HOME-HERO" },
  contact: { name: "Sand Creek Painting", phone: "(903) 555-0163", email: "hello@sandcreekpainting.example", address: "200 Sample Lane", city: "Tyler", state: "TX", hours: "Mon to Fri 8 AM to 5 PM" },
  mapsMode: "worker-key",
};
