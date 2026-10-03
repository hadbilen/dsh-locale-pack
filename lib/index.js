// Host half (node): this patch contributes browser dictionaries only,
// so the host row is intentionally empty. The empty apply gives the Loader
// a host-side row while the browser half ships through exports["./client"].
// (Same pattern as @deepseek-ai/dsh-client-ui-brand-official.)

/** Host plugin body — browser presentation only. */
export function apply() {}
