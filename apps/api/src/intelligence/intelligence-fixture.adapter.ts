import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { IntelligenceAdapterRequest, IntelligenceAdapterResponse } from "./intelligence.types";

@Injectable()
export class FixtureIntelligenceAdapter {
  async generateStructuredOutput(request: IntelligenceAdapterRequest): Promise<IntelligenceAdapterResponse> {
    const startedAt = Date.now();
    const title = this.stringAt(request.payload, ["product", "title"]) ?? "Unknown product";
    const fieldPath = "attributes.title";
    const evidenceHash = this.hashJson({
      sourceRecordId: request.sourceRecordId,
      sourceVersion: request.sourceVersion,
      sourceHash: request.sourceHash,
      sourceField: "product.title",
      value: title,
    });

    return {
      adapterKey: "fixture",
      modelKey: "fixture-model",
      modelVersion: "fixture-model-v1",
      region: "local",
      requestId: `fixture:${this.hashText(`${request.correlationId}|${request.payloadFingerprint}`)}`,
      finishStatus: "completed",
      latencyMs: Math.max(Date.now() - startedAt, 0),
      structuredOutput: {
        suggestions: [
          {
            fieldPath,
            attributeFamily: "title",
            suggestedValue: title,
            generatedPayload: {
              value: title,
              source: "fixture",
            },
            confidence: 1,
            evidence: [
              {
                sourceField: "product.title",
                sourceRecordId: request.sourceRecordId,
                sourceVersion: request.sourceVersion,
                sourceHash: request.sourceHash,
                citation: "Fixture adapter product.title",
                evidenceHash,
              },
            ],
          },
        ],
      },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        billableUnits: 0,
        estimatedCostMicros: 0,
        currency: "USD",
        pricingVersion: "fixture-free-v1",
      },
      providerCallAttempted: false,
    };
  }

  normalizeError(error: unknown): IntelligenceAdapterResponse {
    return {
      adapterKey: "fixture",
      modelKey: "fixture-model",
      modelVersion: "fixture-model-v1",
      region: "local",
      requestId: `fixture-error:${this.hashText(this.errorMessage(error))}`,
      finishStatus: "failed",
      latencyMs: 0,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        billableUnits: 0,
        estimatedCostMicros: 0,
        currency: "USD",
        pricingVersion: "fixture-free-v1",
      },
      errorClass: "internal_error",
      errorCode: "fixture_adapter_error",
      errorMessageSafe: this.errorMessage(error).slice(0, 200),
      providerCallAttempted: false,
    };
  }

  private stringAt(value: Prisma.InputJsonValue, path: string[]) {
    let current: unknown = value;
    for (const segment of path) {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        return null;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return typeof current === "string" && current.trim() ? current.trim() : null;
  }

  private hashText(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private hashJson(value: unknown) {
    return `sha256:${this.hashText(this.stableJsonStringify(value))}`;
  }

  private stableJsonStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableJsonStringify(item)).join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.stableJsonStringify(record[key])}`)
      .join(",")}}`;
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Fixture adapter failed.";
  }
}
