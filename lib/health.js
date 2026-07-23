/**
 * Plant health colouring — two ways to define ranges
 *
 * ── SIMPLE (default) ─────────────────────────────────────────────
 *   Ideal + fine zone (green) + alert below/above (red)
 *   Yellow = automatically between fine and alert
 *   Example: fine 6–7, alert below 5.5 or above 7.5
 *
 * ── BANDS (custom) ───────────────────────────────────────────────
 *   Explicit intervals per colour — multiple ranges allowed each
 *   Example (Soil pH):
 *     Good:      6 – 6.5
 *     Worrisome: 4 – 6  and  6.5 – 7
 *     Alert:     2 – 4  and  7 – 9
 *   Reading outside every band → alert (red)
 *
 * Overlap is rejected within and across bands (except simple mode’s
 * intentional yellow gaps between fine and alert).
 */

const RANK = { critical: 3, warn: 2, ok: 1, unknown: 0 };
const LEVELS = ['ok', 'warn', 'critical'];

function parseNum(v) {
  if (v === undefined || v === null || v === '') return NaN;
  const n = typeof v === 'number' ? v : parseFloat(String(v).trim());
  return Number.isFinite(n) ? n : NaN;
}

function trimNum(n) {
  if (!Number.isFinite(n)) return '';
  const s = String(n);
  if (/e/i.test(s)) return s;
  return String(parseFloat(n.toPrecision(12)));
}

function parseRangePair(text) {
  if (text === undefined || text === null) return null;
  const s = String(text).trim();
  if (!s) return null;
  let m = s.match(/^[\[(]?\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*[,;]\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*[\])]?$/);
  if (!m) {
    m = s.match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*(?:–|—|-|\.\.|to)\s*([+-]?(?:\d+\.?\d*|\.\d+))$/i);
  }
  if (!m) return null;
  let min = parseFloat(m[1]);
  let max = parseFloat(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min > max) [min, max] = [max, min];
  return { min, max };
}

function intervalsOverlap(a, b, closed = true) {
  // closed intervals [min,max] — touch at endpoint counts as overlap
  if (closed) return a.min <= b.max && b.min <= a.max;
  return a.min < b.max && b.min < a.max;
}

function normalizeInterval(raw) {
  const min = parseNum(raw?.min ?? raw?.from);
  const max = parseNum(raw?.max ?? raw?.to);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (!(min < max)) return null; // must have positive width
  return { min, max, minStr: trimNum(min), maxStr: trimNum(max) };
}

/**
 * Normalize bands array: [{ level, min, max }, ...]
 * level: ok | warn | critical  (also: good/fine→ok, bad/worrisome→warn, worse/alert→critical)
 */
function normalizeBands(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (!raw) continue;
    let level = String(raw.level || raw.severity || 'ok').toLowerCase().trim();
    if (level === 'good' || level === 'fine' || level === 'green') level = 'ok';
    if (level === 'bad' || level === 'worrisome' || level === 'yellow' || level === 'warning') level = 'warn';
    if (level === 'worse' || level === 'alert' || level === 'red' || level === 'danger') level = 'critical';
    if (!LEVELS.includes(level)) continue;
    const iv = normalizeInterval(raw);
    if (!iv) continue;
    out.push({ level, min: iv.minStr, max: iv.maxStr, _min: iv.min, _max: iv.max });
  }
  return out;
}

/**
 * Build bands from simple fine + alert fields.
 * Fine → ok; between fine and alert → warn; outside alert → open-ended critical
 * (open ends represented as very large span for storage of explicit critical tails is not done;
 * scoring handles "outside all" as critical for simple via hasAlert.)
 */
