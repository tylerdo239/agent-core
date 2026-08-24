# Vendored RLM source

This directory contains the Python package `rlm` used by the agent-core RLM
loop. It originated from `rlms` 0.1.3
([alexzhang13/rlm](https://github.com/alexzhang13/rlm), MIT license) and includes
the local integration changes required by the persistent IPython environment,
event trajectory and harness protocol.

The source is vendored deliberately so a checkout of `agent-core` is a complete
runtime. Do not silently replace it with the package from `site-packages`.
Update it as an explicit reviewed change, preserve `LICENSE`, run the Python
tests and then run the full TypeScript-to-Python E2E test.
