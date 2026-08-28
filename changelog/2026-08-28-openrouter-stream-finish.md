# OpenRouter chat streams ended as errors without a finish reason

OpenRouter can close a valid OpenAI-compatible stream after sending response
text but omit `finish_reason`. The bundled Pi adapter treated that provider
behavior as a fatal error, so chat turns were marked failed even when the
response had already arrived. The failure was specific to the legacy
`@earendil-works/pi-ai` dependency used by `@ai-sdk/harness-pi`.

The dependency patch now marks OpenRouter as tolerant of missing finish
reasons and infers `stop` for text responses or `toolUse` when a tool call was
received. Explicit provider errors and missing finish reasons from other
providers remain fatal. A regression test feeds the adapter an OpenRouter SSE
response with valid text and no finish reason, then verifies the completed
result.
