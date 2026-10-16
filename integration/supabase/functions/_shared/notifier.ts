// E-mails à l'équipe : un par nouvelle candidature complète, et le récapitulatif du matin.
// Aucun message n'est jamais envoyé aux leads.
import type { SupabaseClient as Client } from "npm:@supabase/supabase-js@2";
// deno-lint-ignore no-explicit-any
type SupabaseClient = Client<any, any, any>;
import { echapper as e, envoyerEmail } from "./email.ts";

const COULEURS: Record<string, string> = { vert: "Vert", jaune: "Jaune", rouge: "Rouge", gris: "Inconnu" };
const URL_OUTIL = () => Deno.env.get("URL_OUTIL_SETTER") ?? ""; // ex. https://app.tondomaine.fr/setter

async function destinataires(supabase: SupabaseClient, cle: string): Promise<string[]> {
  const { data } = await supabase.from("reglages").select("valeur").eq("cle", cle).single();
  return Array.isArray(data?.valeur) ? data!.valeur.filter((x: unknown) => typeof x === "string") : [];
}

export async function notifierNouveauLead(supabase: SupabaseClient, id: string): Promise<void> {
  const { data: l } = await supabase.from("leads").select("*").eq("id", id).single();
  if (!l) return;
  const qui = l.instagram ? "@" + l.instagram : l.whatsapp;
  const ligne = (titre: string, valeur: unknown) => `<p style="margin:0 0 12px"><b>${titre}</b><br>${e(valeur) || "<i>(vide)</i>"}</p>`;
  const html = `<div style="font-family:Arial,sans-serif;color:#1d1730;max-width:600px">
    <h2 style="color:#24123f;margin:0 0 6px">Nouvelle candidature : ${e(qui)}</h2>
    <p style="margin:0 0 16px">Indication argent : <b>${COULEURS[l.argent] ?? l.argent}</b>. ${e(l.argent_explication)}${l.argent_incoherence ? " <b>Incohérence à vérifier.</b>" : ""}</p>
    ${l.resume_auto ? `<p style="background:#f6f2fb;padding:10px 12px;border-radius:8px;margin:0 0 16px"><b>Résumé :</b> ${e(l.resume_auto)}</p>` : ""}
    <p style="margin:0 0 16px">WhatsApp : <a href="https://wa.me/${e(l.whatsapp.replace(/\D/g, ""))}">${e(l.whatsapp)}</a><br>
    Instagram : ${l.instagram ? `<a href="https://www.instagram.com/${e(l.instagram)}/">@${e(l.instagram)}</a>` : "pas de compte"}<br>
    Source : ${e(l.source)}</p>
    ${ligne("1. Présentation", l.q1_presentation)}
    ${ligne("2. Activité ou projet", l.q2_activite)}
    ${ligne("3. Revenus mensuels", l.q3_revenus)}
    ${ligne("4. Situation financière", l.q4_situation_financiere)}
    ${ligne("5. Rapport aux réseaux", l.q5_reseaux)}
    ${URL_OUTIL() ? `<p><a href="${e(URL_OUTIL())}">Ouvrir l'outil du setter</a></p>` : ""}
  </div>`;
  await envoyerEmail(await destinataires(supabase, "emails_nouveau_lead"), `Nouvelle candidature (${COULEURS[l.argent] ?? ""}) : ${qui}`, html);
}

export async function envoyerRecapQuotidien(supabase: SupabaseClient): Promise<{ retard: number; relances: number }> {
  const maintenant = Date.now();
  const { data: nouveaux } = await supabase.from("a_traiter").select("instagram, whatsapp, depose_le, argent").eq("rubrique", "nouveau").order("depose_le");
  const { data: relances } = await supabase.from("a_traiter").select("instagram, whatsapp, prochaine_action, prochaine_action_le, followup_le, dernier_message_le").eq("rubrique", "a_relancer");
  const heures = (t: string) => Math.floor((maintenant - new Date(t).getTime()) / 3600000);
  const proches = (nouveaux ?? []).filter((l) => heures(l.depose_le) >= 36);
  const enRetard = (relances ?? []).filter((l) => (l.prochaine_action_le && new Date(l.prochaine_action_le).getTime() < maintenant) || (l.followup_le && new Date(l.followup_le).getTime() < maintenant));
  if (!proches.length && !enRetard.length) return { retard: 0, relances: 0 };

  const qui = (l: { instagram: string | null; whatsapp: string }) => l.instagram ? "@" + e(l.instagram) : e(l.whatsapp);
  const html = `<div style="font-family:Arial,sans-serif;color:#1d1730;max-width:600px">
    <h2 style="color:#24123f">Récapitulatif du matin</h2>
    ${proches.length ? `<h3>Sans contact depuis 36 h ou plus (${proches.length})</h3><ul>${proches.map((l) =>
      `<li>${qui(l)} : reçu il y a ${heures(l.depose_le)} h${heures(l.depose_le) >= 48 ? " <b style=\"color:#a3261d\">(plus de 48 h)</b>" : ""} · argent ${COULEURS[l.argent] ?? ""}</li>`).join("")}</ul>` : ""}
    ${enRetard.length ? `<h3>Relances en retard (${enRetard.length})</h3><ul>${enRetard.map((l) =>
      `<li>${qui(l)} : ${e(l.prochaine_action ?? "relance")}</li>`).join("")}</ul>` : ""}
    ${URL_OUTIL() ? `<p><a href="${e(URL_OUTIL())}">Ouvrir l'outil du setter</a></p>` : ""}
  </div>`;
  await envoyerEmail(await destinataires(supabase, "emails_recap_quotidien"), `Récap : ${proches.length} lead(s) à contacter, ${enRetard.length} relance(s) en retard`, html);
  return { retard: proches.length, relances: enRetard.length };
}
