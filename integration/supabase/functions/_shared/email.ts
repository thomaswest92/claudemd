// Envoi d'e-mails. Par défaut via Resend (https://resend.com), à remplacer par le service
// déjà utilisé par la plateforme si besoin : seule cette fonction est à changer.

export async function envoyerEmail(destinataires: string[], sujet: string, html: string): Promise<void> {
  const cle = Deno.env.get("RESEND_API_KEY");
  const expediteur = Deno.env.get("EMAIL_EXPEDITEUR"); // ex. "Académie des Sorciers <candidatures@tondomaine.fr>"
  if (!destinataires.length) return;
  if (!cle || !expediteur) { console.warn("E-mail non envoyé : RESEND_API_KEY ou EMAIL_EXPEDITEUR manquant"); return; }
  const rep = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${cle}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: expediteur, to: destinataires, subject: sujet, html }),
  });
  if (!rep.ok) console.error("E-mail refusé", rep.status, await rep.text());
}

export const echapper = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
