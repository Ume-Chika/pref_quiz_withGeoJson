import { ctx } from "./app-context.js";
import { ANIMATED_TYPES } from "./constants.js";

export function randomOf(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function randomMode(modes, fallback) {
  const available = ctx.saved.settings.visualEffects ? modes : modes.filter((type) => !ANIMATED_TYPES.includes(type));
  const fresh = available.filter((type) => type !== ctx.session?.recentTypes.at(-1));
  return randomOf(fresh.length ? fresh : available.length ? available : [fallback]);
}

export function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const next = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[next]] = [copy[next], copy[index]];
  }
  return copy;
}

export function playTone(kind) {
  if (!ctx.saved.settings.sound) return;
  try {
    ctx.audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.audioContext.state === "suspended") ctx.audioContext.resume();
    const config = kind === "correct"
      ? [{ frequency: 587.33, type: "sine" }, { frequency: 880, type: "sine" }]
      : [{ frequency: 220, type: "triangle" }, { frequency: 196, type: "triangle" }];
    config.forEach(({ frequency, type }, index) => {
      const oscillator = ctx.audioContext.createOscillator();
      const gain = ctx.audioContext.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime((ctx.saved.settings.volume ?? .5) * .25, ctx.audioContext.currentTime + index * .08);
      gain.gain.exponentialRampToValueAtTime(.0001, ctx.audioContext.currentTime + index * .08 + .2);
      oscillator.connect(gain);
      gain.connect(ctx.audioContext.destination);
      oscillator.start(ctx.audioContext.currentTime + index * .08);
      oscillator.stop(ctx.audioContext.currentTime + index * .08 + .2);
    });
  } catch (_) {
    ctx.saved.settings.sound = false;
  }
}
