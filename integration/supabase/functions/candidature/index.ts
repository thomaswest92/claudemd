// Point d'entrée public de la page de candidature.
// Reçoit (en JSON, envoyé en text/plain pour éviter une requête préalable du navigateur) :
//   { type: "visite" | "clic_cta" | "video_25" | "video_50" | "video_75" | "video_100", utm }
//   { type: "candidature", id, statut: "partielle" | "complète", whatsapp, instagram, sans_instagram, q1..q5, utm, site }
//   { type: "commentaire", id, texte }
// Écrit avec la clé service : la page n'a aucun accès direct à la base.
// Déploiement : supabase functions deploy candidature --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";
import * as R from "../_shared/regles.ts";
import { analyserLead } from "../_shared/analyse.ts";
import { notifierNouveauLead } from "../_shared/notifier.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  db: { schema: "tunnel" },
  auth: { persistSession: false },
});

// Origines autorisées, séparées par des virgules (ex. "https://candidature.tondomaine.fr"). Vide = toutes.
const ORIGINES = (Deno.env.get("ORIGINES_AUTORISEES") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
// Correspondance utm_source -> nom lisible, ex. {"louis":"Compte de Louis","b2b":"Compte commun"}
const SOURCES: Record<string, string> = JSON.parse(Deno.env.get("SOURCES_LISIBLES") ?? '{"louis":"Compte de Louis","b2b":"Compte commun"}');
const LIMITE_PAR_IP = 60; // envois par fenêtre de 10 minutes (une candidature fait une dizaine d'envois partiels)

function entetes(origine: string | null): HeadersInit {
  const ok = !ORIGINES.length || (origine && ORIGINES.includes(origine));
  return {
    "Access-Control-Allow-Origin": ok ? (origine ?? "*") : ORIGINES[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}
const repondre = (corps: unknown, statut: number, origine: string | null) =>
  new Response(JSON.stringify(corps), { status: statut, headers: entetes(origine) });

async function ipHachee(req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "inconnue";
  const sel = Deno.env.get("SEL_IP") ?? "sorciers";
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sel + ip));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const origine = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: entetes(origine) });
  if (req.method !== "POST") return repondre({ ok: false }, 405, origine);
  if (ORIGINES.length && origine && !ORIGINES.includes(origine)) return repondre({ ok: false }, 403, origine);

  const brut = await req.text();
  if (brut.length > 30000) return repondre({ ok: false, erreur: "trop long" }, 413, origine);
  let d: Record<string, unknown>;
  try { d = JSON.parse(brut); } catch { return repondre({ ok: false, erreur: "json" }, 400, origine); }

  // Champ piège rempli : c'est un robot. On répond "ok" sans rien enregistrer.
  if (typeof d.site === "string" && d.site.trim()) return repondre({ ok: true }, 200, origine);

  // Limite d'envois par adresse IP (l'adresse n'est jamais stockée en clair).
  const { data: compteur } = await supabase.rpc("compter_envoi", { p_ip_hache: await ipHachee(req) });
  if (typeof compteur === "number" && compteur > LIMITE_PAR_IP) return repondre({ ok: false, erreur: "trop d'envois" }, 429, origine);

  const utm = R.utm(d.utm);

  // Mesure d'audience sans cookie
  if (R.TYPES_EVENEMENT.includes(d.type as typeof R.TYPES_EVENEMENT[number])) {
    await supabase.from("evenements").insert({ type: d.type, utm_source: utm.source ?? null, utm_campaign: utm.campaign ?? null, referrer: utm.referrer ?? null });
    return repondre({ ok: true }, 200, origine);
  }

  const cle = R.cleFormulaire(d.id);
  if (!cle) return repondre({ ok: false, erreur: "id" }, 400, origine);

  if (d.type === "commentaire") {
    const t = R.texte(d.texte, 1000);
    if (t) await supabase.from("leads").update({ commentaire_lead: t }).eq("cle_formulaire", cle);
    return repondre({ ok: true }, 200, origine);
  }
  if (d.type !== "candidature") return repondre({ ok: false, erreur: "type" }, 400, origine);

  const whatsapp = R.whatsapp(d.whatsapp);
  const sansInstagram = d.sans_instagram === true;
  const instagram = sansInstagram ? null : R.instagram(d.instagram);
  if (!whatsapp || (!sansInstagram && !instagram)) return repondre({ ok: false, erreur: "contact" }, 400, origine);

  const { data: existant } = await supabase.from("leads").select("id, statut").eq("cle_formulaire", cle).maybeSingle();
  const complete = d.statut === "complète";
  const premierEnvoiComplet = complete && (!existant || existant.statut === "partielle");

  const champs: Record<string, unknown> = {
    cle_formulaire: cle,
    whatsapp,
    whatsapp_valide: d.whatsapp_valide === true,
    instagram,
    sans_instagram: sansInstagram,
    q1_presentation: R.texte(d.q1),
    q2_activite: R.texte(d.q2),
    q3_revenus: R.tranche(d.q3),
    q4_situation_financiere: R.texte(d.q4),
    q5_reseaux: R.texte(d.q5),
  };
  if (!existant) {
    Object.assign(champs, {
      source: R.sourceLisible(utm, SOURCES), utm_source: utm.source ?? null, utm_medium: utm.medium ?? null,
      utm_campaign: utm.campaign ?? null, utm_content: utm.content ?? null, referrer: utm.referrer ?? null,
    });
  }
  if (premierEnvoiComplet) {
    const { data: table } = await supabase.from("reglages").select("valeur").eq("cle", "argent_par_tranche").single();
    Object.assign(champs, {
      statut: "nouveau",
      depose_le: new Date().toISOString(),
      argent_auto: R.couleurParTranche(champs.q3_revenus as string | null, (table?.valeur ?? {}) as Record<string, string>),
      argent_explication: R.explicationParTranche(champs.q3_revenus as string | null),
      analyse_etat: "en_attente",
    });
  }

  const requete = existant
    ? supabase.from("leads").update(champs).eq("id", existant.id).select("id").single()
    : supabase.from("leads").insert(champs).select("id").single();
  const { data: lead, error } = await requete;
  if (error || !lead) {
    console.error("candidature : écriture impossible", error);
    return repondre({ ok: false }, 500, origine);
  }

  if (premierEnvoiComplet) {
    // Après la réponse à la page : analyse par Claude, puis e-mail au setter et aux admins.
    const suite = (async () => {
      await analyserLead(supabase, lead.id);
      await notifierNouveauLead(supabase, lead.id);
    })();
    // @ts-ignore EdgeRuntime existe sur Supabase Edge Functions
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(suite); else await suite;
  }
  return repondre({ ok: true }, 200, origine);
});
