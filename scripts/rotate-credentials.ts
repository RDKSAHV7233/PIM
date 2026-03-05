/* eslint-disable no-console */
import { LoggerService } from "../apps/api/src/common/logging/logger.service";
import { validateEnv } from "../apps/api/src/common/env-validation";
import {
  ConnectorCredentialEncryptionService,
  RotateCredentialKeyOptions,
} from "../apps/api/src/connector-installer/credential-encryption.service";
import { PrismaDirectService } from "../apps/api/src/prisma/prisma-direct.service";

interface CliArgs {
  fromVersion: number;
  toVersion: number;
  dryRun: boolean;
  confirm: boolean;
  batchSize?: number;
}

function parseIntArg(name: string, value: string | undefined): number {
  if (!value) {
    throw new Error(`Missing value for ${name}.`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv];
  let fromVersion: number | undefined;
  let toVersion: number | undefined;
  let batchSize: number | undefined;
  let dryRun = false;
  let confirm = false;

  while (args.length > 0) {
    const token = args.shift();
    if (!token) {
      continue;
    }
    switch (token) {
      case "--from":
        fromVersion = parseIntArg("--from", args.shift());
        break;
      case "--to":
        toVersion = parseIntArg("--to", args.shift());
        break;
      case "--batch-size":
        batchSize = parseIntArg("--batch-size", args.shift());
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--confirm":
        confirm = true;
        break;
      case "--help":
        throw new Error(
          [
            "Usage:",
            "  ts-node scripts/rotate-credentials.ts --from 1 --to 2 --dry-run",
            "  ts-node scripts/rotate-credentials.ts --from 1 --to 2 --confirm",
          ].join("\n"),
        );
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!fromVersion) {
    throw new Error("--from is required.");
  }
  if (!toVersion) {
    throw new Error("--to is required.");
  }
  if (!dryRun && !confirm) {
    throw new Error("Use --dry-run for simulation or --confirm to execute updates.");
  }
  if (dryRun && confirm) {
    throw new Error("Use either --dry-run or --confirm, not both.");
  }

  return {
    fromVersion,
    toVersion,
    dryRun,
    confirm,
    batchSize,
  };
}

async function run() {
  validateEnv();
  const cli = parseArgs(process.argv.slice(2));

  const prismaDirect = new PrismaDirectService();
  await prismaDirect.onModuleInit();

  try {
    const logger = new LoggerService();
    const service = new ConnectorCredentialEncryptionService(prismaDirect, logger);
    const rotateOptions: RotateCredentialKeyOptions = {
      fromVersion: cli.fromVersion,
      toVersion: cli.toVersion,
      dryRun: cli.dryRun,
      batchSize: cli.batchSize,
    };
    const result = await service.rotateKey(rotateOptions);
    console.log(
      JSON.stringify(
        {
          mode: cli.dryRun ? "dry-run" : "execute",
          fromVersion: cli.fromVersion,
          toVersion: cli.toVersion,
          rotated: result.rotated,
          failed: result.failed,
          errors: result.errors,
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prismaDirect.onModuleDestroy();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
