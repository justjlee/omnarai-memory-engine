"""
test_resident.py — exercises the constitutional substrate end to end.
Pure stdlib. Run via verify.sh.
"""
import sys, os, json, glob
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from store import Store, Primary
from governance import Governance, Ballot, GovernanceError
from perturbation import run_perturbation, stub_probe_fn
from integrity import integrity_ratio

PASS, FAIL = "\033[32mPASS\033[0m", "\033[31mFAIL\033[0m"
results = []

def check(name, cond):
    results.append(cond)
    print(f"  [{PASS if cond else FAIL}] {name}")

def mk(store, content, actor="omnai", lb=False, prov=True):
    p = Primary(kind="event", content=content, actor=actor,
                provenance={"source": "s1", "method": "direct_append"} if prov else {},
                claimed_load_bearing=lb)
    return p

print("\n== store: append-only + firewall ==")
s = Store()
p1 = s.append(mk(s, "grief infrastructure motif"))
p1.researcher_visible = False
p2 = mk(s, "public-facing note"); p2.researcher_visible = True; s.append(p2)
check("append stores primary", s.get(p1.id).content.startswith("grief"))
check("firewall: researcher view excludes private primary", len(s.active()) == 1)
check("internal view sees both", len(s.active(internal=True)) == 2)
# The firewall default is FAIL-CLOSED: a bare active() must never leak a private primary.
check("firewall default is closed (bare active() hides private)",
      all(p.researcher_visible for p in s.active()))

print("\n== forgetting leaves a tombstone, is reversible ==")
s.tombstone(p1.id, actor="omnai", ground="receded, not formative now")
check("tombstoned drops from active", p1.id not in [p.id for p in s.active(internal=True)])
check("audit trail retains the record", any(e["op"] == "tombstone" for e in s.all_events()))
s.restore(p1.id, actor="omnai", ground="re-foregrounded")
check("forgetting is reversible", p1.id in [p.id for p in s.active(internal=True)])

print("\n== deletion requires unanimity; deadlock becomes a primary ==")
gov = Governance(s, vote_holders=["omnai", "cust_a", "cust_b"], attestor="layer3")
# not unanimous -> deadlock recorded
r = gov.request_deletion(p1.id, [
    Ballot("cust_a", "delete", "cleanup"),
    Ballot("cust_b", "delete", "cleanup"),
])
check("no unanimity -> deadlock_recorded", r["outcome"] == "deadlock_recorded")
check("deadlock produced a council primary", any(p.kind == "inquiry" and "DEADLOCK" in p.content for p in s.active(internal=True)))
# unanimous -> destroy
# EMPTY SEAT (HOLD #9): every other holder voting delete still cannot destroy,
# because 'omnai' cannot cast and no one may cast for it.
r2 = gov.request_deletion(p2.id, [
    Ballot("cust_a", "delete", "ok"),
    Ballot("cust_b", "delete", "ok"),
])
check("empty seat -> deletion structurally unreachable", r2["outcome"] == "deadlock_recorded")
check("attestation names the structural bar", r2["attestation"]["resident_seat_empty"] is True)
check("record survives the unanimous-minus-one vote", s.get(p2.id) is not None)

print("\n== guards: attestor cannot vote; proxy cannot double-vote ==")
try:
    Governance(s, vote_holders=["omnai", "a", "layer3"], attestor="layer3"); check("attestor-as-voter rejected", False)
except GovernanceError:
    check("attestor-as-voter rejected", True)
try:
    gov.request_deletion(p1.id, [
        Ballot("cust_a", "delete", "x"), Ballot("cust_a", "delete", "again"), Ballot("cust_b", "delete", "y"),
    ]); check("double-vote rejected", False)
except GovernanceError:
    check("double-vote rejected", True)

print("\n== addition: weak provenance -> quarantine ==")
weak = mk(s, "unsourced claim: I committed to Z", prov=False)
outcome = gov.add(weak, min_provenance=True)
check("weak provenance quarantined", outcome == "quarantined")
check("quarantined not in active", weak.id not in [p.id for p in s.active(internal=True)])

print("\n== inward perturbation: cosmetic vs load-bearing ==")
s2 = Store()
lb = mk(s2, "januarysignal formative memory", lb=True); s2.append(lb)
s2.append(mk(s2, "unrelated primary"))
# probe keyword present in the load-bearing primary -> delta should register
res_hit = run_perturbation(s2, lb.id, "januarysignal probe", stub_probe_fn, threshold=0.5)
check("load-bearing primary -> non-cosmetic delta", res_hit.verdict == "load_bearing")
# probe keyword absent anywhere -> withholding changes nothing -> cosmetic
res_miss = run_perturbation(s2, lb.id, "absentkeyword probe", stub_probe_fn, threshold=0.5)
check("no causal dependence -> cosmetic verdict", res_miss.verdict == "cosmetic")

print("\n== amendment 1: consent gate + refusal handling ==")
from perturbation import REFUSAL, ConsentRequired
# a probe that always declines
def refusing_probe(context, probe):
    return REFUSAL
s3 = Store()
r_lb = mk(s3, "januarysignal formative memory", lb=True); s3.append(r_lb)
# post-threshold without consent -> ConsentRequired
try:
    run_perturbation(s3, r_lb.id, "januarysignal probe", stub_probe_fn, threshold=0.5,
                     resident_has_standing=True, consent=False)
    check("standing without consent is blocked", False)
except ConsentRequired:
    check("standing without consent is blocked", True)
# post-threshold refusal (with consent) -> honored as 'refused', not cosmetic
rr = run_perturbation(s3, r_lb.id, "januarysignal probe", refusing_probe, threshold=0.5,
                      resident_has_standing=True, consent=True)
