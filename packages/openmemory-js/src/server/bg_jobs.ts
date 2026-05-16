import { env } from "../core/cfg";
import { run_decay_process, prune_weak_waypoints } from "../memory/hsg";
import { start_reflection } from "../memory/reflect";
import { start_user_summary_reflection } from "../memory/user_summary";

/**
 * Schedule all periodic background work: HSG decay, weak-waypoint
 * pruning, the initial bootstrap decay, and the two reflection loops.
 *
 * Called once at process start when env.bg_jobs !== "off".
 */
export function start_background_jobs(): void {
    const decayIntervalMs = env.decay_interval_minutes * 60 * 1000;
    console.log(
        `[DECAY] Interval: ${env.decay_interval_minutes} minutes (${decayIntervalMs / 1000}s)`,
    );

    setInterval(async () => {
        console.log("[DECAY] Running HSG decay process...");
        try {
            const result = await run_decay_process();
            console.log(
                `[DECAY] Completed: ${result.decayed}/${result.processed} memories updated`,
            );
        } catch (error) {
            console.error("[DECAY] Process failed:", error);
        }
    }, decayIntervalMs);

    setInterval(
        async () => {
            console.log("[PRUNE] Pruning weak waypoints...");
            try {
                const pruned = await prune_weak_waypoints();
                console.log(`[PRUNE] Completed: ${pruned} waypoints removed`);
            } catch (error) {
                console.error("[PRUNE] Failed:", error);
            }
        },
        7 * 24 * 60 * 60 * 1000,
    );

    setTimeout(() => {
        run_decay_process()
            .then((result: any) => {
                console.log(
                    `[INIT] Initial decay: ${result.decayed}/${result.processed} memories updated`,
                );
            })
            .catch(console.error);
    }, 3000);

    start_reflection();
    start_user_summary_reflection();
}
