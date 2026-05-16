import { server } from "./server";
import { env, tier } from "../core/cfg";
import { mcp } from "../ai/mcp";
import { routes } from "./routes";
import {
    authenticate_api_request,
    log_authenticated_request,
} from "./middleware/auth";
import { start_background_jobs } from "./bg_jobs";
import { sendTelemetry } from "../core/telemetry";
import { req_tracker_mw } from "./routes/dashboard";
import { DbInitError } from "../core/identifiers";

// DB init now throws DbInitError instead of process.exit(1) (see src/core/db.ts).
// At the server boundary, surface that as a clean fatal exit so operators get a
// readable signal instead of an unhandled-rejection stack.
process.on("unhandledRejection", (err: unknown) => {
    if (err instanceof DbInitError) {
        console.error("[FATAL] DB init failed:", err.message);
        process.exit(1);
    }
    throw err;
});

const ASC = `   ____                   __  __
  / __ \\                 |  \\/  |
 | |  | |_ __   ___ _ __ | \\  / | ___ _ __ ___   ___  _ __ _   _
 | |  | | '_ \\ / _ \\ '_ \\| |\\/| |/ _ \\ '_ \` _ \\ / _ \\| '__| | | |
 | |__| | |_) |  __/ | | | |  | |  __/ | | | | | (_) | |  | |_| |
  \\____/| .__/ \\___|_| |_|_|  |_|\\___|_| |_| |_|\\___/|_|   \\__, |
        | |                                                 __/ |
        |_|                                                |___/ `;

const app = server({ max_payload_size: env.max_payload_size });

console.log(ASC);
console.log(`[CONFIG] Vector Dimension: ${env.vec_dim}`);
console.log(`[CONFIG] Cache Segments: ${env.cache_segments}`);
console.log(`[CONFIG] Max Active Queries: ${env.max_active}`);

if (env.emb_kind !== "synthetic" && (tier === "hybrid" || tier === "fast")) {
    console.warn(
        `[CONFIG] ⚠️  WARNING: Embedding configuration mismatch detected!\n` +
            `         OM_EMBEDDINGS=${env.emb_kind} but OM_TIER=${tier}\n` +
            `         Storage will use ${env.emb_kind} embeddings, but queries will use synthetic embeddings.\n` +
            `         This causes semantic search to fail. Set OM_TIER=deep to fix.`,
    );
}

if (env.bg_jobs === "worker") {
    console.log(`[BG_JOBS] Mode=worker — HTTP stripped to /health only`);

    // Minimal /health for the container healthcheck. No auth, no CORS,
    // no routes, no MCP. Worker exists to run background jobs.
    app.get("/health", (_req: any, res: any) => {
        res.status(200).json({ ok: true, mode: "worker" });
    });

    console.log(`[BG_JOBS] Starting background jobs`);
    start_background_jobs();

    console.log(`[SERVER] Starting on port ${env.port} (worker)`);
    app.listen(env.port, () => {
        console.log(
            `[SERVER] Worker running on http://localhost:${env.port}`,
        );
    });
} else {
    app.use(req_tracker_mw());

    app.use((req: any, res: any, next: any) => {
        const origin = req.headers.origin;
        const isIdeRoute = (req.path || req.url || "").startsWith("/api/ide/");
        const allowIdeOrigin =
            env.ide_mode &&
            typeof origin === "string" &&
            env.ide_allowed_origins.includes(origin);

        if (isIdeRoute && allowIdeOrigin) {
            res.setHeader("Access-Control-Allow-Origin", origin);
            res.setHeader("Vary", "Origin");
        } else {
            res.setHeader("Access-Control-Allow-Origin", "*");
        }
        res.setHeader(
            "Access-Control-Allow-Methods",
            "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        );
        res.setHeader(
            "Access-Control-Allow-Headers",
            "Content-Type,Authorization,x-api-key",
        );
        if (req.method === "OPTIONS") {
            res.status(200).end();
            return;
        }
        next();
    });

    app.use(authenticate_api_request);

    if (process.env.OM_LOG_AUTH === "true") {
        app.use(log_authenticated_request);
    }

    routes(app);

    mcp(app);
    if (env.mode === "langgraph") {
        console.log("[MODE] LangGraph integration enabled");
    }

    if (env.bg_jobs !== "off") {
        console.log(`[BG_JOBS] Mode=${env.bg_jobs} — starting background jobs`);
        start_background_jobs();
    } else {
        console.log(`[BG_JOBS] Mode=off — skipping background jobs (API replica)`);
    }

    console.log(`[SERVER] Starting on port ${env.port}`);
    app.listen(env.port, () => {
        console.log(`[SERVER] Running on http://localhost:${env.port}`);
        sendTelemetry().catch((err: any) => {
            // Telemetry must never crash the server. Surface the failure
            // to operators so silent breakage doesn't accumulate.
            console.error(
                "[TELEMETRY] sendTelemetry failed:",
                err && err.stack ? err.stack : err,
            );
        });
    });
}
