// Lecture d'une candidature par Claude : indication argent ajustée, incohérences, résumé du profil.
// Le modèle propose, il ne décide pas. En cas d'échec, l'indication reste celle de la tranche seule.
import Anthropic from "npm:@anthropic-ai/sdk";
import type { SupabaseClient as Client } from "npm:@supabase/supabase-js@2";
// deno-lint-ignore no-explicit-any
type SupabaseClient = Client<any, any, any>;
import { analyseValide, type Analyse } from "./regles.ts";

const MODELE = "claude-opus-5-5";

const CONSIGNES = `Tu aides le setter de L'Académie des Sorciers à préparer son premier contact avec un candidat.
L'Académie accompagne surtout des entrepreneurs B2B (coachs, consultants, artisans, prestataires) qui ont une activité mais restent invisibles en ligne, et aussi des porteurs de projet. Elle leur apprend à gagner en visibilité avec de courtes vidéos où ils se montrent, puis à transformer cette visibilité en clients. L'accompagnement est payant.

Tu reçois les réponses du candidat au questionnaire. Tu produis :
1. Une indication argent : vert (peut sans doute investir), jaune (à vérifier), rouge (peu de marge visible), gris (impossible à dire). Pars de la tranche de revenus (question 3), puis ajuste avec la situation financière décrite (question 4). Exemple : une tranche basse mais un chiffre d'affaires annuel élevé, ou une tranche haute mais des dettes.
2. Une explication d'une ligne.
3. incoherence = true si la tranche et le texte se contredisent.
4. Un résumé du profil en deux phrases maximum : qui est la personne, son activité ou son projet, où elle en est.

C'est une indication, pas une décision : le setter vérifie chaque lead en échangeant. N'invente rien, appuie-toi uniquement sur ce que le candidat a écrit. Si une réponse est vague, dis-le. Écris en français simple, phrases courtes, sans tiret cadratin.`;

const SCHEMA = {
  type: "object",
  properties: {
    indication: { type: "string", enum: ["vert", "jaune", "rouge", "gris"] },
    explication: { type: "string", description: "Une seule ligne." },
    incoherence: { type: "boolean" },
    resume: { type: "string", description: "Deux phrases maximum." },
  },
  required: ["indication", "explication", "incoherence", "resume"],
  additionalProperties: false,
};

interface Lead {
  id: string;
  q1_presentation: string | null;
  q2_activite: string | null;
  q3_revenus: string | null;
  q4_situation_financiere: string | null;
  q5_reseaux: string | null;
  commentaire_lead: string | null;
}

async function demanderAClaude(lead: Lead): Promise<Analyse> {
  const client = new Anthropic(); // lit ANTHROPIC_API_KEY
  const reponses = [
    `1. Présentation : ${lead.q1_presentation ?? "(vide)"}`,
    `2. Activité ou projet : ${lead.q2_activite ?? "(vide)"}`,
    `3. Revenus mensuels / chiffre d'affaires : ${lead.q3_revenus ?? "(vide)"}`,
    `4. Situation financière : ${lead.q4_situation_financiere ?? "(vide)"}`,
    `5. Rapport aux réseaux sociaux : ${lead.q5_reseaux ?? "(vide)"}`,
    lead.commentaire_lead ? `Commentaire ajouté après l'envoi : ${lead.commentaire_lead}` : "",
  ].filter(Boolean).join("\n\n");

  // deno-lint-ignore no-explicit-any
  const rep: any = await client.beta.messages.create({
    model: MODELE,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: CONSIGNES,
    messages: [{ role: "user", content: reponses }],
  // deno-lint-ignore no-explicit-any
  } as any);

  if (rep.stop_reason === "refusal") throw new Error("Le modèle a refusé de répondre");
  const blocs = (rep.content ?? []).filter((b: { type: string }) => b.type === "text");
  if (!blocs.length) throw new Error(`Réponse sans texte (${rep.stop_reason})`);
  const analyse = analyseValide(JSON.parse(blocs[blocs.length - 1].text));
  if (!analyse) throw new Error("Réponse au mauvais format");
  return analyse;
}

/** Analyse un lead et écrit le résultat. Ne lance jamais d'erreur : en cas d'échec, garde la tranche seule. */
export async function analyserLead(supabase: SupabaseClient, id: string): Promise<void> {
  const { data: lead, error } = await supabase.from("leads")
    .select("id, q1_presentation, q2_activite, q3_revenus, q4_situation_financiere, q5_reseaux, commentaire_lead")
    .eq("id", id).single();
  if (error || !lead) { console.error("analyse : lead introuvable", id, error); return; }

  if (!Deno.env.get("ANTHROPIC_API_KEY")) {
    await supabase.from("leads").update({ analyse_etat: "regle_seule", analyse_le: new Date().toISOString() }).eq("id", id);
    return;
  }
  try {
    const a = await demanderAClaude(lead as Lead);
    await supabase.from("leads").update({
      argent_auto: a.indication,
      argent_explication: a.explication,
      argent_incoherence: a.incoherence,
      resume_auto: a.resume,
      analyse_etat: "faite",
      analyse_le: new Date().toISOString(),
    }).eq("id", id);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
      console.error("analyse : erreur passagère, nouvel essai au prochain passage", id, e.message);
      return; // reste "en_attente", la tâche planifiée réessaiera
    }
    console.error("analyse : échec, indication par tranche seule", id, e);
    await supabase.from("leads").update({ analyse_etat: "regle_seule", analyse_le: new Date().toISOString() }).eq("id", id);
  }
}
