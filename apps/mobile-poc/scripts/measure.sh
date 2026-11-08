#!/usr/bin/env bash
# OS-501 measurements on the connected Android phone (adb): cold start, frame rate while dragging the
# profile cursor, and memory. The app must be installed (release build) and signed in.
#
#   scripts/measure.sh [runs]        # default: 10 cold starts
#
# Prints a summary; raw numbers in measure-<date>.log. Drag uses `input swipe` across the chart, whose
# position the app logs ("PERF chart …").
set -euo pipefail
PKG=dev.opensport.poc
RUNS=${1:-10}
LOG="measure-$(date +%Y%m%d-%H%M%S).log"
density=$(adb shell wm density | awk '{print $NF}' | tail -1)
scale=$(awk "BEGIN{print $density/160}")

echo "Device: $(adb shell getprop ro.product.manufacturer) $(adb shell getprop ro.product.model)," \
  "Android $(adb shell getprop ro.build.version.release), SoC $(adb shell getprop ro.soc.model)" | tee "$LOG"

echo "== Cold start ($RUNS runs): force-stop, launch, time from process start to the detail with its map" | tee -a "$LOG"
ms() { awk -F'[ :.]' '{print ((($2*60)+$3)*60+$4)*1000+$5}' <<<"$1"; }  # "MM-DD HH:MM:SS.mmm" -> ms
for i in $(seq "$RUNS"); do
  adb shell am force-stop $PKG
  sleep 2
  adb logcat -c
  first=$(adb shell am start -W -n $PKG/.MainActivity | awk -F': ' '/TotalTime/{print $2}' | tr -d '\r')
  ready=""
  for _ in $(seq 40); do
    ready=$(adb logcat -d -v time | grep 'PERF detail ready' | head -1 | cut -c1-18 || true)
    [ -n "$ready" ] && break
    sleep 0.25
  done
  proc=$(adb logcat -d -v time | grep -E "Start proc [0-9]+:$PKG" | head -1 | cut -c1-18)
  if [ -n "$ready" ] && [ -n "$proc" ]; then
    echo "run $i: detail with map ready $(( $(ms "$ready") - $(ms "$proc") )) ms after process start (first frame, splash: ${first} ms)" | tee -a "$LOG"
  else
    echo "run $i: could not read the timestamps" | tee -a "$LOG"
  fi
done

echo "== Memory after opening the detail" | tee -a "$LOG"
sleep 3
adb shell dumpsys meminfo $PKG | grep -E "TOTAL PSS|TOTAL RSS|Native Heap|Graphics" | head -6 | tee -a "$LOG"

echo "== Dragging the profile cursor (5 swipes of 2 s, back and forth)" | tee -a "$LOG"
box=$(adb logcat -d -s ReactNativeJS | grep -o 'chart x=[0-9.]* y=[0-9.]* w=[0-9.]* h=[0-9.]*' | tail -1)
read -r x y w h <<<"$(echo "$box" | sed 's/[a-z]*=//g; s/chart //')"
px() { awk "BEGIN{printf \"%d\", $1*$scale}"; }
# Keep 40 dp away from the screen edges: the system back gesture lives there.
y0=$(px "$y + $h/2"); x0=$(px "$x + 40"); x1=$(px "$x + $w - 40")
adb shell dumpsys gfxinfo $PKG reset >/dev/null
adb logcat -c
foreground() { adb shell dumpsys activity activities | grep -m1 topResumedActivity | grep -q "$PKG"; }
for i in 1 2 3 4 5; do
  # Never send input to whatever else is on screen: only drag while the app is in front.
  foreground || { echo "The app is not in the foreground: stopping before sending input" | tee -a "$LOG"; exit 1; }
  if [ $((i % 2)) -eq 1 ]; then adb shell input swipe "$x0" "$y0" "$x1" "$y0" 2000; else adb shell input swipe "$x1" "$y0" "$x0" "$y0" 2000; fi
done
sleep 1.5
echo "-- app's own meter (UI thread = Reanimated frames, JS = requestAnimationFrame), per second:" | tee -a "$LOG"
adb logcat -d -s ReactNativeJS | grep -o 'PERF fps.*' | tee -a "$LOG"
echo "-- Android frame stats (HWUI) during the drags:" | tee -a "$LOG"
adb shell dumpsys gfxinfo $PKG | grep -E "Total frames rendered|Janky frames|50th percentile|90th percentile|95th percentile|99th percentile" | tee -a "$LOG"

echo "== Memory after dragging" | tee -a "$LOG"
adb shell dumpsys meminfo $PKG | grep -E "TOTAL PSS|TOTAL RSS" | head -2 | tee -a "$LOG"
echo "Saved to $LOG"
