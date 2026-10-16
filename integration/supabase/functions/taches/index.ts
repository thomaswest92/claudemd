// Tâches planifiées, appelées par pg_cron (voir la migration des tâches planifiées) :
//   { "tache": "recap_quotidien" }   e-mail du matin à l'équipe
//   { "tache": "analyses" }          relance les analyses restées "en attente" (erreur passagère)
// Protégée : n'accepte que la clé service dans l'en-tête Authorization.
import { createClient } from "npm:@supabase/supabase-js@2";
import { analyserLead } from "../_shared/analyse.ts";
import { envoyerRecapQuotidien } from "../_shared/notifier.ts";

const CLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, CLE, { db: { schema: "tunnel" }, auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.headers.get("authorization") !== `Bearer ${CLE}`) return new Response("Interdit", { status: 403 });
  const { tache } = await req.json().catch(() => ({ tache: null }));

  if (tache === "recap_quotidien") {
    return Response.json(await envoyerRecapQuotidien(supabase));
  }
  if (tache === "analyses") {
    const avant = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data } = await supabase.from("leads").select("id").eq("analyse_etat", "en_attente").lt("depose_le", avant).limit(10);
    for (const l of data ?? []) await analyserLead(supabase, l.id);
    return Response.json({ relancees: data?.length ?? 0 });
  }
  return new Response("Tâche inconnue", { status: 400 });
});
