#!/usr/bin/env bash
# Запускается внутри android-emulator-runner: ставит APK, прогоняет Maestro-сценарий
# и падает, если приложение упало (FATAL EXCEPTION в logcat) или сценарий не прошёл.
set -uo pipefail

APK="$1"
OUT="$2"
mkdir -p "$OUT"

adb install -r "$APK"
# localhost:3000 внутри эмулятора → API на раннере.
adb reverse tcp:3000 tcp:3000
# Разрешение на геолокацию заранее: так на карте проверяется и точка «я».
adb shell pm grant com.blinkcode.app android.permission.ACCESS_FINE_LOCATION || true
adb shell pm grant com.blinkcode.app android.permission.ACCESS_COARSE_LOCATION || true
adb logcat -c

"$HOME/.maestro/bin/maestro" test apps/mobile/.maestro --test-output-dir "$OUT"
status=$?

adb logcat -d > "$OUT/logcat.txt"
if grep -q "FATAL EXCEPTION" "$OUT/logcat.txt"; then
  echo "::error::Приложение упало, см. logcat ниже"
  grep -A 40 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -80
  status=1
fi
grep -E "ReactNativeJS|MLRN|maplibre" "$OUT/logcat.txt" | tail -60 || true
exit $status
