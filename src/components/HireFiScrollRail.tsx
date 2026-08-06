import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'framer-motion';
import { LUXFI_URL } from '@/components/MarketHeader';

export function HireFiScrollRail() {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 130,
    damping: 24,
    mass: 0.28,
  });
  const railOffset = useTransform(smoothProgress, [0, 1], [-14, 14]);

  return (
    <aside
      className="pointer-events-none fixed right-0 top-1/2 z-[45] -translate-y-1/2"
      aria-label="Hire Fi"
    >
      <motion.a
        href={LUXFI_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="Hire Fi — let Fi search the world"
        title="Let Fi search the world"
        style={reduceMotion ? undefined : { y: railOffset }}
        className="group pointer-events-auto relative flex min-h-52 w-14 items-center justify-center overflow-hidden rounded-l-2xl border border-r-0 border-[#d4b87a]/45 bg-[#09090a]/95 px-3 py-5 text-white shadow-[-8px_12px_30px_rgba(0,0,0,0.24)] backdrop-blur-md transition-[width,background-color,border-color] duration-300 hover:w-16 hover:border-[#d4b87a] hover:bg-[#111113] focus-visible:w-16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4b87a] focus-visible:ring-offset-2 focus-visible:ring-offset-white sm:min-h-80 sm:w-16 sm:hover:w-[4.5rem] sm:focus-visible:w-[4.5rem]"
      >
        <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-semibold uppercase tracking-[0.18em] text-white/85 transition-colors group-hover:text-white sm:text-sm">
          Let Fi search the world
        </span>

        <span className="absolute bottom-0 left-0 top-0 w-[2px] bg-white/10" aria-hidden="true">
          <motion.span
            className="block h-full w-full origin-top bg-[#d4b87a]"
            style={{ scaleY: reduceMotion ? 1 : smoothProgress }}
          />
        </span>
      </motion.a>
    </aside>
  );
}
