function reconstruct4hFrom1h(candles) {
  const result = [];

  for (let i = 0; i < candles.length; i += 4) {
    const group = candles.slice(i, i + 4);
    if (group.length < 4) break;

    const open = group[0].open;
    const close = group[3].close;
    const high = Math.max(...group.map(c => c.high));
    const low = Math.min(...group.map(c => c.low));
    const time = group[0].time ?? group[0].timestamp;
    const volume = group.reduce((sum, c) => sum + (c.volume ?? 0), 0);

    result.push({ time, open, high, low, close, volume });
  }

  return result;
}

async function fetchYahoo(symbol, timeframe) {
  const url = buildYahooURL(symbol, timeframe);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  if (!res.ok) {
    throw new Error("Yahoo fetch failed");
  }

  const json = await res.json();
  const candles = extractCandles(json);
  if (!candles.length) {
    throw new Error("No candle data");
  }

  return candles;
}

export default {
  async fetch(request) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        }
      });
    }

    // Only POST
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        }
      });
    }

    try {
      const { symbol, timeframe, candles: externalCandles } = await request.json();

      if (!symbol || !timeframe) {
        return new Response(
          JSON.stringify({ error: "Missing symbol or timeframe" }),
          {
            status: 400,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "application/json"
            }
          }
        );
      }

      const tf = timeframe.toUpperCase();

      // 1) Construir velas unificadas (time, open, high, low, close, volume)
      let candles;

      if (Array.isArray(externalCandles) && externalCandles.length > 0) {
        // Vienen de Binance (cripto) → normalizamos a formato interno
        candles = externalCandles.map(c => ({
          time: c.time ?? c.timestamp,
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
          volume: Number(c.volume ?? 0),
        }));
      } else {
        // No vienen velas externas → usamos Yahoo
        if (tf === "4H") {
          // Yahoo no tiene 4H → reconstruimos desde 1H
          const oneHourCandles = await fetchYahoo(symbol, "1H");
          candles = reconstruct4hFrom1h(oneHourCandles);
        } else {
          candles = await fetchYahoo(symbol, tf);
        }
      }

      if (!candles || !candles.length) {
        return new Response(
          JSON.stringify({ error: "No candle data after processing" }),
          {
            status: 500,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "application/json"
            }
          }
        );
      }

      // 2) Calcular indicadores
      const indicators = calculateIndicators(candles);

      // 3) Generar análisis completo
      const analysis = generateAnalysis(candles, indicators, tf, symbol);

      return new Response(JSON.stringify(analysis), {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        }
      });

    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Internal error", details: String(err) }),
        {
          status: 500,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json"
          }
        }
      );
    }
  }
};

// ------------------------ UTILIDADES ------------------------