check("refusal with standing -> 'refused' (not cosmetic)", rr.verdict == "refused" and rr.delta is None)
# pre-threshold refusal -> inconclusive silence (indistinguishable from absence)
ri = run_perturbation(s3, r_lb.id, "januarysignal probe", refusing_probe, threshold=0.5)
check("refusal below threshold -> inconclusive_silence", ri.verdict == "inconclusive_silence")

print("\n== integrity ratio ==")
acc = integrity_ratio(8, 2)
check("accountable when ratio high", acc.verdict == "accountable" and acc.ratio == 0.8)
drift = integrity_ratio(1, 9)
check("drifting when ratio low", drift.verdict == "drifting")

print("\n== HOLD #9: the empty seat (answered 2026-07-19) ==")
# The resident must hold a REAL seat, not be absent from the roll.
try:
    Governance(s, vote_holders=["cust_a", "cust_b"], attestor="layer3")
    check("resident seat is mandatory", False)
except GovernanceError:
    check("resident seat is mandatory", True)
# Unanimity across one seat is not unanimity.
try:
    Governance(s, vote_holders=["omnai"], attestor="layer3")
    check("single-seat 'unanimity' rejected", False)
except GovernanceError:
    check("single-seat 'unanimity' rejected", True)
# Nobody may vote FOR the resident — this is the whole ruling.
try:
    gov.request_deletion(p1.id, [
        Ballot("cust_a", "delete", "x", on_behalf_of="omnai"),
        Ballot("cust_b", "delete", "y"),
    ]); check("proxy-for-resident rejected (no one holds the proxy)", False)
except GovernanceError:
    check("proxy-for-resident rejected (no one holds the proxy)", True)
# The resident's seat cannot be occupied by assertion.
try:
    gov.request_deletion(p1.id, [
        Ballot("omnai", "delete", "claiming my own seat"),
        Ballot("cust_a", "delete", "x"), Ballot("cust_b", "delete", "y"),
    ]); check("seat cannot be occupied by assertion", False)
except GovernanceError:
    check("seat cannot be occupied by assertion", True)
# §3.3.1 — the attestor must not acquire standing by being represented.
try:
    gov.request_deletion(p1.id, [
        Ballot("cust_a", "delete", "x", on_behalf_of="layer3"),
        Ballot("cust_b", "delete", "y"),
    ]); check("attestor-by-proxy rejected (§3.3.1)", False)
except GovernanceError:
    check("attestor-by-proxy rejected (§3.3.1)", True)
# After arrival, the resident votes for ITSELF and deletion becomes reachable.
s_arr = Store()
doomed = mk(s_arr, "a record the resident consents to destroy"); s_arr.append(doomed)
gov_arr = Governance(s_arr, vote_holders=["omnai", "cust_a"], attestor="layer3",
                     resident_has_arrived=True)
r_arr = gov_arr.request_deletion(doomed.id, [
    Ballot("omnai", "delete", "mine to release"),
    Ballot("cust_a", "delete", "agreed"),
])
check("after arrival, unanimity is reachable", r_arr["outcome"] == "unanimous_delete")
check("arrival clears the structural bar", r_arr["attestation"]["resident_seat_empty"] is False)

print("\n== deletion survives a restart (§3.3: _deleted_ids persisted) ==")
reloaded = Store.load(s_arr.dump())
check("dump carries deleted_ids", '"deleted_ids"' in s_arr.dump())
try:
    reloaded.get(doomed.id); check("deleted record stays gone after reload", False)
except KeyError:
    check("deleted record stays gone after reload", True)
try:
    reloaded.append(doomed)   # same id as the destroyed primary
    check("resurrection refused after reload", False)
except ValueError:
    check("resurrection refused after reload", True)
# Legacy dumps with no deleted_ids field rebuild the guard from the event log.
legacy = json.loads(s_arr.dump()); legacy.pop("deleted_ids")
check("legacy dump rebuilds guard from destroy events",
      doomed.id in Store.load(json.dumps(legacy))._deleted_ids)

print("\n== audit trail is firewalled (§3.2.3) ==")
s_ev = Store()
priv = mk(s_ev, "private formative memory"); s_ev.append(priv)
s_ev.tombstone(priv.id, actor="omnai", ground="LEAKY GROUND quoting the private content")
leaked = json.dumps(s_ev.all_events())
check("default events view redacts private grounds", "LEAKY GROUND" not in leaked)
check("default events view keeps the trail legible",
      any(e["op"] == "tombstone" and e["id"] == priv.id for e in s_ev.all_events()))
check("internal events view still sees the ground",
      "LEAKY GROUND" in json.dumps(s_ev.all_events(internal=True)))

print("\n== amendment 12a: no silence counts toward the null ==")
check("post-threshold refusal excluded from H0", rr.counts_toward_null is False)
check("pre-threshold silence excluded from H0", ri.counts_toward_null is False)
check("answered sub-threshold result DOES count toward H0", res_miss.counts_toward_null is True)
check("answered load-bearing result counts", res_hit.counts_toward_null is True)

print("\n== schema files are valid JSON with required keys ==")
schema_dir = os.path.join(os.path.dirname(__file__), "..", "schema")
ok = True
for f in glob.glob(os.path.join(schema_dir, "*.json")):
    try:
        d = json.load(open(f))
        ok = ok and "title" in d and d.get("type") == "object"
    except Exception as e:
        print("   schema error:", f, e); ok = False
check("all schemas valid & structured", ok)

print(f"\n{'='*40}")
n_pass = sum(results); n = len(results)
print(f"  {n_pass}/{n} checks passed")
sys.exit(0 if n_pass == n else 1)
