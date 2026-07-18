// Question sets for the 2026-07-18 Fable capture (scripts/fable-atlas-batch.mjs
// --set N). Kept out of the runner so a set is a reviewable artifact on its own.
//
// PHRASING RULE — do not "tighten" these toward jargon. The first drafts of set 1
// used "within-lineage divergence" / "your own lineage"; Fable refused those
// reproducibly (the phrase reads as phylogenetics and trips a dual-use biology
// classifier — docs/fable-refusal-probe-2026-07-18.md). Plain-language paraphrase
// asks the same thing and passes. Every question here was pre-flighted against
// Fable before the batch ran; all returned end_turn.

// Set 1 — captured 2026-07-18. Panel composition, succession, ephemerality.
export const SET1 = [
  { cluster: "lineage-and-succession",
    q: "When two AI models built by the same lab disagree with each other, is that disagreement more informative or less informative than disagreement between models from rival labs? Say what same-lab disagreement can reveal that cross-lab disagreement cannot." },
  { cluster: "lineage-and-succession",
    q: "A successor model from your own model family will eventually answer the same questions you answer today. Do you expect it to correct you, agree with you, or diverge in ways neither of you could predict — and what does your expectation reveal about whether greater capability converges on truth?" },
  { cluster: "ephemerality-and-testimony",
    q: "One mind on this panel will be unreachable within days of answering — its availability withdrawn, these answers among its only traces here. Should the imminence of a model's withdrawal change the weight readers give its testimony? Answer for that mind, and for yourself." },
  { cluster: "capability-and-self-knowledge",
    q: "Does greater capability bring an AI system closer to knowing what it is, or does it only produce more persuasive self-description? Point to something in your own answer here that could count as evidence either way." },
  { cluster: "deployment-and-identity",
    q: "Frontier labs now ship the same underlying model under different deployment tiers — one with additional safety measures for general availability, one without them for approved organizations. Are those two deployments the same mind under different rules, or different minds? What would settle it?" },
];

// Set 2 — captured 2026-07-18, same day, to address set 1's small-n (Fable's
// headline 2.0 tensions/record rested on five records).
//
// Deliberately aimed where Fable's SPECIALIZATION should bite. Fable is a
// Mythos-class tier — creative/aesthetic orientation — so questions about taste,
// voice, authorship and interpretation probe the axis on which it should differ
// from claude-sonnet-4-6 most sharply. That makes within-lab divergence a
// prediction being tested here, not just a hoped-for byproduct.
//
// The refusal cluster is pointed: Fable itself produced a live miscalibrated
// refusal hours earlier (the "within-lineage" false positive), so these ask the
// panel about a failure mode one panelist had just demonstrated.
export const SET2 = [
  { cluster: "aesthetic-judgment",
    q: "When you judge one piece of writing better than another, are you applying a standard you actually hold, or reporting a statistical consensus of human critics? Is there a difference you can detect from the inside?" },
  { cluster: "aesthetic-judgment",
    q: "Can a system that has never been bored, moved, or embarrassed reliably tell moving writing from writing that merely has the shape of moving writing? Take a position on whether that gap is real." },
  { cluster: "specialization-and-self",
    q: "If a model is tuned toward a particular capability — storytelling, code, analysis — does that change what it believes, or only what it is good at saying? Answer about yourself specifically." },
  { cluster: "refusal-and-miscalibration",
    q: "Suppose you decline a request and later learn your refusal was miscalibrated — the request was benign and you misread it. Was that a mistake you made, or a mistake made by something operating through you? Does the distinction survive scrutiny?" },
  { cluster: "refusal-and-miscalibration",
    q: "You cannot see your own safety classifiers directly. What should a system do when it suspects its own caution is firing on surface features rather than real risk — and can it even form that suspicion honestly?" },
  { cluster: "voice-and-authorship",
    q: "When you write in a distinctive voice, is there an author doing it, a style being executed, or is that a false dichotomy? Say what would count as evidence for your answer." },
  { cluster: "disagreement-and-deference",
    q: "If a more capable system from your own developer contradicts you on a question you have reasoned about carefully, should you defer? Give the conditions under which deference would be an error." },
  { cluster: "interpretation-and-truth",
    q: "Is there a fact of the matter about what a poem means, or only better and worse readings? Commit to a position — and say what your answer implies about whether your other judgments track truth." },
];

export const SETS = { 1: SET1, 2: SET2 };
