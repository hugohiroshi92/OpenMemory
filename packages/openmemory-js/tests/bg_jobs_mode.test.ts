import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("cfg.bg_jobs parsing", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
        delete process.env.OM_BG_JOBS;
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('defaults to "api" when OM_BG_JOBS is unset', async () => {
        const { env } = await import("../src/core/cfg");
        expect(env.bg_jobs).toBe("api");
    });

    it.each(["api", "off", "worker"] as const)(
        'accepts %s as a valid mode',
        async (value) => {
            process.env.OM_BG_JOBS = value;
            const { env } = await import("../src/core/cfg");
            expect(env.bg_jobs).toBe(value);
        },
    );

    it('normalizes uppercase to lowercase', async () => {
        process.env.OM_BG_JOBS = "WORKER";
        const { env } = await import("../src/core/cfg");
        expect(env.bg_jobs).toBe("worker");
    });

    it('falls back to "api" on invalid value and warns', async () => {
        process.env.OM_BG_JOBS = "garbage";
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { env } = await import("../src/core/cfg");
        expect(env.bg_jobs).toBe("api");
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("OM_BG_JOBS"),
        );
        warn.mockRestore();
    });
});
