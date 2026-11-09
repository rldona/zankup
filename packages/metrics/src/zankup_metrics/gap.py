"""Grade-adjusted pace (OS-305): the flat-ground pace with the same effort as the real one.

Minetti et al. (2002) measured the energy cost of running at each gradient i (rise over run):
C(i) = 155.4·i⁵ - 30.4·i⁴ - 43.3·i³ + 46.3·i² + 19.5·i + 3.6 J/(kg·m), 3.6 on the flat. Each stretch
of distance is weighted by C(i)/3.6: uphill counts as more distance, gentle downhill as less. The
gradient comes from altitude smoothed over 50 m of distance (barometric altitude is noisy) and is
clamped to ±45 %, the range of Minetti's data.
"""

from __future__ import annotations

from collections.abc import Sequence

FLAT = 3.6
MAX_GRADE = 0.45


def cost(grade: float) -> float:
    i = max(-MAX_GRADE, min(MAX_GRADE, grade))
    return 155.4 * i**5 - 30.4 * i**4 - 43.3 * i**3 + 46.3 * i**2 + 19.5 * i + FLAT


def grades(dist: Sequence[float], alt: Sequence[float], window_m: float = 50) -> list[float]:
    """Gradient at each sample, from altitude and distance over ±window_m/2 around it."""
    n = len(dist)
    out = [0.0] * n
    a = b = 0
    for i in range(n):
        while a < i and dist[i] - dist[a] > window_m / 2:
            a += 1
        while b < n - 1 and dist[b + 1] - dist[i] <= window_m / 2:
            b += 1
        run = dist[b] - dist[a]
        out[i] = (alt[b] - alt[a]) / run if run > 5 else 0.0
    return out


def gap_distance(dist: Sequence[float | None], alt: Sequence[float | None]) -> float | None:
    """Grade-adjusted distance (m): the flat distance with the same cost. None without altitude."""
    pts = [(d, a) for d, a in zip(dist, alt, strict=True) if d is not None and a is not None]
    if len(pts) < 2:
        return None
    ds = [p[0] for p in pts]
    al = [p[1] for p in pts]
    gr = grades(ds, al)
    total = 0.0
    for i in range(1, len(pts)):
        step = ds[i] - ds[i - 1]
        if step > 0:
            total += step * cost(gr[i]) / FLAT
    return total
