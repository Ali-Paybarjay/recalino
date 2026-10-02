// SPIKE-05 only (M4): drives the cloud measurements from the owner's machine against the protected
// deployment. Removed with the spike code (T6). Secrets are read from files and never printed.
//
//   node tools/spikes/cloud-drive.mjs <deploymentUrl> <step> [arg]
//   steps: protection | queue | crash | crash-status <jobId> | blob | chunks | compose |
//          ffmpeg <audio file name> | cleanup
//
// Files live outside the repository, in RECALINO_SPIKE_DIR (default: ~/.recalino-spike):
//   spike-token.txt     the SPIKE_TOKEN value set in Vercel (production)
//   bypass-secret.txt   the deployment protection bypass for automation
//   audio/              synthetic audio, made with ffmpeg (see the spike report)
//   chunk-ids.json      written by "chunks", read by "compose"
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const DIR = process.env.RECALINO_SPIKE_DIR ?? join(homedir(), ".recalino-spike");
const [base, step, arg] = process.argv.slice(2);
const token = readFileSync(join(DIR, "spike-token.txt"), "utf8").trim();
const bypass = readFileSync(join(DIR, "bypass-secret.txt"), "utf8").trim();
const results = [];
const log = (label, value) => {
  results.push({ label, value });
  console.log(label, JSON.stringify(value));
};

