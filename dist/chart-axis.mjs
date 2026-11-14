const hasSales = album => Number.isFinite(album?.firstWeekSales) && album.firstWeekSales > 0;

function niceStep(value) {
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

function axis(minimum, maximum, referenceStart, referenceEnd) {
  return Object.freeze({
    minimum, maximum, referenceStart, referenceEnd,
    ticks: Object.freeze([minimum, minimum + (maximum - minimum) / 2, maximum])
  });
}

/**
 * Measured, positive observations determine the scale. The first course album
 * also includes its explicit, non-measured zero departure point. Follow mode
 * keeps the current album's -2..+3 neighbours inside the padded range. The view caches this result
 * for the whole album; the typing cursor must never determine its own scale.
 */
export function createSalesAxis(albums, { albumIndex = 0, overview = false, fallback } = {}) {
  if (!Array.isArray(albums) || !albums.length) throw new TypeError('An album list is required for the sales axis.');
  const index = Math.max(0, Math.min(albums.length - 1, Math.trunc(albumIndex)));
  const referenceStart = overview ? 0 : Math.max(0, index - 2);
  const referenceEnd = overview ? albums.length : Math.min(albums.length, index + 4);
  const values = albums.slice(referenceStart, referenceEnd).filter(hasSales).map(album => album.firstWeekSales);
  if (!overview && index === 0 && values.length) values.push(0);
  if (!values.length) {
    const validFallback = Number.isFinite(fallback?.minimum) && Number.isFinite(fallback?.maximum) && fallback.maximum > fallback.minimum;
    return axis(overview ? 0 : validFallback ? fallback.minimum : 0, validFallback ? fallback.maximum : 1, referenceStart, referenceEnd);
  }
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (overview) return axis(0, niceStep(high), referenceStart, referenceEnd);

  // A flat or one-point window still needs headroom and a non-zero span.
  const span = high - low || Math.max(high * .2, 1);
  const padding = span * .1;
  const precision = niceStep((span + padding * 2) / 3) / 20;
  const round = value => Number(value.toPrecision(12));
  const minimum = round(Math.max(0, Math.floor((low - padding) / precision) * precision));
  const maximum = round(Math.ceil((high + padding) / precision) * precision);
  return axis(minimum, maximum, referenceStart, referenceEnd);
}

export function salesToY(value, { minimum, maximum }, top, bottom) {
  return bottom - (value - minimum) / (maximum - minimum) * (bottom - top);
}
