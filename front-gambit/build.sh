#!/usr/bin/env bash
# Builds web bundle and packages it into an Android APK without Gradle.
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-/opt/android-sdk}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-34/android.jar"
OUT=build
rm -rf "$OUT" && mkdir -p "$OUT"/{res,gen,classes,assets/www}

echo "== bundle web"
npx esbuild web/src/main.js --bundle --minify --format=iife --target=es2019 --outfile=web/dist/game.js --log-level=warning
cp web/index.html web/style.css web/dist/
rm -rf web/dist/assets && cp -r web/assets web/dist/assets
cp -r web/dist/index.html web/dist/style.css web/dist/game.js web/dist/assets "$OUT/assets/www/"

echo "== resources"
"$BT/aapt2" compile --dir android/res -o "$OUT/res/res.zip"
"$BT/aapt2" link -I "$JAR" --manifest android/AndroidManifest.xml -A "$OUT/assets" \
  --java "$OUT/gen" -o "$OUT/base.apk" "$OUT/res/res.zip" --auto-add-overlay

echo "== java"
javac -nowarn --release 8 -classpath "$JAR" -d "$OUT/classes" \
  $(find android/java "$OUT/gen" -name '*.java') 2>&1 | grep -v "^Picked up" || true
"$BT/d8" --release --min-api 24 --lib "$JAR" --output "$OUT" $(find "$OUT/classes" -name '*.class')

echo "== package"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT" && zip -q -j unsigned.apk classes.dex)
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
KS="${KEYSTORE:-$HOME/.frontgambit.keystore}"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass frontgambit -keypass frontgambit -alias fg \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Front Gambit,O=Front Gambit,C=RU" 2>&1 | grep -v "^Picked up" || true
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:frontgambit --key-pass pass:frontgambit --ks-key-alias fg \
  --out FrontGambit.apk "$OUT/aligned.apk"
"$BT/apksigner" verify FrontGambit.apk
ls -la FrontGambit.apk
