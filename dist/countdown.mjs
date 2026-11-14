export function createCountdown({ onTick, onDone, schedule = setTimeout, unschedule = clearTimeout, interval = 1000 }) {
  let timer = null;
  let generation = 0;
  const cancel = () => {
    generation += 1;
    if (timer !== null) unschedule(timer);
    timer = null;
  };
  return {
    cancel,
    start() {
      cancel();
      const run = generation;
      let remaining = 3;
      onTick(remaining);
      const advance = () => {
        if (run !== generation) return;
        timer = null;
        remaining -= 1;
        if (remaining === 0) { onDone(); return; }
        onTick(remaining);
        timer = schedule(advance, interval);
      };
      timer = schedule(advance, interval);
    }
  };
}
