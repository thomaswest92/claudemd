// Règles pures, sans dépendance : validation des données reçues de la page.
// Testées avec : node --experimental-strip-types integration/tests/regles.test.ts

export type Couleur = "vert" | "jaune" | "rouge" | "gris";

export const TYPES_EVENEMENT = ["visite", "clic_cta", "video_25", "video_50", "video_75", "video_100"] as const;

export const TRANCHES = [
  "Moins de 2 000 €",
  "2 000 à 3 500 €",
  "3 500 à 5 000 €",
  "5 000 à 10 000 €",
  "10 000 à 30 000 €",
  "Plus de 30 000 €",
];

const MAX_TEXTE = 5000;

export function texte(v: unknown, max = MAX_TEXTE): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t.length ? t : null;
}

/** Numéro WhatsApp au format international : + puis 8 à 15 chiffres. */
export function whatsapp(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const chiffres = v.replace(/[^\d+]/g, "").replace(/^00/, "+");
  const nombre = chiffres.replace(/\D/g, "");
  if (nombre.length < 8 || nombre.length > 15) return null;
  return "+" + nombre;
}

/** Nom d'utilisateur Instagram nettoyé (sans @ ni lien), ou null s'il n'est pas valide. */
export function instagram(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const nom = v.trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/[/?#].*$/, "")
    .replace(/^@+/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(nom) || /^\.|\.$|\.\./.test(nom)) return null;
  return nom;
}

/** Identifiant de formulaire créé par la page (UUID ou repli "c-..."). */
export function cleFormulaire(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null;
}

export function tranche(v: unknown): string | null {
  return typeof v === "string" && TRANCHES.includes(v) ? v : null;
}

export interface Utm { source?: string; medium?: string; campaign?: string; content?: string; referrer?: string }

export function utm(v: unknown): Utm {
  const o: Utm = {};
  if (!v || typeof v !== "object") return o;
  for (const k of ["source", "medium", "campaign", "content", "referrer"] as const) {
    const t = texte((v as Record<string, unknown>)[k], 100);
    if (t) o[k] = t;
  }
  return o;
}

/** Source lisible pour le setter : "Compte de Louis", "Compte commun", ou la valeur brute. */
export function sourceLisible(u: Utm, correspondances: Record<string, string> = {}): string {
  if (u.source) return correspondances[u.source.toLowerCase()] ?? u.source;
  if (u.referrer) return u.referrer;
  return "direct";
}

export function couleurParTranche(t: string | null, table: Record<string, string>): Couleur {
  const c = t ? table[t] : undefined;
  return c === "vert" || c === "jaune" || c === "rouge" ? c : "gris";
}

export function explicationParTranche(t: string | null): string {
  return t ? `D'après la tranche choisie (${t}), avant lecture de la réponse 4.` : "Tranche de revenus non renseignée.";
}

/** Réponse attendue de Claude, vérifiée avant d'être écrite en base. */
export interface Analyse { indication: Couleur; explication: string; incoherence: boolean; resume: string }

export function analyseValide(v: unknown): Analyse | null {
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  const ind = a.indication;
  if (ind !== "vert" && ind !== "jaune" && ind !== "rouge" && ind !== "gris") return null;
  const explication = texte(a.explication, 300);
  const resume = texte(a.resume, 600);
  if (!explication || !resume || typeof a.incoherence !== "boolean") return null;
  return { indication: ind, explication, incoherence: a.incoherence, resume };
}
