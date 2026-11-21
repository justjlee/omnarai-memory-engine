# sealed/ — intentionally empty

Real sealed material (the secret seed, family templates, expected answers, hidden checks, canaries, raw model outputs) must
never be in this repository, its history, a Vercel build, npm, a log or a public artifact. `.gitignore` is not a security
control; keep it OUT of the working tree altogether.

- Draw a sealed set: `node --import ./scripts/lib/register-mem-blob.mjs scripts/inheritance-001/lab.mjs draw-sealed --out <path outside the repo>`
  (refuses a path inside the repo, refuses to overwrite, writes mode 600, prints only the public commitments).
- Proposed location: `Claude/omnarai-private/inheritance-001/` (private iCloud folder, not a git repository).
- `run-models` refuses a sealed file that resolves inside the repository, and writes live results only outside it.