function simpleToBands(fineMin, fineMax, alertBelow, alertAbove) {
  const bands = [];
  bands.push({ level: 'ok', min: trimNum(fineMin), max: trimNum(fineMax), _min: fineMin, _max: fineMax });
  // yellow lower: [alertBelow, fineMin) — store closed [alertBelow, fineMin] with note scoring uses edges carefully
  if (alertBelow < fineMin) {
    // store as [alertBelow, fineMin] but scoring for simple is separate
    bands.push({
      level: 'warn',
      min: trimNum(alertBelow),
      max: trimNum(fineMin),
      _min: alertBelow,
      _max: fineMin,
      _edge: 'lower', // yellow up to but not including fineMin when both match — handled in simple score
    });
  }
  if (alertAbove > fineMax) {
    bands.push({
      level: 'warn',
      min: trimNum(fineMax),
      max: trimNum(alertAbove),
      _min: fineMax,
      _max: alertAbove,
      _edge: 'upper',
    });
  }
  return bands;
}

function validateBandsNoOverlap(bands) {
  const label = { ok: 'Good', warn: 'Bad', critical: 'Worse' };
  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      const a = bands[i];
      const b = bands[j];
      // Touching at an endpoint is OK; positive-length overlap / nesting is not
      const overlapWidth = Math.min(a._max, b._max) - Math.max(a._min, b._min);
      if (overlapWidth > 1e-12) {
        return {
          ok: false,
          error:
            `${label[a.level] || a.level} ${a.min}–${a.max} overlaps ` +
            `${label[b.level] || b.level} ${b.min}–${b.max}. ` +
            'Good, bad, and worse must not cover or sit inside each other.',
        };
      }
    }
  }
  return { ok: true };
}

function normalizeRanges(condition) {
  const c = condition || {};
  let mode = String(c.rangeMode || c.mode || '').toLowerCase().trim();
  if (mode === 'custom' || mode === 'advanced' || mode === 'explicit') mode = 'bands';
  if (mode !== 'bands' && mode !== 'simple') {
    // Auto-detect: if bands array present and non-empty → bands
    const rawBands = normalizeBands(c.bands);
    mode = rawBands.length ? 'bands' : 'simple';
  }

  let fineMin = parseNum(c.fineMin ?? c.okMin ?? c.warnMin);
  let fineMax = parseNum(c.fineMax ?? c.okMax ?? c.warnMax);
  let alertBelow = parseNum(c.alertBelow ?? c.acceptableMin ?? c.critMin);
  let alertAbove = parseNum(c.alertAbove ?? c.acceptableMax ?? c.critMax);

  const finePair = parseRangePair(c.fineRange || c.okSet);
  if (finePair) {
    fineMin = finePair.min;
    fineMax = finePair.max;
  }
  const alertPair = parseRangePair(c.alertRange || c.acceptableSet);
  if (alertPair) {
    alertBelow = alertPair.min;
    alertAbove = alertPair.max;
  }

  const hasFineMin = Number.isFinite(fineMin);
  const hasFineMax = Number.isFinite(fineMax);
  const hasAlertBelow = Number.isFinite(alertBelow);
  const hasAlertAbove = Number.isFinite(alertAbove);
  const hasFine = hasFineMin && hasFineMax;
  const hasAlert = hasAlertBelow && hasAlertAbove;

  let bands = normalizeBands(c.bands);
  let limitsOk = true;
  let limitsError = null;

  if (mode === 'bands') {
    if (!bands.length) {
      // empty bands with mode bands — ok if no ranges intended
      limitsOk = true;
    } else {
      const v = validateBandsNoOverlap(bands);
      if (!v.ok) {
        limitsOk = false;
        limitsError = v.error;
      } else if (!bands.some((b) => b.level === 'ok')) {
        limitsOk = false;
        limitsError = 'Add at least one “Good” range.';
      }
    }
  } else {
    // SIMPLE mode validation
    const finePartial = hasFineMin !== hasFineMax;
    const alertPartial = hasAlertBelow !== hasAlertAbove;
    if (finePartial) {
      limitsOk = false;
      limitsError = 'Fine zone needs both “from” and “to” numbers.';
    } else if (alertPartial) {
      limitsOk = false;
      limitsError = 'Alert needs both “below” and “above” numbers.';
    } else if (hasFine && !(fineMin < fineMax)) {
      limitsOk = false;
      limitsError = 'Fine zone “from” must be less than “to”.';
    } else if (hasAlert && !(alertBelow < alertAbove)) {
      limitsOk = false;
      limitsError = 'Alert “below” must be less than alert “above”.';
    } else if (hasFine && hasAlert) {
      if (!(alertBelow < fineMin)) {
        limitsOk = false;
        limitsError =
          `Alert “below” (${trimNum(alertBelow)}) must be less than fine “from” (${trimNum(fineMin)}). ` +
          'Green and red cannot overlap.';
      } else if (!(alertAbove > fineMax)) {
        limitsOk = false;
        limitsError =
          `Alert “above” (${trimNum(alertAbove)}) must be greater than fine “to” (${trimNum(fineMax)}). ` +
          'Green and red cannot overlap.';
      }
    }

    // Materialize bands for display/API when simple is valid
    if (limitsOk && hasFine && hasAlert) {
      bands = [
        { level: 'ok', min: trimNum(fineMin), max: trimNum(fineMax), _min: fineMin, _max: fineMax },
        {
          level: 'warn',
          min: trimNum(alertBelow),
          max: trimNum(fineMin),
          _min: alertBelow,
          _max: fineMin,
        },
        {
          level: 'warn',
          min: trimNum(fineMax),
          max: trimNum(alertAbove),
          _min: fineMax,
          _max: alertAbove,
        },
        // critical: open outside — not stored as finite bands; score handles it
      ];
    } else if (limitsOk && hasFine) {
      bands = [{ level: 'ok', min: trimNum(fineMin), max: trimNum(fineMax), _min: fineMin, _max: fineMax }];
    }
  }

  const out = {
    rangeMode: mode,
    fineMin: hasFine ? trimNum(fineMin) : '',
    fineMax: hasFine ? trimNum(fineMax) : '',
    alertBelow: hasAlert ? trimNum(alertBelow) : '',
    alertAbove: hasAlert ? trimNum(alertAbove) : '',
    bands: bands.map(({ level, min, max }) => ({ level, min, max })),
    hasFine,
    hasAlert,
    hasBands: mode === 'bands' && bands.length > 0,
    limitsOk,
    limitsError,
    _fineMin: hasFine ? fineMin : NaN,
    _fineMax: hasFine ? fineMax : NaN,
    _alertBelow: hasAlert ? alertBelow : NaN,
    _alertAbove: hasAlert ? alertAbove : NaN,
    _bands: bands,
  };

  // Legacy mirrors
  out.okMin = out.fineMin;
  out.okMax = out.fineMax;
  out.acceptableMin = out.alertBelow;
  out.acceptableMax = out.alertAbove;
  out.warnMin = out.fineMin;
  out.warnMax = out.fineMax;
  out.critMin = out.alertBelow;
  out.critMax = out.alertAbove;
  out.okSet = out.hasFine ? `${out.fineMin}–${out.fineMax}` : '';
  out.acceptableSet = out.hasAlert ? `${out.alertBelow}–${out.alertAbove}` : '';

  return out;
}

