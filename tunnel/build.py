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


def remplir(source: str, envoi: str) -> str:
    logo = base64.b64encode((ICI / "assets" / "logo-violet-200.png").read_bytes()).decode()
    return (source.replace("{{LOGO}}", "data:image/png;base64," + logo)
                  .replace("{{COCHE}}", COCHE)
                  .replace("{{ENDPOINT}}", envoi))


def page_complete(contenu: str) -> str:
    # La page Netlify a besoin d'un vrai document HTML autour du contenu.
    titre = re.search(r"<title>.*?</title>\n?", contenu).group(0)
    contenu = contenu.replace(titre, "", 1)
    tete = ("<!doctype html>\n<html lang=\"fr\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n"
            "<title>L'Académie des Sorciers : dépose ta candidature</title>\n"
            "<meta name=\"description\" content=\"Deviens impossible à ignorer. Dépose ta candidature pour un appel.\">\n"
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
