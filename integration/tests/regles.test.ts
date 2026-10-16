// node --experimental-strip-types integration/tests/regles.test.ts
import assert from "node:assert/strict";
import * as R from "../supabase/functions/_shared/regles.ts";

assert.equal(R.whatsapp("+33 6 12 34 56 78"), "+33612345678");
assert.equal(R.whatsapp("0033612345678"), "+33612345678");
assert.equal(R.whatsapp("12"), null);
assert.equal(R.instagram("@Coach.Lyon"), "Coach.Lyon");
assert.equal(R.instagram("https://www.instagram.com/coach_lyon/?hl=fr"), "coach_lyon");
assert.equal(R.instagram("coach..lyon"), null);
assert.equal(R.instagram("pas valide !"), null);
assert.equal(R.cleFormulaire("c9847ca2-9942-4b98-bf35-40ada97812c4"), "c9847ca2-9942-4b98-bf35-40ada97812c4");
assert.equal(R.cleFormulaire("x"), null);
assert.equal(R.tranche("5 000 à 10 000 €"), "5 000 à 10 000 €");
assert.equal(R.tranche("1 million"), null);
assert.deepEqual(R.utm({ source: "louis", campaign: "lancement", autre: "x" }), { source: "louis", campaign: "lancement" });
assert.equal(R.sourceLisible({ source: "Louis" }, { louis: "Compte de Louis" }), "Compte de Louis");
assert.equal(R.sourceLisible({}), "direct");
const table = { "Moins de 2 000 €": "rouge", "5 000 à 10 000 €": "vert" };
assert.equal(R.couleurParTranche("Moins de 2 000 €", table), "rouge");
assert.equal(R.couleurParTranche(null, table), "gris");
assert.equal(R.couleurParTranche("2 000 à 3 500 €", table), "gris");
assert.deepEqual(R.analyseValide({ indication: "jaune", explication: "x", incoherence: true, resume: "y" }), { indication: "jaune", explication: "x", incoherence: true, resume: "y" });
assert.equal(R.analyseValide({ indication: "bleu", explication: "x", incoherence: true, resume: "y" }), null);
assert.equal(R.texte("  "), null);
console.log("regles.ts : tous les tests passent");