function hasFullRanges(condition) {
  const r = normalizeRanges(condition);
  if (!r.limitsOk) return false;
  if (r.rangeMode === 'bands') return r._bands.some((b) => b.level === 'ok');
  return r.hasFine && r.hasAlert;
}

/**
 * Score reading against condition.
 * Bands mode: pick the band containing x (no overlaps by validation).
 * Simple mode: fine → ok; between fine and alert → warn; outside alert → critical.
 */
function scoreValue(rawValue, condition) {
  const n = parseNum(rawValue);
  if (!Number.isFinite(n) || !condition) return 'unknown';

  const r = normalizeRanges(condition);
  if (!r.limitsOk) return 'unknown';

  if (r.rangeMode === 'bands' && r._bands.length) {
    // Inclusive intervals; if on shared boundary, prefer the "inner" healthier band
    // (fine endpoint shared with warn: count as ok if ok band includes it)
    const hits = [];
    for (const b of r._bands) {
      if (n >= b._min && n <= b._max) hits.push(b);
    }
    if (hits.length === 0) {
      // Outside every defined band → treat as alert
      return 'critical';
    }
    // Prefer ok over warn over critical when on a shared endpoint
    hits.sort((a, b) => (RANK[a.level] || 0) - (RANK[b.level] || 0));
    return hits[0].level;
  }

  // SIMPLE
  if (r.hasFine && r.hasAlert) {
    if (n >= r._fineMin && n <= r._fineMax) return 'ok';
    if (n < r._alertBelow || n > r._alertAbove) return 'critical';
    return 'warn';
  }
  if (r.hasFine) {
    return n >= r._fineMin && n <= r._fineMax ? 'ok' : 'warn';
  }
  if (r.hasAlert) {
    return n < r._alertBelow || n > r._alertAbove ? 'critical' : 'ok';
  }

  const target = parseNum(condition.value);
  if (!Number.isFinite(target)) return 'unknown';
  const scale = Math.abs(target) < 1e-9 ? 1 : Math.abs(target);
  const pct = Math.abs(n - target) / scale;
  if (pct <= 0.05) return 'ok';
  if (pct <= 0.15) return 'warn';
  return 'critical';
}

