# simbridge-session-agent

The session agent that runs on the GitHub macOS runner during a Mode B session: it boots the simulator, installs the app, starts serve-sim and the tunnel, posts the encrypted URL and token as a check run, serves the runner session API, and ends the job on its own through the idle timer and hard cap. Design: [SDS](../../docs/SDS.md) sections 3.5, 6.3 and 7.2. Status: empty skeleton, work starts in R1 (the R0 spike under `spikes/r0` is separate, throwaway code).
