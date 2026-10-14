#!/usr/bin/env python3
"""Fabrique les deux versions de la page de candidature à partir de src/page.html.

- page-candidature.html : maquette publiée sur Claude (rien n'est envoyé).
- site/index.html : vraie page à déposer sur Netlify, branchée sur le Google Sheet.

Usage :
    python3 tunnel/build.py                          # maquette seulement
    python3 tunnel/build.py --envoi https://script.google.com/macros/s/XXX/exec
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


def logo_data() -> str:
    return "data:image/png;base64," + base64.b64encode((ICI / "assets" / "logo-violet-200.png").read_bytes()).decode()


def remplir(source: str, envoi: str) -> str:
    return (source.replace("{{LOGO}}", logo_data())
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
    a = p.parse_args()
    if a.envoi and not re.fullmatch(r"https://script\.google\.com/macros/s/[\w-]+/exec", a.envoi):
        raise SystemExit("L'adresse doit ressembler à https://script.google.com/macros/s/.../exec")

    source = (ICI / "src" / "page.html").read_text(encoding="utf-8")
    (ICI / "page-candidature.html").write_text(remplir(source, ""), encoding="utf-8")
    print("Maquette : tunnel/page-candidature.html")
    if a.envoi:
        (ICI / "site").mkdir(exist_ok=True)
        (ICI / "site" / "index.html").write_text(page_complete(remplir(source, a.envoi)), encoding="utf-8")
        print("Page Netlify : tunnel/site/index.html (branchée sur " + a.envoi + ")")


if __name__ == "__main__":
    main()