function worse(a, b) {
  return (RANK[a] || 0) >= (RANK[b] || 0) ? a : b;
}

function latestByParameter(readings, plantId) {
  const map = new Map();
  for (const r of readings) {
    if (r.plantId !== plantId) continue;
    const prev = map.get(r.parameter);
    if (!prev || new Date(r.enteredAt) > new Date(prev.enteredAt)) {
      map.set(r.parameter, r);
    }
  }
  return map;
}

function latestReadingsForPlants(allReadings, plantIds) {
  const set = new Set(plantIds);
  const out = new Map();
  for (const r of allReadings) {
    if (!set.has(r.plantId)) continue;
    let m = out.get(r.plantId);
    if (!m) {
      m = new Map();
      out.set(r.plantId, m);
    }
    const prev = m.get(r.parameter);
    if (!prev || new Date(r.enteredAt) > new Date(prev.enteredAt)) {
      m.set(r.parameter, r);
    }
  }
  return out;
}

function evaluatePlantHealth(plantConditions, latestMap) {
  const conditions = Array.isArray(plantConditions) ? plantConditions : [];
  if (!conditions.length || !latestMap || latestMap.size === 0) {
    return { health: 'unknown', worstParameter: null, details: [] };
  }

  let health = 'unknown';
  let worstParameter = null;
  const details = [];

  for (const cond of conditions) {
    const reading = latestMap.get(cond.parameter);
    if (!reading) {
      details.push({ parameter: cond.parameter, status: 'unknown', value: null });
      continue;
    }
    const status = scoreValue(reading.value, cond);
    details.push({
      parameter: cond.parameter,
      status,
      value: reading.value,
      unit: reading.unit || cond.unit || '',
    });
    if ((RANK[status] || 0) > (RANK[health] || 0)) {
      health = status;
      worstParameter = cond.parameter;
    }
  }

  return { health, worstParameter, details };
}

function validateConditionList(list) {
  if (!Array.isArray(list)) return { ok: true };
  for (const c of list) {
    const parameter = (c.parameter || '').trim() || 'Parameter';
    const mode = String(c.rangeMode || '').toLowerCase();
    const hasBands = Array.isArray(c.bands) && c.bands.length > 0;
    const anySimple =
      String(c.fineMin ?? '').trim() !== '' ||
      String(c.fineMax ?? '').trim() !== '' ||
      String(c.alertBelow ?? '').trim() !== '' ||
      String(c.alertAbove ?? '').trim() !== '';
    if (!hasBands && !anySimple && mode !== 'bands') continue;
    const r = normalizeRanges(c);
    if (!r.limitsOk) {
      return {
        ok: false,
        parameter,
        error: `${parameter}: ${r.limitsError || 'Invalid ranges'}`,
      };
    }
  }
  return { ok: true };
}

const parseInterval = parseRangePair;
function formatInterval(min, max) {
  return `${trimNum(min)}–${trimNum(max)}`;
}

module.exports = {
  RANK,
  LEVELS,
  parseNum,
  parseRangePair,
  parseInterval,
  formatInterval,
  normalizeBands,
  normalizeRanges,
  hasFullRanges,
  validateConditionList,
  scoreValue,
  worse,
  latestByParameter,
  latestReadingsForPlants,
  evaluatePlantHealth,
};
