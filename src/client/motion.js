// One clock for reel movement, Spine playback and counters, including speed changes mid-animation.
export function createClock({ frame, now, reduced = false }) {
  let speed = 1;
  const spines = new Set();
  const animate = (duration, draw = () => {}, { signal, ease = p => p } = {}) => new Promise(resolve => {
    let elapsed = 0, previous = now();
    duration = reduced ? Math.min(duration, 100) : duration;
    draw(ease(0));
    function tick(at) {
      if (signal?.aborted) return resolve(false);
      elapsed += Math.max(0, at - previous) * speed;
      previous = at;
      const p = duration > 0 ? Math.min(1, elapsed / duration) : 1;
      draw(ease(p));
      if (p === 1) resolve(true); else frame(tick);
    }
    frame(tick);
  });
  return {
    animate, wait: (ms, options) => animate(ms, undefined, options),
    get speed() { return speed; }, reduced,
    setSpeed(value) {
      speed = Math.max(.25, Math.min(4, Number(value) || 1));
      for (const spine of spines) {
        if (spine.destroyed) spines.delete(spine);
        else spine.state.timeScale = reduced ? speed * 10 : speed;
      }
    },
    track(spine) {
      spines.add(spine);
      spine.state.timeScale = reduced ? speed * 10 : speed;
      const release = () => spines.delete(spine);
      spine.once('destroyed', release);
      return release;
    },
  };
}

export const motion = createClock({ frame: fn => requestAnimationFrame(fn), now: () => performance.now(),
  reduced: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false });

export function playAnimation(spine, name, loop = false) {
  const entry = spine.state.setAnimation(0, name, loop);
  const duration = entry.animation.duration * 1000;
  return { duration, finished: motion.wait(duration) };
}