function buildYahooURL(symbol, timeframe) {
  const tf = timeframe.toUpperCase();

  const intervalMap = {
    "5M": "5m",
    "15M": "15m",
    "1H": "60m",
    "4H": "240m",
    "1D": "1d",
    "1W": "1wk",
  };

  const rangeMap = {
    "5M": "30d",
    "15M": "60d",
    "1H": "6mo",
    "4H": "1y",
    "1D": "5y",
    "1W": "10y",
  };

  const interval = intervalMap[tf] || "1d";
  const range = rangeMap[tf] || "1mo";

  return `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;
}

function extractCandles(json) {
  try {
    const result = json.chart.result[0];
    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];

    const candles = [];

    for (let i = 0; i < timestamps.length; i++) {
      const o = quotes.open[i];
      const h = quotes.high[i];
      const l = quotes.low[i];
      const c = quotes.close[i];
      const v = quotes.volume[i];

      if (o == null || h == null || l == null || c == null || v == null) continue;

      candles.push({
        time: timestamps[i] * 1000,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: v,
      });
    }

    return candles;
  } catch {
    return [];
  }
}

// ------------------------ INDICADORES ------------------------

function calculateEMA(values, period) {
  const len = values.length;
  const result = Array(len).fill(null);
  if (len < period) return result;

  const k = 2 / (period + 1);
  let sum = 0;

  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  result[period - 1] = prev;

  for (let i = period; i < len; i++) {
    prev = values[i] * k + prev * (1 - k);
    result[i] = prev;
  }

  return result;
}

function calculateRSI(values, period = 14) {
  const len = values.length;
  const rsi = Array(len).fill(null);
  if (len < period + 1) return rsi;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  const firstIndex = period + 1;
  rsi[firstIndex] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = firstIndex + 1; i < len; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;

    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return rsi;
}

function calculateMACD(values) {
  const ema12 = calculateEMA(values, 12);
  const ema26 = calculateEMA(values, 26);

  const macd = values.map((_, i) =>
    ema12[i] != null && ema26[i] != null ? ema12[i] - ema26[i] : null
  );

  const signal = calculateEMA(
    macd.map((v) => (v == null ? 0 : v)),
    9
  );

  const histogram = macd.map((v, i) =>
    v != null && signal[i] != null ? v - signal[i] : null
  );

  return { macd, signal, histogram };
}

function calculateBollinger(values, period = 20, mult = 2) {
  const len = values.length;
  const upper = Array(len).fill(null);
  const middle = Array(len).fill(null);
  const lower = Array(len).fill(null);

  if (len < period) return { upper, middle, lower };

  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];

  for (let i = period - 1; i < len; i++) {
    if (i > period - 1) sum += values[i] - values[i - period];

    const mean = sum / period;
    middle[i] = mean;

    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = values[j] - mean;
      variance += diff * diff;
    }

    const std = Math.sqrt(variance / period);
    upper[i] = mean + mult * std;
    lower[i] = mean - mult * std;
  }

  return { upper, middle, lower };
}

function calculateADX(high, low, close, period = 14) {
  const len = high.length;
  const adx = Array(len).fill(null);
  if (len < period * 2) return adx;

  const tr = Array(len).fill(0);
  const plusDM = Array(len).fill(0);
  const minusDM = Array(len).fill(0);

  for (let i = 1; i < len; i++) {
    const up = high[i] - high[i - 1];
    const down = low[i - 1] - low[i];

    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;

    tr[i] = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    );
  }

  const smooth = (arr) => {
    const out = Array(len).fill(0);
    let sum = 0;

    for (let i = 1; i <= period; i++) sum += arr[i];
    out[period] = sum;

    for (let i = period + 1; i < len; i++) {
      out[i] = out[i - 1] - out[i - 1] / period + arr[i];
    }

    return out;
  };

  const trSmooth = smooth(tr);
  const plusSmooth = smooth(plusDM);
  const minusSmooth = smooth(minusDM);

  const dx = Array(len).fill(0);

  for (let i = period; i < len; i++) {
    const plusDI = (plusSmooth[i] / trSmooth[i]) * 100;
    const minusDI = (minusSmooth[i] / trSmooth[i]) * 100;
    dx[i] = (Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1)) * 100;
  }

  let sumDX = 0;
  const start = period * 2;

  for (let i = period; i < start; i++) sumDX += dx[i];
  adx[start] = sumDX / period;

  for (let i = start + 1; i < len; i++) {
    adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
  }

  return adx;
}

function calculateIndicators(data) {
  if (!data || data.length === 0) {
    return {
      rsi: [],
      macd: [],
      signal: [],
      histogram: [],
      ema20: [],
      ema50: [],
      ema200: [],
      adx: [],
      bollingerBands: { upper: [], middle: [], lower: [] },
      ema200Slope: null,
    };
  }

  const closes = data.map((c) => c.close);
  const highs = data.map((c) => c.high);
  const lows = data.map((c) => c.low);

  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);

  const rsi = calculateRSI(closes, 14);

  const { macd, signal, histogram } = calculateMACD(closes);

  const bollingerBands = calculateBollinger(closes);

  const adx = calculateADX(highs, lows, closes, 14);

  const ema200Slope =
    ema200.at(-1) != null && ema200[ema200.length - 5] != null
      ? (ema200.at(-1) - ema200[ema200.length - 5]) / 5
      : null;

  return {
    rsi,
    macd,
    signal,
    histogram,
    ema20,
    ema50,
    ema200,
    adx,
    bollingerBands,
    ema200Slope,
  };
}

// ------------------------ ANÁLISIS ------------------------

function safe(v, decimals = 2) {
  return v == null || isNaN(v) ? "-" : Number(v).toFixed(decimals);
}

function safeArray(arr) {
  return Array.isArray(arr) ? arr : [];
}

function calculateATR(data, period = 14) {
  if (!data || data.length < period + 1) return null;

  const trs = [];

  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );

    trs.push(tr);
  }

  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function getProfile(timeframe) {
  switch (timeframe) {
    case "5M":
      return { rsiBull: 55, rsiBear: 45, macdNeutral: 0.08, adxTrend: 18 };
    case "15M":
      return { rsiBull: 55, rsiBear: 45, macdNeutral: 0.1, adxTrend: 18 };
    case "1H":
      return { rsiBull: 60, rsiBear: 40, macdNeutral: 0.15, adxTrend: 20 };
    case "4H":
      return { rsiBull: 55, rsiBear: 45, macdNeutral: 0.2, adxTrend: 22 };
    case "1D":
      return { rsiBull: 52, rsiBear: 48, macdNeutral: 0.15, adxTrend: 20 };
    default:
      return { rsiBull: 55, rsiBear: 45, macdNeutral: 0.2, adxTrend: 20 };
  }
}

function wasActivated(data, trigger, direction) {
  const lookback = data.slice(-5);

  if (direction === "bull") {
    return lookback.some((c) => c.close > trigger);
  } else {
    return lookback.some((c) => c.close < trigger);
  }
}

function getDecimalPlaces(symbol) {
  if (symbol === "BTC-USD") return 1;
  if (symbol === "ETH-USD") return 2;
  if (symbol === "SOL-USD") return 3;
  if (symbol === "XRP-USD") return 4;
  if (symbol === "ADA-USD") return 4;

  if (symbol.includes("-USD")) return 5;

  if (symbol.includes("JPY")) return 2;

  if (symbol.endsWith("=X")) return 4;

  if (symbol === "NG=F") return 3;
  if (symbol === "HG=F") return 4;
  if (["GC=F", "SI=F", "CL=F"].includes(symbol)) return 2;

  if (symbol.startsWith("^")) return 2;

  return 2;
}

function generateAnalysis(rawData, indicators, timeframe, symbol) {
  const profile = getProfile(timeframe);

  const limitByTF = {
    "5M": 40,
    "15M": 60,
    "1H": 48,
    "4H": 84,
    "1D": 120,
  };

  const limit = limitByTF[timeframe] || 100;

  const data = safeArray(rawData).slice(-limit);

  indicators.rsi = safeArray(indicators.rsi).slice(-limit);
  indicators.macd = safeArray(indicators.macd).slice(-limit);
  indicators.signal = safeArray(indicators.signal).slice(-limit);
  indicators.ema20 = safeArray(indicators.ema20).slice(-limit);
  indicators.ema50 = safeArray(indicators.ema50).slice(-limit);
  indicators.ema200 = safeArray(indicators.ema200).slice(-limit);
  indicators.adx = safeArray(indicators.adx).slice(-limit);

  const last = data[data.length - 1];
  const lastRSI = indicators.rsi.at(-1);
  const lastMACD = indicators.macd.at(-1);
  const lastSignal = indicators.signal.at(-1);
  const lastADX = indicators.adx.at(-1);

  if (!last || lastRSI == null || lastMACD == null || lastSignal == null) {
    return {
      trendShort: "NEUTRAL",
      trendLong: "NEUTRAL",
      opinion: "Datos insuficientes para generar un análisis fiable.",
      bullishScenario: null,
      bearishScenario: null,
      activeScenario: "none",
      analysisText:
        "⚠️ No hay suficientes velas para generar un análisis consistente.",
      price: "-",
      volatilityPct: 0,
      volatilityLevel: "Desconocida",
      sentiment: "Mixto",
      riskLevel: "Desconocido",
      riskExplanation: "No hay datos suficientes para evaluar el riesgo.",
      bullPct: 0,
      bearPct: 0,
      neutralPct: 100,
      keySupport: "-",
    };
  }

  const ema20Last = indicators.ema20.at(-1);
  const ema50Last = indicators.ema50.at(-1);
  const ema200Last = indicators.ema200.at(-1);

  let trendLong =
    ema20Last > ema50Last && ema50Last > ema200Last
      ? "ALCISTA"
      : ema20Last < ema50Last && ema50Last < ema200Last
      ? "BAJISTA"
      : "NEUTRAL";

  let trendShort =
    ema20Last > ema50Last
      ? "ALCISTA"
      : ema20Last < ema50Last
      ? "BAJISTA"
      : "NEUTRAL";

  if (lastADX < profile.adxTrend) trendLong = "NEUTRAL";

  let sentimentLabel = "Mixto";

  if (lastRSI > 55 && lastMACD > lastSignal) sentimentLabel = "Predominio alcista";
  else if (lastRSI < 45 && lastMACD < lastSignal)
    sentimentLabel = "Predominio bajista";

  let trendStrength = "Débil";
  if (lastADX > profile.adxTrend + 5) trendStrength = "Fuerte";
  else if (lastADX > profile.adxTrend) trendStrength = "Moderada";

  let bullScore = 0;
  let bearScore = 0;
  let neutralScore = 0;

  if (lastRSI > profile.rsiBull) bullScore += 2;
  else if (lastRSI < profile.rsiBear) bearScore += 2;
  else neutralScore += 1;

  const macdDiff = lastMACD - lastSignal;

  if (Math.abs(macdDiff) < profile.macdNeutral) neutralScore += 2;
  else if (macdDiff > 0) bullScore += 2;
  else bearScore += 2;

  if (ema20Last > ema50Last) bullScore += 1;
  else if (ema20Last < ema50Last) bearScore += 1;
  else neutralScore += 1;

  if (lastADX > profile.adxTrend) {
    if (trendLong === "ALCISTA") bullScore += 2;
    if (trendLong === "BAJISTA") bearScore += 2;
  } else {
    neutralScore += 1;
  }

  if (indicators.ema200Slope != null) {
    const slope = indicators.ema200Slope;
    if (slope > 0) bullScore += 1;
    else if (slope < 0) bearScore += 1;
    else neutralScore += 1;
  }

  const total = bullScore + bearScore + neutralScore || 1;
  const bullPct = Math.round((bullScore / total) * 100);
  const bearPct = Math.round((bearScore / total) * 100);
  const neutralPct = 100 - bullPct - bearPct;

  const price = data.at(-1).close;
  let atr = calculateATR(data);
  if (!atr || isNaN(atr)) atr = price * 0.003;

  const levelsWindow = data.slice(-30);
  const highs = levelsWindow.map((c) => c.high);
  const lows = levelsWindow.map((c) => c.low);

  const rawResistance = Math.max(...highs);
  const rawSupport = Math.min(...lows);

  const dynamicLevels = [ema50Last, ema200Last].filter((v) => v != null);

  const keyResistanceNum = Math.max(rawResistance, ...dynamicLevels);
  const keySupportNum = Math.min(rawSupport, ...dynamicLevels);

  const resistances = [rawResistance, ...dynamicLevels]
    .filter((r) => r > price)
    .sort((a, b) => a - b);

  const supports = [rawSupport, ...dynamicLevels]
    .filter((s) => s < price)
    .sort((a, b) => b - a);

  while (resistances.length < 3) resistances.push(resistances.at(-1) + atr);
  while (supports.length < 3) supports.push(supports.at(-1) - atr);

  let R1Num = Number(resistances[0]);
  let R2Num = Number(resistances[1]);
  let R3Num = Number(resistances[2]);

  let S1Num = Number(supports[0]);
  let S2Num = Number(supports[1]);
  let S3Num = Number(supports[2]);

  const buffer = price * 0.0002;
  let bullishTrigger = keyResistanceNum + buffer;
  let bearishTrigger = keySupportNum - buffer;

  const bullishTargets = [bullishTrigger + atr, bullishTrigger + atr * 2];
  const bearishTargets = [bearishTrigger - atr, bearishTrigger - atr * 2];

  const isFX =
    symbol.includes("USD") ||
    symbol.includes("JPY") ||
    symbol.includes("EUR") ||
    symbol.includes("GBP") ||
    symbol.includes("AUD") ||
    symbol.includes("NZD") ||
    symbol.includes("CAD") ||
    symbol.includes("CHF");

  if (isFX) {
    const decimals = symbol.includes("JPY") ? 3 : 5;
    const pip = symbol.includes("JPY") ? 0.01 : 0.0001;

    const atrFX = Math.max(atr || 0, pip);

    const dir =
      trendLong === "ALCISTA" ? 1 :
      trendLong === "BAJISTA" ? -1 :
      0;

    if (dir !== 0) {
      const baseTrigger = dir === 1 ? bullishTrigger : bearishTrigger;

      const t1 = baseTrigger + dir * atrFX * 3;
      const t2 = baseTrigger + dir * atrFX * 6;

      if (dir === 1) {
        bullishTargets[0] = Number(t1.toFixed(decimals));
        bullishTargets[1] = Number(t2.toFixed(decimals));
      } else {
        bearishTargets[0] = Number(t1.toFixed(decimals));
        bearishTargets[1] = Number(t2.toFixed(decimals));
      }
    }

    const resistancesFX = resistances
      .slice(0, 3)
      .map((r) => Number(r.toFixed(decimals)));

    const supportsFX = supports
      .slice(0, 3)
      .map((s) => Number(s.toFixed(decimals)));

    if (resistancesFX.length === 0) {
      resistancesFX.push(Number((price + pip * 5).toFixed(decimals)));
    }
    if (supportsFX.length === 0) {
      supportsFX.push(Number((price - pip * 5).toFixed(decimals)));
    }

    R1Num = resistancesFX[0];
    R2Num = resistancesFX[1] ?? R1Num + pip * 5;
    R3Num = resistancesFX[2] ?? R1Num + pip * 10;

    S1Num = supportsFX[0];
    S2Num = supportsFX[1] ?? S1Num - pip * 5;
    S3Num = supportsFX[2] ?? S1Num - pip * 10;
  }

  const tfMults = {
    "5M": 1.5,
    "15M": 2,
    "1H": 3,
    "4H": 4,
    "1D": 6,
  };

  const tfMult = tfMults[timeframe] ?? 3;

  const bullishInvalidation = bullishTrigger - atr * tfMult;
  const bearishInvalidation = bearishTrigger + atr * tfMult;

  const allowBullish =
    trendShort === "ALCISTA" &&
    lastMACD >= lastSignal &&
    lastRSI > 48;

  const allowBearish =
    trendShort === "BAJISTA" &&
    lastMACD <= lastSignal &&
    lastRSI < 52;

  const bullActivated = allowBullish
    ? wasActivated(data, bullishTrigger, "bull")
    : false;

  const bearActivated = allowBearish
    ? wasActivated(data, bearishTrigger, "bear")
    : false;

  let bullishScenario = null;
  let bearishScenario = null;

  if (allowBullish) {
    const trigger = Number(bullishTrigger).toFixed(getDecimalPlaces(symbol));
    const invalidation = Number(bullishInvalidation).toFixed(getDecimalPlaces(symbol));
  
    bullishScenario = {
      trigger,
      target1: Number(bullishTargets[0]).toFixed(getDecimalPlaces(symbol)),
      target2: Number(bullishTargets[1]).toFixed(getDecimalPlaces(symbol)),
  
      // ⭐ invalidación bilingüe
      invalidationText: {
        es: `Una vez activado, el escenario quedaría invalidado si una vela de ${timeframe} cierra por debajo de ${invalidation} USD.`,
        en: `Once activated, the scenario would be invalidated if a ${timeframe} candle closes below ${invalidation} USD.`
      },
  
      status: bullActivated ? "ACTIVADO" : "PENDIENTE",
  
      // ⭐ activación bilingüe
      activationText: bullActivated
        ? {
            es: `Escenario activado por cierre previo por encima de ${trigger}.`,
            en: `Scenario activated by a previous close above ${trigger}.`
          }
        : {
            es: `El escenario alcista se activaría si la vela cierra por encima de ${trigger}.`,
            en: `The bullish scenario would activate if the candle closes above ${trigger}.`
          }
    };
  }  

  if (allowBearish) {
    const trigger = Number(bearishTrigger).toFixed(getDecimalPlaces(symbol));
    const invalidation = Number(bearishInvalidation).toFixed(getDecimalPlaces(symbol));
  
    bearishScenario = {
      trigger,
      target1: Number(bearishTargets[0]).toFixed(getDecimalPlaces(symbol)),
      target2: Number(bearishTargets[1]).toFixed(getDecimalPlaces(symbol)),
  
      // ⭐ invalidación bilingüe
      invalidationText: {
        es: `Una vez activado, el escenario quedaría invalidado si una vela de ${timeframe} cierra por encima de ${invalidation} USD.`,
        en: `Once activated, the scenario would be invalidated if a ${timeframe} candle closes above ${invalidation} USD.`
      },
  
      status: bearActivated ? "ACTIVADO" : "PENDIENTE",
  
      // ⭐ activación bilingüe
      activationText: bearActivated
        ? {
            es: `Escenario activado por cierre previo por debajo de ${trigger}.`,
            en: `Scenario activated by a previous close below ${trigger}.`
          }
        : {
            es: `El escenario bajista se activaría si la vela cierra por debajo de ${trigger}.`,
            en: `The bearish scenario would activate if the candle closes below ${trigger}.`
          }
    };
  }  

  const volWindow = data.slice(-20);
  const ranges = volWindow.map((c) => c.high - c.low);
  const avgRange =
    ranges.length > 0
      ? ranges.reduce((a, b) => a + b, 0) / ranges.length
      : 0;

  const volatilityPct = price > 0 ? (avgRange / price) * 100 : 0;

  let volatilityLevel = "Baja";
  if (volatilityPct > 1.2) volatilityLevel = "Alta";
  else if (volatilityPct > 0.6) volatilityLevel = "Media";

  let riskScore = 0;

  if (volatilityLevel === "Alta") riskScore += 2;
  else if (volatilityLevel === "Media") riskScore += 1;

  if (bullishScenario || bearishScenario) {
    const activation = bullishScenario?.trigger || bearishScenario?.trigger;
    const actNum = activation === "-" ? NaN : Number(activation);
    if (!isNaN(actNum) && price > 0) {
      const dist = Math.abs((price - actNum) / price) * 100;
      if (dist < 0.15) riskScore += 0;
      else if (dist < 0.35) riskScore += 1;
      else riskScore += 2;
    }
  }

  const riskLevel =
    riskScore <= 2 ? "Bajo" : riskScore <= 4 ? "Medio" : "Alto";

    const riskExplanation =
    riskLevel === "Bajo"
      ? {
          es: "Escenario estable: baja probabilidad de invalidación temprana.",
          en: "Stable scenario: low probability of early invalidation."
        }
      : riskLevel === "Medio"
      ? {
          es: "Escenario razonable con cierta probabilidad de ruido.",
          en: "Reasonable scenario with some likelihood of noise."
        }
      : {
          es: "Escenario frágil: alta probabilidad de invalidación temprana.",
          en: "Fragile scenario: high probability of early invalidation."
        };  

        const scenarioSummary =
  bullishScenario
    ? {
        es: `📈 Escenario alcista
• ${bullishScenario.activationText.es}
• 🎯 Objetivos: ${bullishScenario.target1} y ${bullishScenario.target2}
• ❌ Invalidación: ${bullishScenario.invalidationText.es}`,
        en: `📈 Bullish scenario
• ${bullishScenario.activationText.en}
• 🎯 Targets: ${bullishScenario.target1} and ${bullishScenario.target2}
• ❌ Invalidation: ${bullishScenario.invalidationText.en}`
      }
    : bearishScenario
    ? {
        es: `📉 Escenario bajista
• ${bearishScenario.activationText.es}
• 🎯 Objetivos: ${bearishScenario.target1} y ${bearishScenario.target2}
• ❌ Invalidación: ${bearishScenario.invalidationText.es}`,
        en: `📉 Bearish scenario
• ${bearishScenario.activationText.en}
• 🎯 Targets: ${bearishScenario.target1} and ${bearishScenario.target2}
• ❌ Invalidation: ${bearishScenario.invalidationText.en}`
      }
    : {
        es: "No se plantean escenarios claros en este momento debido a señales mixtas o falta de coherencia en las condiciones.",
        en: "No clear scenarios at this time due to mixed signals or lack of coherence in market conditions."
      };

     // Traducciones para el texto largo en inglés
const trendLongEN =
trendLong === "ALCISTA"
  ? "Bullish"
  : trendLong === "BAJISTA"
  ? "Bearish"
  : "Neutral";

const trendShortEN =
trendShort === "ALCISTA"
  ? "Bullish"
  : trendShort === "BAJISTA"
  ? "Bearish"
  : "Neutral";

const trendStrengthEN =
trendStrength === "Fuerte"
  ? "Strong"
  : trendStrength === "Moderada"
  ? "Moderate"
  : "Weak";

const sentimentLabelEN =
sentimentLabel === "Predominio alcista"
  ? "Bullish dominance"
  : sentimentLabel === "Predominio bajista"
  ? "Bearish dominance"
  : "Neutral sentiment";

const analysisText = {
es: `📊 Análisis técnico (${timeframe}) — ${symbol}
———————————————✦———————————————

• **Tendencia general:** ${trendLong}
• **Tendencia de corto plazo:** ${trendShort}

• **Fuerza de la tendencia:** ${trendStrength}
• **Sentimiento del mercado:** ${sentimentLabel}

• **Soporte clave:** ${Number(keySupportNum).toFixed(getDecimalPlaces(symbol))}
• **Resistencia clave:** ${Number(keyResistanceNum).toFixed(getDecimalPlaces(symbol))}

${scenarioSummary.es}`, 

en: `📊 Technical analysis (${timeframe}) — ${symbol}
———————————————✦———————————————

• **General trend:** ${trendLongEN}
• **Short-term trend:** ${trendShortEN}

• **Trend strength:** ${trendStrengthEN}
• **Market sentiment:** ${sentimentLabelEN}

• **Key support:** ${Number(keySupportNum).toFixed(getDecimalPlaces(symbol))}
• **Key resistance:** ${Number(keyResistanceNum).toFixed(getDecimalPlaces(symbol))}

${scenarioSummary.en}`
};

const opinion = bullishScenario
? bullishScenario.status === "ACTIVADO"
  ? {
      es: "Escenario alcista activado: el mercado respalda una continuación al alza mientras no se alcance la invalidación.",
      en: "Bullish scenario activated: the market supports continuation to the upside unless invalidation is reached."
    }
  : {
      es: "Escenario alcista potencial: podría activarse si el precio rompe la zona de activación.",
      en: "Potential bullish scenario: could activate if the price breaks the activation zone."
    }
: bearishScenario
? bearishScenario.status === "ACTIVADO"
  ? {
      es: "Escenario bajista activado: el mercado respalda una continuación a la baja mientras no se alcance la invalidación.",
      en: "Bearish scenario activated: the market supports continuation to the downside unless invalidation is reached."
    }
  : {
      es: "Escenario bajista potencial: podría activarse si el precio rompe la zona de activación.",
      en: "Potential bearish scenario: could activate if the price breaks the activation zone."
    }
: {
    es: "No hay escenarios claros: el mercado muestra señales mixtas o sin dirección definida.",
    en: "No clear scenarios: the market shows mixed or directionless signals."
  };

  const activeScenario =
    bullishScenario?.status === "ACTIVADO"
      ? "bullish"
      : bearishScenario?.status === "ACTIVADO"
      ? "bearish"
      : "none";

      return {
        trendShort,
        trendLong,
        bullPct,
        bearPct,
        neutralPct,
      
        opinion,               // ya es ES/EN
        bullishScenario,       // ya es ES/EN
        bearishScenario,       // ya es ES/EN
        activeScenario,
      
        keySupport: safe(keySupportNum),
        keyResistance: safe(keyResistanceNum),
      
        keySupportNum: Number(keySupportNum),
        keyResistanceNum: Number(keyResistanceNum),
      
        analysisText,          // ahora ES/EN
        scenarioSummary,       // ahora ES/EN
      
        price: Number(price),
        priceNum: Number(price),
      
        volatilityPct,
        volatilityLevel,
        sentiment: sentimentLabel,
        riskLevel,
        riskExplanation,       // ahora ES/EN
      
        resistances: { R1Num, R2Num, R3Num },
        supports: { S1Num, S2Num, S3Num },
      
        date: new Date().toISOString(),
      };      
}

export { generateAnalysis };

