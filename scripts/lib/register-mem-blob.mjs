// Redirect every import of "@vercel/blob" to the in-memory store, so the real
// handlers run unmodified and can never touch the production Blob store.
//
//   node --import ./scripts/lib/register-mem-blob.mjs <script>
import { registerHooks } from "node:module";

const target = new URL("./mem-blob.mjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@vercel/blob") return { url: target, shortCircuit: true, format: "module" };
    return nextResolve(specifier, context);
  },
});

// Hermetic by default: no secrets from the environment leak into a test run,
// so no code path can spend on a model call or reach a real store.
for (const k of ["BLOB_READ_WRITE_TOKEN", "PRIVATE_BLOB_READ_WRITE_TOKEN", "OPERATOR_PASSPHRASE_HASH", "OPERATOR_SESSION_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "DEEPSEEK_API_KEY", "AUTO_ADMIT_CONTRIBUTIONS"]) {
  if (process.env.MEM_BLOB_KEEP_ENV !== "1") delete process.env[k];
}
// The hermetic private store answers to this stand-in token (a test that checks
// fail-closed behaviour deletes it).
if (process.env.MEM_BLOB_KEEP_ENV !== "1") process.env.PRIVATE_BLOB_READ_WRITE_TOKEN = "mem-private-token";
await import(target); // installs the fetch shim before any handler loads
