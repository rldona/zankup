/**
 * Signs release builds with the owner's own key (OS-526), kept outside the repository: passkeys and
 * `assetlinks.json` trust the app by this key's SHA-256, so it must never be the public debug key.
 *
 * The key is described by a properties file (storeFile, storePassword, keyAlias, keyPassword):
 * `ZANKUP_SIGNING` or `~/.config/zankup/android/signing.properties`. Without it, release builds keep
 * the debug key, and passkeys do not work in them.
 */
const { existsSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// zankup: release signing';

function signingFile() {
  const file = process.env.ZANKUP_SIGNING || join(homedir(), '.config/zankup/android/signing.properties');
  return existsSync(file) ? file : null;
}

module.exports = function withReleaseSigning(config) {
  const file = signingFile();
  if (!file) return config;
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents;
    if (gradle.includes(MARK)) return mod;
    const release = `
        release { ${MARK}
            def props = new Properties()
            file(${JSON.stringify(file)}).withInputStream { props.load(it) }
            storeFile file(props['storeFile'])
            storePassword props['storePassword']
            keyAlias props['keyAlias']
            keyPassword props['keyPassword']
        }`;
    gradle = gradle.replace(/signingConfigs\s*\{/, (match) => `${match}${release}`);
    gradle = gradle.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      '$1signingConfig signingConfigs.release',
    );
    mod.modResults.contents = gradle;
    return mod;
  });
};