async function call(action, body = {}) {
  const started = performance.now();
  const response = await fetch(`${base}/dev/spike/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-spike-token": token,
      "x-vercel-protection-bypass": bypass,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: response.status, ms: Math.round(performance.now() - started), json };
}

async function put(url, bytes, type) {
  const started = performance.now();
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": type },
    body: bytes,
  });
  return {
    status: response.status,
    ms: Math.round(performance.now() - started),
    body: (await response.text()).slice(0, 200),
  };
}

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const md5 = (bytes) => createHash("md5").update(bytes).digest("hex");

switch (step) {
  case "protection": {
    for (const path of ["/", "/api/health", "/dev/spike/queue-burst"]) {
      const bare = await fetch(`${base}${path}`, { redirect: "manual" });
      log(`no bypass ${path}`, bare.status);
    }
    const ok = await fetch(`${base}/api/health`, {
      headers: { "x-vercel-protection-bypass": bypass },
    });
    log("bypass /api/health", { status: ok.status, body: await ok.text() });
    const noToken = await fetch(`${base}/dev/spike/queue-burst`, {
      method: "POST",
      headers: { "x-vercel-protection-bypass": bypass, "content-type": "application/json" },
      body: "{}",
    });
    log("spike route without token", noToken.status);
    break;
  }
  case "queue": {
    const burst = await call("queue-burst", { count: 20 });
    log("burst", { status: burst.status, ms: burst.ms, enqueueMs: burst.json.enqueueMs });
    const ids = burst.json.ids ?? [];
    for (let i = 0; i < 20; i += 1) {
      await sleep(3000);
      const status = await call("queue-status", { ids });
      const states = status.json.jobs?.map((job) => job.state) ?? [];
      const done = states.filter((state) => state === "succeeded").length;
      const latency = status.json.jobs
        ?.filter((job) => job.finished_at)
        .map((job) => new Date(job.finished_at) - new Date(job.created_at));
      log(`after ${(i + 1) * 3}s`, { succeeded: done, of: ids.length, latencyMs: latency });
      if (done === ids.length) break;
    }
    break;
  }
  case "crash": {
    const crash = await call("queue-crash");
    log("crash enqueued", crash.json);
    break;
  }
  case "crash-status": {
    const status = await call("queue-status", { ids: [arg] });
    log("crash status", status.json);
    break;
  }
  case "blob": {
    const png = new Uint8Array(4096).map((_, i) => i % 251);
    const link = await call("blob-put-link", {
      contentType: "image/png",
      size: png.byteLength,
      seconds: 60,
    });
    log("put link", { status: link.status, ms: link.ms, serverMs: link.json.ms });
    const url = link.json.url;
    log("wrong type", await put(url, png, "image/jpeg"));
    log("too large", await put(url, new Uint8Array(png.byteLength + 1), "image/png"));
    log("right", await put(url, png, "image/png"));
    log("again (no overwrite)", await put(url, png, "image/png"));
    const head = await call("blob-head", { id: link.json.id });
    log("head", { ...head.json, md5: md5(png) });
    log(
      "confirm with sha256",
      (await call("blob-confirm", { id: link.json.id, sha256: sha(png) })).json,
    );
    const short = await call("blob-put-link", {
      contentType: "image/png",
      size: png.byteLength,
      seconds: 2,
    });
    await sleep(4000);
    log("expired link", await put(short.json.url, png, "image/png"));
    const read = await call("blob-get-link", { id: link.json.id, seconds: 120 });
    const got = await fetch(read.json.url);
    const bytes = new Uint8Array(await got.arrayBuffer());
    log("read", { status: got.status, sameBytes: sha(bytes) === sha(png) });
    const shortRead = await call("blob-get-link", { id: link.json.id, seconds: 2 });
    await sleep(4000);
    log("expired read", (await fetch(shortRead.json.url)).status);
    const del = await call("blob-delete", { id: link.json.id });
    log("delete", del.json);
    const deletedAt = Date.now();
    for (let i = 0; i < 30; i += 1) {
      const response = await fetch(read.json.url);
      const uncached = await fetch(`${read.json.url}&cache=0`);
      log(`after delete ${Math.round((Date.now() - deletedAt) / 1000)}s`, {
        cached: response.status,
        uncached: uncached.status,
      });
      if (response.status === 404 || response.status === 403) break;
      await sleep(5000);
    }
    break;
  }
  case "chunks": {
    // 170 MB in 8 MB chunks, each its own object; the "connection" drops after chunk 6.
    const file = readFileSync(join(DIR, "audio", "class-180min-128k.m4a"));
    const size = 8 * 1024 * 1024;
    const chunks = [];
    for (let offset = 0; offset < file.byteLength; offset += size)
      chunks.push(file.subarray(offset, offset + size));
    const ids = [];
    for (const chunk of chunks) {
      const link = await call("blob-put-link", {
        contentType: "audio/mp4",
        size: chunk.byteLength,
        seconds: 600,
      });
      ids.push({ id: link.json.id, url: link.json.url });
    }
    const timings = [];
    for (const [i, chunk] of chunks.entries()) {
      if (i === 6) break; // interrupted
      const result = await put(ids[i].url, chunk, "audio/mp4");
      timings.push(result.ms);
    }
    const verified = [];
    for (const [i, entry] of ids.entries()) {
      const confirm = await call("blob-confirm", { id: entry.id, sha256: sha(chunks[i]) });
      verified.push(confirm.json.result);
    }
    log("after interruption", {
      verified: verified.filter((r) => r === "verified").length,
      of: ids.length,
    });
    for (const [i, chunk] of chunks.entries()) {
      if (verified[i] === "verified") continue;
      const result = await put(ids[i].url, chunk, "audio/mp4");
      timings.push(result.ms);
      const confirm = await call("blob-confirm", { id: ids[i].id, sha256: sha(chunk) });
      verified[i] = confirm.json.result;
    }
    log("chunks", {
      count: chunks.length,
      verified: verified.filter((r) => r === "verified").length,
      uploadMs: timings,
      confirmSample: verified.slice(0, 3),
    });
    writeFileSync(join(DIR, "chunk-ids.json"), JSON.stringify(ids.map((entry) => entry.id)));
    break;
  }
  case "compose": {
    const ids = JSON.parse(readFileSync(join(DIR, "chunk-ids.json"), "utf8"));
    for (const method of ["stream", "multipart"]) {
      const result = await call("blob-compose", { ids, method });
      log(`compose ${method}`, { status: result.status, ms: result.ms, ...result.json });
    }
    break;
  }
  case "ffmpeg": {
    const file = readFileSync(join(DIR, "audio", arg));
    const type = arg.endsWith(".m4a") ? "audio/mp4" : "audio/webm";
    const link = await call("blob-put-link", {
      contentType: type,
      size: file.byteLength,
      seconds: 1800,
    });
    const upload = await put(link.json.url, file, type);
    log("upload", { bytes: statSync(join(DIR, "audio", arg)).size, ...upload });
    log("confirm", (await call("blob-confirm", { id: link.json.id })).json);
    const run = await call("ffmpeg", { id: link.json.id });
    log("ffmpeg", { status: run.status, ms: run.ms, ...run.json });
    break;
  }
  case "cleanup": {
    log("cleanup", (await call("cleanup")).json);
    break;
  }
  default:
    console.log("unknown step");
}
