# Atlas v1.0.0 — publish steps (HUMAN ACTION — xz pushes the button)

Everything in this directory is staged and verified (V1–V8: seven pass; V6 blocked on
Anthropic credits, see SESSION-LOG.md — V6 does not gate the Atlas push, only trace-delta).

Before pushing, decide the three staged questions in SESSION-LOG.md:
1. license (staged cc-by-sa-4.0 to match the already-published records; package proposed cc-by)
2. new dataset `omnarai-divergence-atlas` vs config of the existing dataset (staged as NEW per brief §4.3)
3. the card's perturbation section replaces the brief's "positions shift / axes stable" claim
   with the measured state — review that language

Then, from this directory (HF_TOKEN with write access; it rotates — check it first):

```bash
pip3 install --user -U huggingface_hub
python3 - <<'PY'
from huggingface_hub import HfApi
api = HfApi()  # uses HF_TOKEN env var
repo = "TheRealmsOfOmnarai/omnarai-divergence-atlas"
api.create_repo(repo, repo_type="dataset", private=True)   # private first; flip when ready
for f in ["README.md", "divergence-delta.schema.json", "manifest.json",
          "excluded.log", "review-needed.log", "data/atlas-v1.0.0.jsonl"]:
    api.upload_file(path_or_fileobj=f, path_in_repo=f, repo_id=repo, repo_type="dataset")
PY
```

After upload: verify the card renders, spot-check 2–3 records via /raw/ (not /resolve/ —
CDN caches), git-tag the repo (`git tag atlas-v1.0.0-published && git push --tags`), then
flip the HF repo public. Cross-link the new dataset from the existing corpus dataset's
README (and vice versa — 02 §4.8).
