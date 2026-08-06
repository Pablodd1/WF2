import { ExternalLink, Search, Sparkles } from 'lucide-react';
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
  const iconRotation = useTransform(smoothProgress, [0, 1], [-8, 8]);

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
        className="group pointer-events-auto relative flex min-h-44 w-12 flex-col items-center overflow-hidden rounded-l-2xl border border-r-0 border-[#d4b87a]/45 bg-[#09090a]/95 py-3 text-white shadow-[-8px_12px_30px_rgba(0,0,0,0.24)] backdrop-blur-md transition-[width,background-color,border-color] duration-300 hover:w-14 hover:border-[#d4b87a] hover:bg-[#111113] focus-visible:w-14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4b87a] focus-visible:ring-offset-2 focus-visible:ring-offset-white sm:min-h-72 sm:w-14 sm:py-4 sm:hover:w-16 sm:focus-visible:w-16"
      >
        <motion.span
          style={reduceMotion ? undefined : { rotate: iconRotation }}
          className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#d4b87a] text-black shadow-[0_0_0_5px_rgba(212,184,122,0.1)] sm:h-9 sm:w-9"
          aria-hidden="true"
        >
          <Search size={16} strokeWidth={2.2} />
          <Sparkles className="absolute -right-1 -top-1 text-[#f3dfad]" size={11} fill="currentColor" />
        </motion.span>

        <span className="my-3 hidden flex-1 items-center sm:flex">
          <span className="[writing-mode:vertical-rl] rotate-180 text-[9px] font-semibold uppercase tracking-[0.2em] text-white/75 transition-colors group-hover:text-white">
            Let Fi search the world
          </span>
        </span>

        <span className="my-3 flex flex-1 items-center sm:hidden">
          <span className="[writing-mode:vertical-rl] rotate-180 text-[9px] font-bold uppercase tracking-[0.18em] text-white/80">
            Hire Fi
          </span>
        </span>

        <ExternalLink className="shrink-0 text-[#d4b87a]" size={14} aria-hidden="true" />

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
