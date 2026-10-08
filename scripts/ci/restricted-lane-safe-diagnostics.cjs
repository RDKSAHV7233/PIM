"use strict";

const SAFE_FAILURE_STAGE = /^SAFE_RESTRICTED_LANE_STAGE=([A-Z0-9_]{3,80})$/;

function safeFailureStage(lines) {
  for (const line of [...lines].reverse()) {
    const match = SAFE_FAILURE_STAGE.exec(line.trim());
    if (match) return match[1];
  }
  return null;
}

module.exports = { safeFailureStage };
