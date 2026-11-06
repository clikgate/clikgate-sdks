package com.clikgate;

/** The private-mode guard (SPEC 12). */
public enum PrivateMode {
  /** The default: follow the organisation's setting from {@code GET /v1/server-sdk/config} (fail closed). */
  AUTO,
  /** Always guard. */
  ON,
  /** Never guard locally (the server still enforces). */
  OFF
}
