# JIVARA TV — Permanent APK Baseline

## Approved baseline

The approved baseline for future APK work is **JIVARA TV v1.0.3**.

- Release page: https://github.com/kanalnawxo/JIVARA-TV/releases/tag/v1.0.3
- Direct APK: https://github.com/kanalnawxo/JIVARA-TV/releases/download/v1.0.3/JIVARA_TV_icon.apk
- Asset SHA-256: `8f9a6301613da4fd1c4895892bf685373d3f0c391ff75bcf7117f86adb6832b3`
- Size: 5,169,850 bytes
- Original uploaded APK source commit: `080f30e74342e854b5dde197053530ed2f489b55`
- Logo source: `APK LOGO.png`

## Rules for all future changes

1. Always start from the approved v1.0.3 APK asset above, unless the owner explicitly approves a different baseline.
2. Never silently switch to the HTML source, another APK, or an older release as the build baseline.
3. Preserve existing app behavior and design. Change only what the owner specifically requests.
4. Keep this baseline unchanged. Publish every modified APK as a new, incremented release; do not overwrite v1.0.3.
5. Verify the generated APK and its release asset before sharing a download link.
6. Keep the original source commit `080f30e74342e854b5dde197053530ed2f489b55` as historical provenance, not as the default APK for new work.

## Signing note

The v1.0.3 workflow generated a signing key during the build and did not preserve that key as a reusable signing identity. Therefore, future builds may not install as in-place updates over v1.0.3 unless a stable signing key is established and securely retained. Do not claim seamless upgrades until this is verified.

This file records the agreed baseline and change-control rules; it does not itself alter the APK binary.
