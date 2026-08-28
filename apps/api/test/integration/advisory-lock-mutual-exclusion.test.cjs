const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const { runWithAdvisoryLock } = require(path.join(
  REPO_ROOT,
  "apps",
  "api",
  "dist",
  "common",
  "scheduling",
  "advisory-lock.js",
));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function uniqueLockName(name) {
  return `ci:${name}:${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function deferred() {
  let resolve;
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function main() {
  const databaseUrl = String(
    process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? process.env.DATABASE_URL_POOLED ?? "",
  ).trim();
  if (!databaseUrl) {
    console.log("SKIP advisory-lock mutual exclusion: DATABASE_URL_DIRECT/DATABASE_URL is not set.");
    return;
  }

  const sameLockName = uniqueLockName("same-lock");
  const entered = deferred();
  const release = deferred();

  const first = runWithAdvisoryLock(sameLockName, async () => {
    entered.resolve();
    await release.promise;
  });

  await entered.promise;
  const second = await runWithAdvisoryLock(sameLockName, async () => {
    throw new Error("second caller must not enter the lock body");
  });
  assert(second === false, "second concurrent caller for the same lock must be skipped");

  release.resolve();
  const firstResult = await first;
  assert(firstResult === true, "first caller must report that it acquired and ran");

  const third = await runWithAdvisoryLock(sameLockName, async () => undefined);
  assert(third === true, "same lock must be acquirable after the first caller releases it");

  const throwLockName = uniqueLockName("throw-release");
  let threw = false;
  try {
    await runWithAdvisoryLock(throwLockName, async () => {
      throw new Error("boom");
    });
  } catch (error) {
    threw = error instanceof Error && error.message === "boom";
  }
  assert(threw, "errors from the protected scheduler body must propagate to the caller");
  const afterThrow = await runWithAdvisoryLock(throwLockName, async () => undefined);
  assert(afterThrow === true, "lock must be released when the protected scheduler body throws");

  const enteredA = deferred();
  const enteredB = deferred();
  const releaseBoth = deferred();
  const [differentA, differentB] = await Promise.all([
    runWithAdvisoryLock(uniqueLockName("different-a"), async () => {
      enteredA.resolve();
      await enteredB.promise;
      await releaseBoth.promise;
    }),
    runWithAdvisoryLock(uniqueLockName("different-b"), async () => {
      enteredB.resolve();
      await enteredA.promise;
      releaseBoth.resolve();
    }),
  ]);
  assert(differentA === true && differentB === true, "different lock names must not serialize each other");

  console.log("PASS advisory-lock mutual exclusion");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
