// Inheritance study 001 — in-process network guard for every offline command.
//
// The engine's hermetic loader (scripts/lib/register-mem-blob.mjs) blocks fetch and swaps the Blob SDK; this also
// blocks node:http/https/net/tls, which the loader does not cover — so an offline run cannot reach any host by any
// path, and an attempt is counted and fails loudly instead of silently succeeding. Only the in-memory Blob origin
// (mem.blob.test, served inside this process) stays reachable.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

export const guardState = { installed: false, blocked: [] };
const MEM_ORIGIN = "https://mem.blob.test/";

export function installNetworkGuard() {
  if (guardState.installed) return guardState;
  const refuse = (what) => (...args) => {
    const a = args[0];
    const target = typeof a === "string" ? a : a?.url || a?.hostname || a?.host || a?.href || "?";
    guardState.blocked.push(`${what} ${String(target).slice(0, 80)}`);
    throw new Error(`HERMETIC_NETWORK_BLOCKED ${what} ${String(target).slice(0, 80)}`);
  };
  for (const [mod, name] of [[http, "http"], [https, "https"]]) { mod.request = refuse(`${name}.request`); mod.get = refuse(`${name}.get`); }
  net.connect = refuse("net.connect");
  net.createConnection = refuse("net.createConnection");
  tls.connect = refuse("tls.connect");
  syncBuiltinESMExports();
  const prior = globalThis.fetch;
  const blockFetch = refuse("fetch");
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input?.url || String(input);
    if (url.startsWith(MEM_ORIGIN) && prior) return prior(input, init);
    return blockFetch(url);
  };
  guardState.installed = true;
  return guardState;
}
