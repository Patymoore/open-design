const path = require("node:path");

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 15000;

function parsePositiveInteger(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNotaryError(error) {
  const message = `${error?.message ?? ""}\n${error?.stack ?? ""}`;
  return [
    "abortedUpload",
    "deadlineExceeded",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "socket hang up",
    "network connection was lost",
  ].some((marker) => message.includes(marker));
}

module.exports = async function notarize(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const keychainProfile = process.env.APPLE_NOTARY_KEYCHAIN_PROFILE;
  const keychain = process.env.APPLE_NOTARY_KEYCHAIN;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  let credentials;
  if (keychainProfile) {
    credentials = {
      keychainProfile,
      ...(keychain ? { keychain } : {}),
    };
  } else {
    const missing = [
      ["APPLE_ID", appleId],
      ["APPLE_APP_SPECIFIC_PASSWORD", appleIdPassword],
      ["APPLE_TEAM_ID", teamId],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new Error(
        `[tools-pack notarize] missing required Apple notarization env: ${missing.join(", ")}`,
      );
    }

    credentials = {
      appleId,
      appleIdPassword,
      teamId,
    };
  }

  const productFilename = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);
  const { notarize } = await import("@electron/notarize");
  const attempts = parsePositiveInteger(process.env.OPEN_DESIGN_NOTARIZE_ATTEMPTS, DEFAULT_ATTEMPTS);
  const retryDelayMs = parsePositiveInteger(process.env.OPEN_DESIGN_NOTARIZE_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await notarize({
        appPath,
        ...credentials,
      });
      return;
    } catch (error) {
      const canRetry = attempt < attempts && isTransientNotaryError(error);
      if (!canRetry) {
        throw error;
      }

      console.warn(
        `[tools-pack notarize] transient notarytool failure on attempt ${attempt}/${attempts}; retrying in ${retryDelayMs}ms`,
      );
      await sleep(retryDelayMs);
    }
  }
};
