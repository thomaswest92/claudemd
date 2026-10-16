#!/usr/bin/env python3
"""Fabrique les deux versions de la page de candidature à partir de src/page.html.

- page-candidature.html : maquette publiée sur Claude (rien n'est envoyé).
- site/index.html : vraie page à déposer sur Netlify, branchée sur le Google Sheet.

Usage :
    python3 tunnel/build.py                          # maquette seulement
    python3 tunnel/build.py --envoi https://script.google.com/macros/s/XXX/exec --whatsapp 33612345678
"""
import argparse
import base64
import pathlib
import re

ICI = pathlib.Path(__file__).resolve().parent
COCHE = ('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#24123f"/>'
         '<path d="m7 12.5 3.2 3.2L17 9" fill="none" stroke="#c9a227" stroke-width="2.4" '
         'stroke-linecap="round" stroke-linejoin="round"/></svg>')


COCHE_PETITE = ('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4L18 8" fill="none" stroke="#c9a227" '
                'stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>')
FLECHE = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" '
          'stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>')
HORLOGE = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
           'stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>')
BULLE = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
         'stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>')


COCHE_OR = ('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#c9a227"/>'
            '<path d="m7 12.5 3.2 3.2L17 9" fill="none" stroke="#24123f" stroke-width="2.4" '
            'stroke-linecap="round" stroke-linejoin="round"/></svg>')
COCHE_VERTE = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" '
               'stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>')
CADENAS = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
           'stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>')
WHATSAPP = ('<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.3.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.2-.2-.4-.3z"/></svg>')
INSTAGRAM = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
             'stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/>'
             '<circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>')


def logo_data() -> str:
    return "data:image/png;base64," + base64.b64encode((ICI / "assets" / "logo-violet-200.png").read_bytes()).decode()


def remplir(source: str, envoi: str, whatsapp: str = "") -> str:
    return (source.replace("{{LOGO}}", logo_data())
                  .replace("{{COCHE_OR}}", COCHE_OR)
                  .replace("{{COCHE_VERTE}}", COCHE_VERTE)
                  .replace("{{CADENAS}}", CADENAS)
                  .replace("{{WHATSAPP_NUMERO}}", whatsapp)
                  .replace("{{WHATSAPP}}", WHATSAPP)
                  .replace("{{INSTAGRAM}}", INSTAGRAM)
                  .replace("{{COCHE_PETITE}}", COCHE_PETITE)
                  .replace("{{COCHE}}", COCHE)
                  .replace("{{FLECHE}}", FLECHE)
                  .replace("{{HORLOGE}}", HORLOGE)
                  .replace("{{BULLE}}", BULLE)
                  .replace("{{ENDPOINT}}", envoi))


def page_complete(contenu: str) -> str:
    # La page Netlify a besoin d'un vrai document HTML autour du contenu.
    titre = re.search(r"<title>.*?</title>\n?", contenu).group(0)
    contenu = contenu.replace(titre, "", 1)
    tete = ("<!doctype html>\n<html lang=\"fr\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n"
            "<title>L'Académie des Sorciers : dépose ta candidature</title>\n"
            "<meta name=\"description\" content=\"Deviens impossible à ignorer. Dépose ta candidature pour un appel.\">\n"
            "<meta name=\"theme-color\" content=\"#ffffff\">\n"
            "<meta property=\"og:title\" content=\"Deviens impossible à ignorer\">\n"
            "<meta property=\"og:description\" content=\"Dépose ta candidature pour un appel avec L'Académie des Sorciers.\">\n"
            "<meta property=\"og:type\" content=\"website\">\n"
            "<link rel=\"icon\" type=\"image/png\" href=\"" + logo_data() + "\">\n"
            "<meta name=\"robots\" content=\"noindex\">\n")
    return tete + "</head>\n<body>\n" + contenu + "\n</body>\n</html>\n"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--envoi", default="", help="URL du Google Apps Script (se termine par /exec)")
    p.add_argument("--whatsapp", default="", help="Numéro WhatsApp de l'Académie, format international sans + (ex. 33612345678)")
    a = p.parse_args()
    if a.envoi and not re.fullmatch(r"https://script\.google\.com/macros/s/[\w-]+/exec", a.envoi):
        raise SystemExit("L'adresse doit ressembler à https://script.google.com/macros/s/.../exec")
    whatsapp = re.sub(r"\D", "", a.whatsapp)
    if a.whatsapp and not 8 <= len(whatsapp) <= 15:
        raise SystemExit("Le numéro WhatsApp doit être au format international, par exemple 33612345678")

    source = (ICI / "src" / "page.html").read_text(encoding="utf-8")
    (ICI / "page-candidature.html").write_text(remplir(source, ""), encoding="utf-8")
    print("Maquette : tunnel/page-candidature.html")
    outil = (ICI / "src" / "outil.html").read_text(encoding="utf-8").replace("{{LOGO}}", logo_data())
    (ICI / "maquette-outil.html").write_text(outil, encoding="utf-8")
    print("Maquette de l'outil : tunnel/maquette-outil.html")
    if a.envoi:
        (ICI / "site").mkdir(exist_ok=True)
        (ICI / "site" / "index.html").write_text(page_complete(remplir(source, a.envoi, whatsapp)), encoding="utf-8")
        print("Page Netlify : tunnel/site/index.html (branchée sur " + a.envoi + ")")


if __name__ == "__main__":
    main()
