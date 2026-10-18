const LIFT = 0.12;
const TOE = 1.3;
const SHOULDER = 1.2;
const VIBRANCE = 0.5;
const SKIN_PROTECTION = 0.5;
const PEAK = (TOE / (TOE + SHOULDER)) ** TOE * (SHOULDER / (TOE + SHOULDER)) ** SHOULDER;

export function toneCurve(amount) {
  const curve = new Float32Array(256);
  for (let value = 0; value < 256; value += 1) {
    const x = value / 255;
    curve[value] = 255 * (x + (amount * LIFT * x ** TOE * (1 - x) ** SHOULDER) / PEAK);
  }
  return curve;
}

export function createAdjustment(amount) {
  if (!(amount > 0)) return null;
  const strength = Math.min(amount, 1);
  const curve = toneCurve(strength);
  const vibrance = strength * VIBRANCE;
  return (source, target = source) => {
    for (let index = 0; index < source.length; index += 4) {
      let red = curve[source[index]];
      let green = curve[source[index + 1]];
      let blue = curve[source[index + 2]];
      const high = Math.max(red, green, blue);
      const low = Math.min(red, green, blue);
      const chroma = high - low;
      if (chroma > 0) {
        const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        let boost = vibrance * (1 - chroma / 255);
        if (red >= green && green >= blue) {
          const hue = (green - blue) / chroma;
          boost *= 1 - SKIN_PROTECTION * 4 * hue * (1 - hue);
        }
        const room = Math.min((255 - luma) / (high - luma), luma / (luma - low)) - 1;
        if (boost > 0 && room > 0) {
          const ratio = boost / room;
          const factor = 1 + boost / Math.sqrt(1 + ratio * ratio);
          red = luma + (red - luma) * factor;
          green = luma + (green - luma) * factor;
          blue = luma + (blue - luma) * factor;
        }
      }
      target[index] = red;
      target[index + 1] = green;
      target[index + 2] = blue;
      target[index + 3] = source[index + 3];
    }
    return target;
  };
}
